package es.workfactory.bookingsync.channel;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ChannelEventConsumerTest {

    @Test
    void retriesPendingAckWithinBudgetAndReturnsOnlyAcknowledgedEvents() throws Exception {
        AtomicInteger firstAckAttempts = new AtomicInteger();
        AtomicInteger secondAckAttempts = new AtomicInteger();
        AtomicInteger thirdAckAttempts = new AtomicInteger();
        HttpServer channel = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        channel.createContext("/channels/events", exchange -> {
            String path = exchange.getRequestURI().getPath();
            int status;
            String body;
            if (path.equals("/channels/events")) {
                status = 200;
                body = """
                        {"events":[
                          {"eventId":"first","channel":"booking","deliveryAttempt":1,"payload":{}},
                          {"eventId":"second","channel":"airbnb","deliveryAttempt":1,"payload":{}},
                          {"eventId":"third","channel":"booking","deliveryAttempt":1,"payload":{}}
                        ],"done":true}
                        """;
            } else if (path.equals("/channels/events/first/ack")) {
                status = firstAckAttempts.incrementAndGet() == 1 ? 503 : 200;
                body = "{}";
            } else if (path.equals("/channels/events/second/ack")) {
                secondAckAttempts.incrementAndGet();
                status = 200;
                body = "{}";
            } else if (path.equals("/channels/events/third/ack")) {
                thirdAckAttempts.incrementAndGet();
                status = 503;
                body = "{}";
            } else {
                status = 404;
                body = "{}";
            }
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, bytes.length);
            try (var response = exchange.getResponseBody()) {
                response.write(bytes);
            }
        });
        channel.start();

        String previousApiBase = System.getProperty("API_BASE");
        System.setProperty("API_BASE", "http://127.0.0.1:" + channel.getAddress().getPort());
        try {
            long started = System.nanoTime();
            EventsPage page = new ChannelEventConsumer().fetchEvents(3);
            long elapsedMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);

            assertEquals(Set.of("first", "second"),
                    page.events().stream().map(ChannelEvent::eventId).collect(java.util.stream.Collectors.toSet()));
            assertTrue(page.done());
            assertEquals(2, firstAckAttempts.get());
            assertEquals(1, secondAckAttempts.get());
            assertTrue(thirdAckAttempts.get() >= 2);
            assertTrue(elapsedMillis < 1_000, "ACK retries exceeded their time budget");
        } finally {
            if (previousApiBase == null) System.clearProperty("API_BASE");
            else System.setProperty("API_BASE", previousApiBase);
            channel.stop(0);
        }
    }
}
