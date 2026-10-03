package es.workfactory.bookingsync;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import es.workfactory.bookingsync.domain.NormalizedBooking;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

/**
 * The call to the PMS. It is written, and it is written for exactly one attempt: no retry, no
 * backoff, no queue. Read it before touching it: what is missing is not marked with a TODO.
 */
public final class PmsClient {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .version(HttpClient.Version.HTTP_1_1)
            .build();

    private PmsClient() {}

    public record Result(boolean ok, String pmsReference, int status) {}

    public static Result submit(NormalizedBooking booking) throws Exception {
        String apiBase = Env.optional("API_BASE", "http://localhost:4000");

        String body = MAPPER.writeValueAsString(Map.of(
                "bookingId", booking.id(),
                "channel", booking.channel(),
                "guestName", booking.guestName(),
                "checkIn", booking.checkIn(),
                "checkOut", booking.checkOut(),
                "totalPrice", booking.totalPrice(),
                "currency", booking.currency()));
        String token = Env.optional("API_TOKEN", "wf_local");

        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(apiBase + "/pms/reservations"))
                .timeout(Duration.ofSeconds(15))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body));
        builder.header("Authorization", "Bearer " + token);
        HttpRequest request = builder.build();

        HttpResponse<String> response = HTTP.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 300) {
            return new Result(false, null, response.statusCode());
        }
        JsonNode payload = MAPPER.readTree(response.body());
        return new Result(true, payload.path("reservationId").asText(), response.statusCode());
    }
}
