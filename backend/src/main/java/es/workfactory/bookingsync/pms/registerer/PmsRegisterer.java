package es.workfactory.bookingsync.pms.registerer;

import es.workfactory.bookingsync.Env;
import es.workfactory.bookingsync.domain.BookingRecord;
import es.workfactory.bookingsync.pms.client.PmsClient;

import java.util.Objects;
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
            Integer.parseInt(Env.optional("MAX_TRIES_FOR_REGISTERING_BOOKING_PMS", "4"));
    private final PmsClient client;
    private final DelayQueue<ScheduledBooking> pendingBookings = new DelayQueue<>();
    private final Semaphore availableSlots = new Semaphore(QUEUE_CAPACITY);
    private final Set<String> queuedOrActiveIds = ConcurrentHashMap.newKeySet();
    private final Object lifecycleLock = new Object();
    private volatile boolean stopping = true;
    private volatile boolean startedOnce;
    private volatile Thread worker;
    private volatile Thread supervisor;
    private volatile BookingRecord activeBooking;

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

    public PmsRegisterer(PmsClient client) {
        this.client = Objects.requireNonNull(client, "client");
    }

    public void start() {
        synchronized (lifecycleLock) {
            if (!stopping) return;
            if (worker != null && worker.isAlive()) {
                throw new IllegalStateException("The previous PMS worker is still stopping");
            }
            stopping = false;
            startedOnce = true;
            startWorkerLocked();
            supervisor = new Thread(this::superviseWorker, "pms-supervisor");
            supervisor.setDaemon(true);
            supervisor.start();
        }
    }

    public void stop() {
        Thread workerToStop;
        Thread supervisorToStop;
        synchronized (lifecycleLock) {
            if (stopping) return;
            stopping = true;
            workerToStop = worker;
            supervisorToStop = supervisor;
        }

        supervisorToStop.interrupt();
        workerToStop.interrupt();
        awaitStop(workerToStop);
        awaitStop(supervisorToStop);

        for (ScheduledBooking scheduled : pendingBookings.toArray(new ScheduledBooking[0])) {
            if (pendingBookings.remove(scheduled)) {
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

    private void startWorkerLocked() {
        if (stopping || (worker != null && worker.isAlive())) return;
        worker = new Thread(this::consumeBookings, "pms-registerer");
        worker.setDaemon(true);
        worker.start();
    }

    private void superviseWorker() {
        while (!stopping) {
            try {
                TimeUnit.MILLISECONDS.sleep(SUPERVISOR_INTERVAL_MS);
            } catch (InterruptedException e) {
                if (stopping) return;
            }

            synchronized (lifecycleLock) {
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

    public void enqueueNewBookings(Set<BookingRecord> newBookings) {
        if (!startedOnce) start();
        for (BookingRecord booking : newBookings) {
            synchronized (lifecycleLock) {
                if (stopping) {
                    booking.markStatus("failed", booking.getAttempts(), "PMS worker is stopped", null);
                    continue;
                }
                if (isSynced(booking)) continue;
                if (isBeingProcessed(booking)) continue;
                if (!availableSlots.tryAcquire()) {
                    queuedOrActiveIds.remove(booking.getId());
                    booking.markStatus("failed", booking.getAttempts(), "PMS queue is full", null);
                    continue;
                }
                pendingBookings.offer(ScheduledBooking.now(booking));
            }
        }
    }

    public RetryResult retryFailedBooking(BookingRecord booking) {
        if (!startedOnce) start();
        synchronized (lifecycleLock) {
            if (!"failed".equals(booking.getStatus())) return RetryResult.NOT_FAILED;
            if (stopping || !queuedOrActiveIds.add(booking.getId())) {
                return RetryResult.UNAVAILABLE;
            }
            if (!availableSlots.tryAcquire()) {
                queuedOrActiveIds.remove(booking.getId());
                return RetryResult.UNAVAILABLE;
            }

            int previousAttempts = booking.getAttempts();
            String previousError = booking.getLastError();
            String previousReference = booking.getPmsReference();
            booking.markStatus("pending", 0, null, null);
            try {
                pendingBookings.offer(ScheduledBooking.now(booking));
            } catch (RuntimeException e) {
                booking.markStatus("failed", previousAttempts, previousError, previousReference);
                queuedOrActiveIds.remove(booking.getId());
                availableSlots.release();
                throw e;
            }
            return RetryResult.ACCEPTED;
        }
    }

    private boolean isBeingProcessed(BookingRecord booking) {
        return !queuedOrActiveIds.add(booking.getId());
    }

    private static boolean isSynced(BookingRecord booking) {
        return "synced".equals(booking.getStatus());
    }

    private void consumeBookings() {
        while (!Thread.currentThread().isInterrupted()) {
            ScheduledBooking scheduled;
            try {
                scheduled = pendingBookings.take();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }

            BookingRecord booking = scheduled.booking();
            activeBooking = booking;
            try {
                AttemptResult result = attemptBooking(booking);
                if (result == AttemptResult.RETRY) {
                    synchronized (lifecycleLock) {
                        if (stopping) {
                            booking.markStatus("failed", booking.getAttempts(),
                                    "PMS worker stopped before retrying", null);
                            finishBookingLocked(booking);
                        } else {
                            pendingBookings.offer(ScheduledBooking.after(booking, RETRY_DELAY_MS));
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

    private void finishBooking(BookingRecord booking) {
        synchronized (lifecycleLock) {
            finishBookingLocked(booking);
        }
    }

    private void finishBookingLocked(BookingRecord booking) {
        if (queuedOrActiveIds.remove(booking.getId())) {
            availableSlots.release();
        }
        if (activeBooking == booking) activeBooking = null;
    }

    private static String errorOf(Exception e) {
        String message = e.getMessage();
        return message == null || message.isBlank()
                ? e.getClass().getSimpleName()
                : e.getClass().getSimpleName() + ": " + message;
    }

    private AttemptResult attemptBooking(BookingRecord booking) throws InterruptedException {
        if (booking.getAttempts() >= MAX_TRIES_FOR_REGISTERING) {
            booking.markStatus("failed", booking.getAttempts(), "PMS attempt limit reached", null);
            return AttemptResult.FAILED;
        }

        int totalAttempts = booking.getAttempts() + 1;
        booking.markStatus("syncing", booking.getAttempts(), null, null);
        try {
            PmsClient.Result result = client.submit(booking.toNormalizedBooking());
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
