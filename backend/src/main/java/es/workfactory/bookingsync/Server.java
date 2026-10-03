package es.workfactory.bookingsync;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import es.workfactory.bookingsync.http.Json;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Your API, and the screen it feeds. The routing, the static page and the error envelope are
 * already here so you can spend your time on what the exercise is about.
 *
 * Four jobs; the last three answer 501 until you write them.
 */
public final class Server {

    private static final Pattern BOOKING = Pattern.compile("^/api/bookings/([^/]+)$");
    private static final Pattern RETRY = Pattern.compile("^/api/bookings/([^/]+)/retry$");

    private Server() {}

    /**
     * YOUR JOB (1 of 4): consume the sales channels. Called once when the server starts.
     *
     * Nobody calls you: you ask ChannelClient.fetchEvents for what has come due and you tell the
     * channel you received it with ChannelClient.ackEvent. A channel gives up on you if it waits
     * more than 500ms for that confirmation and hands you the same event again. The PMS the
     * booking eventually has to reach takes 3 to 5 seconds and fails a third of the time. The same
     * booking_id can come in more than one event. None of that is solved by confirming fast and
     * forgetting about the rest: every booking has to end up synced or failed, and a duplicate can
     * never reach the PMS twice.
     */
    private static void startChannelConsumer() {
        System.out.println("The channel consumer is not written yet.");
    }

    /** YOUR JOB (2 of 4): every booking, most recently updated first. */
    private static void listBookings(HttpExchange exchange) throws IOException {
        Json.notImplemented(exchange, "The list of bookings");
    }

    /** YOUR JOB (3 of 4): one booking, with its current sync status. */
    private static void bookingDetail(HttpExchange exchange, String id) throws IOException {
        Json.notImplemented(exchange, "The booking detail");
    }

    /**
     * YOUR JOB (4 of 4): "Forzar sincronización manual". Only makes sense on a booking that is
     * failed; what happens to any other status is your call.
     */
    private static void forceRetry(HttpExchange exchange, String id) throws IOException {
        Json.notImplemented(exchange, "Forcing a retry");
    }

    public static HttpServer start(int port) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/", Server::route);
        server.start();
        return server;
    }

    private static void route(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath();
        String method = exchange.getRequestMethod();

        if (method.equals("GET") && path.equals("/health")) {
            Json.send(exchange, 200, java.util.Map.of("ok", true));
            return;
        }

        if (method.equals("GET") && (path.equals("/") || path.equals("/index.html"))) {
            try {
                Json.html(exchange, screen());
            } catch (IOException missing) {
                Json.fail(exchange, 500, "SCREEN_MISSING", missing.getMessage());
            }
            return;
        }

        if (method.equals("GET") && path.equals("/api/bookings")) {
            listBookings(exchange);
            return;
        }

        Matcher booking = BOOKING.matcher(path);
        if (booking.matches()) {
            if (!method.equals("GET")) {
                Json.fail(exchange, 405, "METHOD_NOT_ALLOWED", method + " is not allowed here.");
                return;
            }
            bookingDetail(exchange, booking.group(1));
            return;
        }

        Matcher retry = RETRY.matcher(path);
        if (retry.matches()) {
            if (!method.equals("POST")) {
                Json.fail(exchange, 405, "METHOD_NOT_ALLOWED", method + " is not allowed here.");
                return;
            }
            forceRetry(exchange, retry.group(1));
            return;
        }

        Json.fail(exchange, 404, "NOT_FOUND", "That route does not exist.");
    }

    /**
     * The page the front module serves, read from disk and not from the classpath: the front is
     * a module of its own, next to this one, so what you edit there is served without rebuilding.
     */
    private static String screen() throws IOException {
        Path directory = Path.of("").toAbsolutePath();
        for (int depth = 0; depth < 4 && directory != null; depth++, directory = directory.getParent()) {
            Path page = directory.resolve("frontend").resolve("index.html");
            if (Files.isRegularFile(page)) return Files.readString(page, StandardCharsets.UTF_8);
        }
        throw new IOException("frontend/index.html is not where the server looks for it.");
    }

    public static void main(String[] args) throws IOException {
        int port = Integer.parseInt(Env.optional("PORT", "3000"));
        start(port);
        System.out.println("Listening on http://localhost:" + port);
        startChannelConsumer();
    }
}
