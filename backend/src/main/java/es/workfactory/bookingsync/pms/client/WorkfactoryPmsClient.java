package es.workfactory.bookingsync.pms.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import es.workfactory.bookingsync.Env;
import es.workfactory.bookingsync.domain.NormalizedBooking;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

/** Sends one booking per call; PmsRegisterer owns the queue and retry policy. */
public final class WorkfactoryPmsClient implements PmsClient {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .version(HttpClient.Version.HTTP_1_1)
            .build();

    private static final String DEFAULT_API_BASE = "http://localhost:4000";
    private static final String DEFAULT_API_TOKEN = "wf_local";
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(15);
    private final URI reservationsUri;
    private final String token;

    public WorkfactoryPmsClient() {
        String baseUri = Env.optional("API_BASE", DEFAULT_API_BASE);
        reservationsUri = URI.create(baseUri + "/pms/reservations");
        token = Env.optional("API_TOKEN", DEFAULT_API_TOKEN);
    }

    @Override
    public Result submit(NormalizedBooking booking) throws Exception {
        String body = MAPPER.writeValueAsString(Map.of(
                "bookingId", booking.id(),
                "channel", booking.channel(),
                "guestName", booking.guestName(),
                "checkIn", booking.checkIn(),
                "checkOut", booking.checkOut(),
                "totalPrice", booking.totalPrice(),
                "currency", booking.currency()));
        HttpRequest.Builder builder = HttpRequest.newBuilder(reservationsUri)
                .timeout(REQUEST_TIMEOUT)
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
