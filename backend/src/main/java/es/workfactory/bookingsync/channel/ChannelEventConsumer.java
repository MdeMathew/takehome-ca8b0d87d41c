package es.workfactory.bookingsync.channel;

import com.fasterxml.jackson.core.JsonProcessingException;

import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.TimeUnit;

public final class ChannelEventConsumer {

    public ChannelEventConsumer() {
    }

    public EventsPage fetchEvents(int limit) throws Exception {
        EventsPage page = null;
        long ackDeadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(500);
        try {
            page = ChannelClient.fetchEvents(limit);
        } catch (Exception e) {
            manageException(e);
        }
        return acknowledgeEvents(page, ackDeadline);
    }

    private void manageException(Exception e) throws Exception {
        switch (e) {
            case JsonProcessingException malformed -> {
                System.err.println("Invalid JSON from channel");
                throw malformed;
            }
            case InterruptedException interrupted -> {
                Thread.currentThread().interrupt();
                throw interrupted;
            }
            case IOException io -> {
                System.err.println("Channel communication failed");
                throw io;
            }
            case IllegalStateException response -> {
                System.err.println("Channel returned a non-200 response");
                throw response;
            }
            default -> throw e;
        }
    }

    private EventsPage acknowledgeEvents(EventsPage page, long deadline) {
        if (page == null || page.events().isEmpty()) return page;

        List<ChannelEvent> pending = new ArrayList<>(page.events());
        List<ChannelEvent> acknowledged = new ArrayList<>();

        while (!pending.isEmpty() && isBeforeDeadline(deadline)) {
            int remainingEvents = pending.size();
            for (Iterator<ChannelEvent> it = pending.iterator(); it.hasNext() && System.nanoTime() < deadline; ) {
                ChannelEvent event = it.next();
                long remainingMs = TimeUnit.NANOSECONDS.toMillis(deadline - System.nanoTime());
                long timeoutMs = Math.min(100, remainingMs / remainingEvents--);
                if (timeoutMs < 1) break;

                try {
                    if (ChannelClient.ackEvent(event.eventId(), Duration.ofMillis(timeoutMs)).ok()) {
                        acknowledged.add(event);
                        it.remove();
                    }
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    return new EventsPage(acknowledged, page.done());
                } catch (Exception ex) {
                    // Leave the event pending for the next round.
                }
            }

            if (hasPendingEventsAndTime(deadline, pending)) {
                try {
                    sleep(25);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    return new EventsPage(acknowledged, page.done());
                }
            }
        }

        return new EventsPage(acknowledged, page.done());
    }

    private static void sleep(int timeInMs) throws InterruptedException {
        TimeUnit.MILLISECONDS.sleep(timeInMs);
    }

    private static boolean hasPendingEventsAndTime(long deadline, List<ChannelEvent> pending) {
        return !pending.isEmpty() && System.nanoTime() < deadline;
    }

    private static boolean isBeforeDeadline(long deadline) {
        return System.nanoTime() < deadline;
    }

}
