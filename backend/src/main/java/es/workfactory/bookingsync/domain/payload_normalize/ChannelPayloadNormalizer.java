package es.workfactory.bookingsync.domain.payload_normalize;

import com.fasterxml.jackson.databind.JsonNode;
import es.workfactory.bookingsync.domain.NormalizedBooking;
import es.workfactory.bookingsync.domain.payload_normalize.normalizers.AirbnbPayloadNormalizer;
import es.workfactory.bookingsync.domain.payload_normalize.normalizers.BookingPayloadNormalizer;

public final class ChannelPayloadNormalizer {

    private ChannelPayloadNormalizer() {}

    /**
     * YOUR JOB: turn whatever a channel sent into NormalizedBooking.
     *
     * "booking" sends check_in/check_out as YYYY-MM-DD strings and the guest as guest_name.
     * "airbnb" sends them as Unix seconds and the guest as guest.first_name + guest.last_name.
     * Both are real payloads the mock sends; nothing here is hidden, it just is not written yet.
     */
    public static NormalizedBooking normalize(JsonNode raw) {
        return switch (raw.path("channel").asText()) {
            case "airbnb" -> AirbnbPayloadNormalizer.normalize(raw);
            case "booking" -> BookingPayloadNormalizer.normalize(raw);
            default -> throw new IllegalArgumentException("Event channel is not recognized");
        };
    }
}
