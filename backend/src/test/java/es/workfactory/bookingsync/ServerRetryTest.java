package es.workfactory.bookingsync;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import es.workfactory.bookingsync.domain.BookingRecord;
import es.workfactory.bookingsync.domain.NormalizedBooking;
import es.workfactory.bookingsync.pms.PmsRegisterer;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ServerRetryTest {

    private static final HttpClient HTTP = HttpClient.newHttpClient();
    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void retriesOnlyFailedBookingsAndStartsAnewAttemptCycle() throws Exception {
        AtomicInteger requests = new AtomicInteger();
        HttpServer pms = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        pms.createContext("/pms/reservations", exchange -> {
            int requestNumber = requests.incrementAndGet();
            int status = requestNumber <= 3 ? 503 : 201;
            byte[] body = (status == 201 ? "{\"reservationId\":\"pms-retried\"}" : "{}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, body.length);
            try (var response = exchange.getResponseBody()) {
                response.write(body);
            }
        });
        pms.start();

        String previousApiBase = System.getProperty("API_BASE");
        System.setProperty("API_BASE", "http://127.0.0.1:" + pms.getAddress().getPort());
        HttpServer app = null;
        try {
            Store.clear();
            BookingRecord booking = BookingRecord.as(new NormalizedBooking(
                    "retry-me", "booking", "Guest", "2026-10-10", "2026-10-11", 100.0, "EUR"),
                    "pending", 0);
            Store.upsert(booking);
            PmsRegisterer.start();
            PmsRegisterer.enqueueNewBookings(Set.of(booking));
            app = Server.start(0);
            String base = "http://127.0.0.1:" + app.getAddress().getPort();

            assertEquals(404, post(base + "/api/bookings/missing/retry").statusCode());
            assertEquals(409, post(base + "/api/bookings/retry-me/retry").statusCode());
            awaitStatus(booking, "failed");
            assertEquals(3, booking.getAttempts());
            assertEquals(3, requests.get());

            HttpResponse<String> accepted = post(base + "/api/bookings/retry-me/retry");
            assertEquals(202, accepted.statusCode());
            assertEquals(409, post(base + "/api/bookings/retry-me/retry").statusCode());
            awaitStatus(booking, "synced");
            assertEquals(4, requests.get());
            assertEquals(1, booking.getAttempts());
            assertNull(booking.getLastError());
            assertEquals("pms-retried", booking.getPmsReference());
            JsonNode detail = JSON.readTree(HTTP.send(HttpRequest.newBuilder(
                    URI.create(base + "/api/bookings/retry-me")).GET().build(),
                    HttpResponse.BodyHandlers.ofString()).body());
            assertEquals("synced", detail.path("status").asText());
            assertTrue(detail.path("lastError").isNull());
        } finally {
            if (app != null) app.stop(0);
            PmsRegisterer.stop();
            Store.clear();
            if (previousApiBase == null) System.clearProperty("API_BASE");
            else System.setProperty("API_BASE", previousApiBase);
            pms.stop(0);
        }
    }

    private static HttpResponse<String> post(String url) throws Exception {
        return HTTP.send(HttpRequest.newBuilder(URI.create(url))
                .POST(HttpRequest.BodyPublishers.noBody()).build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private static void awaitStatus(BookingRecord booking, String expected) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (!expected.equals(booking.getStatus()) && System.nanoTime() < deadline) {
            Thread.sleep(20);
        }
        assertEquals(expected, booking.getStatus());
    }
}
