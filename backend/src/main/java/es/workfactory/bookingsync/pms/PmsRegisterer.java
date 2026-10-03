package es.workfactory.bookingsync.pms;

import es.workfactory.bookingsync.Env;
import es.workfactory.bookingsync.domain.BookingRecord;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.DelayQueue;
import java.util.concurrent.Delayed;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

public class PmsRegisterer {

    public enum RetryResult { ACCEPTED, NOT_FAILED, UNAVAILABLE }

    private enum AttemptResult { SYNCED, RETRY, FAILED }

    private static final int QUEUE_CAPACITY = 1024;
    private static final long SUPERVISOR_INTERVAL_MS = 1_000;
    private static final long SHUTDOWN_TIMEOUT_MS = 5_000;
    private static final long RETRY_DELAY_MS = 400;
    private static final int MAX_TRIES_FOR_REGISTERING =
            Integer.parseInt(Env.optional("MAX_TRIES_FOR_REGISTERING_BOOKING_PMS", "3"));
    private static final DelayQueue<ScheduledBooking> PENDING_BOOKINGS = new DelayQueue<>();
    private static final Semaphore AVAILABLE_SLOTS = new Semaphore(QUEUE_CAPACITY);
    private static final Set<String> QUEUED_OR_ACTIVE_IDS = ConcurrentHashMap.newKeySet();
    private static final Object LIFECYCLE_LOCK = new Object();
    private static volatile boolean stopping = true;
    private static volatile boolean startedOnce;
    private static volatile Thread worker;
    private static volatile Thread supervisor;
    private static volatile BookingRecord activeBooking;

    private record ScheduledBooking(BookingRecord booking, long dueAtNanos) implements Delayed {
        static ScheduledBooking now(BookingRecord booking) {
            return new ScheduledBooking(booking, System.nanoTime());
        }

        static ScheduledBooking after(BookingRecord booking, long delayMillis) {
            return new ScheduledBooking(booking, System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(delayMillis));
        }

        @Override
        public long getDelay(TimeUnit unit) {
            return unit.convert(dueAtNanos - System.nanoTime(), TimeUnit.NANOSECONDS);
        }

        @Override
        public int compareTo(Delayed other) {
            return Long.compare(dueAtNanos, ((ScheduledBooking) other).dueAtNanos);
        }
    }

    private PmsRegisterer() {
    }

    public static void start() {
        synchronized (LIFECYCLE_LOCK) {
            if (!stopping) return;
            if (worker != null && worker.isAlive()) {
                throw new IllegalStateException("The previous PMS worker is still stopping");
            }
            stopping = false;
            startedOnce = true;
            startWorkerLocked();
            supervisor = new Thread(PmsRegisterer::superviseWorker, "pms-supervisor");
            supervisor.setDaemon(true);
            supervisor.start();
        }
    }

    public static void stop() {
        Thread workerToStop;
        Thread supervisorToStop;
        synchronized (LIFECYCLE_LOCK) {
            if (stopping) return;
            stopping = true;
            workerToStop = worker;
            supervisorToStop = supervisor;
        }

        supervisorToStop.interrupt();
        workerToStop.interrupt();
        awaitStop(workerToStop);
        awaitStop(supervisorToStop);

        for (ScheduledBooking scheduled : PENDING_BOOKINGS.toArray(new ScheduledBooking[0])) {
            if (PENDING_BOOKINGS.remove(scheduled)) {
                BookingRecord pending = scheduled.booking();
                pending.markStatus("failed", pending.getAttempts(), "PMS worker stopped before processing", null);
                finishBooking(pending);
            }
        }
        if (!workerToStop.isAlive() && activeBooking != null) {
            BookingRecord abandoned = activeBooking;
            abandoned.markStatus("failed", abandoned.getAttempts(),
                    "PMS worker stopped before completing the booking; PMS outcome unknown", null);
            finishBooking(abandoned);
        }
    }

    private static void awaitStop(Thread thread) {
        try {
            thread.join(SHUTDOWN_TIMEOUT_MS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static void startWorkerLocked() {
        if (stopping || (worker != null && worker.isAlive())) return;
        worker = new Thread(PmsRegisterer::consumeBookings, "pms-registerer");
        worker.setDaemon(true);
        worker.start();
    }

    private static void superviseWorker() {
        while (!stopping) {
            try {
                TimeUnit.MILLISECONDS.sleep(SUPERVISOR_INTERVAL_MS);
            } catch (InterruptedException e) {
                if (stopping) return;
            }

            synchronized (LIFECYCLE_LOCK) {
                if (stopping) return;
                if (worker != null && worker.isAlive()) continue;

                System.err.println("PMS worker stopped unexpectedly; starting a replacement");
                BookingRecord abandoned = activeBooking;
                if (abandoned != null) {
                    abandoned.markStatus("failed", abandoned.getAttempts(),
                            "PMS worker stopped unexpectedly; PMS outcome unknown", null);
                    finishBookingLocked(abandoned);
                }
                startWorkerLocked();
            }
        }
    }

    public static void enqueueNewBookings(Set<BookingRecord> newBookings) {
        if (!startedOnce) start();
        for (BookingRecord booking : newBookings) {
            synchronized (LIFECYCLE_LOCK) {
                if (stopping) {
                    booking.markStatus("failed", booking.getAttempts(), "PMS worker is stopped", null);
                    continue;
                }
                if (isSynced(booking)) continue;
                if (isBeingProcessed(booking)) continue;
                if (!AVAILABLE_SLOTS.tryAcquire()) {
                    QUEUED_OR_ACTIVE_IDS.remove(booking.getId());
                    booking.markStatus("failed", booking.getAttempts(), "PMS queue is full", null);
                    continue;
                }
                PENDING_BOOKINGS.offer(ScheduledBooking.now(booking));
            }
        }
    }

    public static RetryResult retryFailedBooking(BookingRecord booking) {
        if (!startedOnce) start();
        synchronized (LIFECYCLE_LOCK) {
            if (!"failed".equals(booking.getStatus())) return RetryResult.NOT_FAILED;
            if (stopping || !QUEUED_OR_ACTIVE_IDS.add(booking.getId())) {
                return RetryResult.UNAVAILABLE;
            }
            if (!AVAILABLE_SLOTS.tryAcquire()) {
                QUEUED_OR_ACTIVE_IDS.remove(booking.getId());
                return RetryResult.UNAVAILABLE;
            }

            int previousAttempts = booking.getAttempts();
            String previousError = booking.getLastError();
            String previousReference = booking.getPmsReference();
            booking.markStatus("pending", 0, null, null);
            try {
                PENDING_BOOKINGS.offer(ScheduledBooking.now(booking));
            } catch (RuntimeException e) {
                booking.markStatus("failed", previousAttempts, previousError, previousReference);
                QUEUED_OR_ACTIVE_IDS.remove(booking.getId());
                AVAILABLE_SLOTS.release();
                throw e;
            }
            return RetryResult.ACCEPTED;
        }
    }

    private static boolean isBeingProcessed(BookingRecord booking) {
        return !QUEUED_OR_ACTIVE_IDS.add(booking.getId());
    }

    private static boolean isSynced(BookingRecord booking) {
        return "synced".equals(booking.getStatus());
    }

    private static void consumeBookings() {
        while (!Thread.currentThread().isInterrupted()) {
            ScheduledBooking scheduled;
            try {
                scheduled = PENDING_BOOKINGS.take();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }

            BookingRecord booking = scheduled.booking();
            activeBooking = booking;
            try {
                AttemptResult result = attemptBooking(booking);
                if (result == AttemptResult.RETRY) {
                    synchronized (LIFECYCLE_LOCK) {
                        if (stopping) {
                            booking.markStatus("failed", booking.getAttempts(),
                                    "PMS worker stopped before retrying", null);
                            finishBookingLocked(booking);
                        } else {
                            PENDING_BOOKINGS.offer(ScheduledBooking.after(booking, RETRY_DELAY_MS));
                            activeBooking = null;
                        }
                    }
                } else {
                    finishBooking(booking);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                booking.markStatus("failed", booking.getAttempts(), errorOf(e), null);
                finishBooking(booking);
                return;
            } catch (RuntimeException e) {
                booking.markStatus("failed", booking.getAttempts(), errorOf(e), null);
                System.err.println("Unexpected PMS worker failure for booking "
                        + booking.getId() + ": " + errorOf(e));
                finishBooking(booking);
            }
        }
    }

    private static void finishBooking(BookingRecord booking) {
        synchronized (LIFECYCLE_LOCK) {
            finishBookingLocked(booking);
        }
    }

    private static void finishBookingLocked(BookingRecord booking) {
        if (QUEUED_OR_ACTIVE_IDS.remove(booking.getId())) {
            AVAILABLE_SLOTS.release();
        }
        if (activeBooking == booking) activeBooking = null;
    }

    private static String errorOf(Exception e) {
        String message = e.getMessage();
        return message == null || message.isBlank()
                ? e.getClass().getSimpleName()
                : e.getClass().getSimpleName() + ": " + message;
    }

    private static AttemptResult attemptBooking(BookingRecord booking) throws InterruptedException {
        if (booking.getAttempts() >= MAX_TRIES_FOR_REGISTERING) {
            booking.markStatus("failed", booking.getAttempts(), "PMS attempt limit reached", null);
            return AttemptResult.FAILED;
        }

        int totalAttempts = booking.getAttempts() + 1;
        booking.markStatus("syncing", booking.getAttempts(), null, null);
        try {
            PmsClient.Result result = PmsClient.submit(booking.toNormalizedBooking());
            if (result.ok()) {
                booking.markStatus("synced", totalAttempts, null, result.pmsReference());
                return AttemptResult.SYNCED;
            }
            return markFailedAttempt(booking, totalAttempts,
                    String.valueOf(result.status()), result.pmsReference());
        } catch (InterruptedException e) {
            throw e;
        } catch (Exception e) {
            return markFailedAttempt(booking, totalAttempts, errorOf(e), null);
        }
    }

    private static AttemptResult markFailedAttempt(BookingRecord booking, int attempts,
                                                   String error, String pmsReference) {
        boolean exhausted = attempts >= MAX_TRIES_FOR_REGISTERING;
        booking.markStatus(exhausted ? "failed" : "retrying", attempts, error, pmsReference);
        return exhausted ? AttemptResult.FAILED : AttemptResult.RETRY;
    }
}
