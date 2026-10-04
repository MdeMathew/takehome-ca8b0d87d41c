package es.workfactory.bookingsync;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import es.workfactory.bookingsync.domain.BookingRecord;
import es.workfactory.bookingsync.domain.NormalizedBooking;
import es.workfactory.bookingsync.pms.client.WorkfactoryPmsClient;
import es.workfactory.bookingsync.pms.registerer.PmsRegisterer;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PmsRegistererTest {

    @Test
    void processesAnotherBookingWhileTheFirstWaitsForRetry() throws Exception {
        CountDownLatch firstRequestStarted = new CountDownLatch(1);
        CountDownLatch releaseFirstRequest = new CountDownLatch(1);
        AtomicInteger firstBookingAttempts = new AtomicInteger();
        List<String> received = new CopyOnWriteArrayList<>();
        ObjectMapper json = new ObjectMapper();
        HttpServer pms = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        pms.createContext("/pms/reservations", exchange -> {
            String id = json.readTree(exchange.getRequestBody()).path("bookingId").asText();
            received.add(id);
            if (received.size() == 1) {
                firstRequestStarted.countDown();
                try {
                    releaseFirstRequest.await(5, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    exchange.close();
                    return;
                }
            }
            boolean firstFailure = id.equals("delayed") && firstBookingAttempts.incrementAndGet() == 1;
            int status = firstFailure ? 503 : 201;
            byte[] body = (firstFailure ? "{}" : "{\"reservationId\":\"pms-" + id + "\"}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, body.length);
            try (var response = exchange.getResponseBody()) {
                response.write(body);
            }
        });
        pms.start();

        String previousApiBase = System.getProperty("API_BASE");
        System.setProperty("API_BASE", "http://127.0.0.1:" + pms.getAddress().getPort());
        PmsRegisterer registerer = new PmsRegisterer(new WorkfactoryPmsClient());
        try {
            registerer.start();
            BookingRecord delayed = booking("delayed");
            BookingRecord ready = booking("ready");
            registerer.enqueueNewBookings(Set.of(delayed));
            assertTrue(firstRequestStarted.await(5, TimeUnit.SECONDS));
            registerer.enqueueNewBookings(Set.of(ready));
            releaseFirstRequest.countDown();

            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while ((!"synced".equals(delayed.getStatus()) || !"synced".equals(ready.getStatus()))
                    && System.nanoTime() < deadline) {
                Thread.sleep(20);
            }
            assertEquals("synced", delayed.getStatus());
            assertEquals("synced", ready.getStatus());
            assertEquals(List.of("delayed", "ready", "delayed"), received);
            assertEquals(2, delayed.getAttempts());
            assertEquals(1, ready.getAttempts());
        } finally {
            releaseFirstRequest.countDown();
            registerer.stop();
            if (previousApiBase == null) System.clearProperty("API_BASE");
            else System.setProperty("API_BASE", previousApiBase);
            pms.stop(0);
        }
    }

    @Test
    void enqueuesWhileThePmsWorkerIsBusy() throws Exception {
        CountDownLatch firstRequestStarted = new CountDownLatch(1);
        CountDownLatch releaseFirstRequest = new CountDownLatch(1);
        AtomicInteger requests = new AtomicInteger();
        HttpServer pms = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        pms.createContext("/pms/reservations", exchange -> {
            int requestNumber = requests.incrementAndGet();
            if (requestNumber == 1) {
                firstRequestStarted.countDown();
                try {
                    releaseFirstRequest.await();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    exchange.close();
                    return;
                }
            }
            byte[] body = ("{\"reservationId\":\"pms-" + requestNumber + "\"}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(201, body.length);
            try (var response = exchange.getResponseBody()) {
                response.write(body);
            }
        });
        pms.start();

        String previousApiBase = System.getProperty("API_BASE");
        System.setProperty("API_BASE", "http://127.0.0.1:" + pms.getAddress().getPort());
        PmsRegisterer registerer = new PmsRegisterer(new WorkfactoryPmsClient());
        try {
            registerer.start();
            BookingRecord first = booking("first");
            BookingRecord second = booking("second");
            registerer.enqueueNewBookings(Set.of(first));
            assertTrue(firstRequestStarted.await(5, TimeUnit.SECONDS));

            long startedAt = System.nanoTime();
            registerer.enqueueNewBookings(Set.of(first));
            registerer.enqueueNewBookings(Set.of(second));
            long enqueueMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt);
            assertTrue(enqueueMillis < 500, "Enqueue waited for the PMS worker");
            assertEquals("pending", second.getStatus());

            releaseFirstRequest.countDown();
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while (!"synced".equals(second.getStatus()) && System.nanoTime() < deadline) {
                Thread.sleep(20);
            }
            assertEquals("synced", first.getStatus());
            assertEquals("synced", second.getStatus());
            assertEquals(2, requests.get());
        } finally {
            releaseFirstRequest.countDown();
            registerer.stop();
            if (previousApiBase == null) System.clearProperty("API_BASE");
            else System.setProperty("API_BASE", previousApiBase);
            pms.stop(0);
        }
    }

    @Test
    void replacesAnUnexpectedlyStoppedWorker() throws Exception {
        HttpServer pms = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        pms.createContext("/pms/reservations", exchange -> {
            byte[] body = "{\"reservationId\":\"recovered\"}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(201, body.length);
            try (var response = exchange.getResponseBody()) {
                response.write(body);
            }
        });
        pms.start();

        String previousApiBase = System.getProperty("API_BASE");
        System.setProperty("API_BASE", "http://127.0.0.1:" + pms.getAddress().getPort());
        PmsRegisterer registerer = new PmsRegisterer(new WorkfactoryPmsClient());
        try {
            registerer.start();
            Thread original = findWorker();
            assertNotNull(original);
            original.interrupt();

            Thread replacement = null;
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while (System.nanoTime() < deadline) {
                replacement = findWorker();
                if (replacement != null && replacement != original) break;
                Thread.sleep(20);
            }
            assertNotNull(replacement);
            assertTrue(replacement != original && replacement.isAlive());

            BookingRecord booking = booking("after-restart");
            registerer.enqueueNewBookings(Set.of(booking));
            deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while (!"synced".equals(booking.getStatus()) && System.nanoTime() < deadline) {
                Thread.sleep(20);
            }
            assertEquals("synced", booking.getStatus());
        } finally {
            registerer.stop();
            if (previousApiBase == null) System.clearProperty("API_BASE");
            else System.setProperty("API_BASE", previousApiBase);
            pms.stop(0);
        }
    }

    private static Thread findWorker() {
        return Thread.getAllStackTraces().keySet().stream()
                .filter(thread -> thread.isAlive() && thread.getName().equals("pms-registerer"))
                .findFirst()
                .orElse(null);
    }

    private static BookingRecord booking(String id) {
        return BookingRecord.as(new NormalizedBooking(
                id, "booking", "Guest", "2026-10-10", "2026-10-11", 100.0, "EUR"),
                "pending", 0);
    }
}
