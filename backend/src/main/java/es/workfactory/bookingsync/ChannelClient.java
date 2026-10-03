package es.workfactory.bookingsync;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * The two calls to the sales channels. They are written, and each one is written for a single
 * attempt: nothing here loops, waits or decides what to do with what it gets. Read them before you
 * build on them: what is missing is not marked with a TODO.
 */
public final class ChannelClient {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .version(HttpClient.Version.HTTP_1_1)
            .build();

    private ChannelClient() {}

    /** payload is what the channel sent, exactly as it sent it. */
    public record ChannelEvent(String eventId, String channel, int deliveryAttempt, JsonNode payload) {}

    public record EventsPage(List<ChannelEvent> events, boolean done) {}

    public record Acknowledgement(boolean ok, int status) {}

    private static HttpRequest.Builder call(String path) {
        return HttpRequest.newBuilder(URI.create(Env.optional("API_BASE", "http://localhost:4000") + path))
                .timeout(Duration.ofSeconds(15))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + Env.optional("API_TOKEN", "wf_local"));
    }

    public static EventsPage fetchEvents(int limit) throws Exception {
        HttpResponse<String> response =
                HTTP.send(call("/channels/events?limit=" + limit).GET().build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            throw new IllegalStateException("The channel answered " + response.statusCode());
        }
        JsonNode body = MAPPER.readTree(response.body());
        List<ChannelEvent> events = new ArrayList<>();
        for (JsonNode item : body.path("events")) {
            events.add(new ChannelEvent(
                    item.path("eventId").asText(),
                    item.path("channel").asText(),
                    item.path("deliveryAttempt").asInt(),
                    item.path("payload")));
        }
        return new EventsPage(events, body.path("done").asBoolean());
    }

    public static Acknowledgement ackEvent(String eventId) throws Exception {
        HttpResponse<String> response = HTTP.send(
                call("/channels/events/" + eventId + "/ack").POST(HttpRequest.BodyPublishers.noBody()).build(),
                HttpResponse.BodyHandlers.ofString());
        return new Acknowledgement(response.statusCode() < 300, response.statusCode());
    }
}
