package es.workfactory.bookingsync.http;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * The shape every error answer has. It comes written so all your errors look the same without
 * you having to think about it.
 */
public final class Json {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private Json() {}

    public static void send(HttpExchange exchange, int status, Object body) throws IOException {
        byte[] payload = MAPPER.writerWithDefaultPrettyPrinter().writeValueAsBytes(body);
        exchange.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(status, payload.length);
        exchange.getResponseBody().write(payload);
        exchange.close();
    }

    public static void fail(HttpExchange exchange, int status, String code, String message) throws IOException {
        send(exchange, status, Map.of("error", Map.of("code", code, "message", message)));
    }

    public static void notImplemented(HttpExchange exchange, String what) throws IOException {
        fail(exchange, 501, "NOT_IMPLEMENTED", what + " is not written yet.");
    }

    public static void html(HttpExchange exchange, String page) throws IOException {
        byte[] payload = page.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "text/html; charset=utf-8");
        exchange.sendResponseHeaders(200, payload.length);
        exchange.getResponseBody().write(payload);
        exchange.close();
    }
}
