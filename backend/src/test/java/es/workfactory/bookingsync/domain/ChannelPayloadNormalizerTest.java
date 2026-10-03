package es.workfactory.bookingsync.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.ObjectMapper;
import es.workfactory.bookingsync.domain.payload_normalize.ChannelPayloadNormalizer;
import org.junit.jupiter.api.Test;

class ChannelPayloadNormalizerTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void normalizesBookingPayload() throws Exception {
        var raw = MAPPER.readTree("""
                {"channel":"booking","booking_id":"booking_42","guest_name":"Ada Lovelace",
                 "check_in":"2025-10-01","check_out":"2025-10-04",
                 "total_price":320.75,"currency":"EUR","property_id":"ignored"}
                """);

        assertEquals(new NormalizedBooking(
                "booking_42", "booking", "Ada Lovelace", "2025-10-01", "2025-10-04", 320.75, "EUR"),
                ChannelPayloadNormalizer.normalize(raw));
    }

    @Test
    void normalizesAirbnbSecondsInUtc() throws Exception {
        var raw = MAPPER.readTree("""
                {"channel":"airbnb","booking_id":"airbnb_42",
                 "guest":{"first_name":"Ada","last_name":"Lovelace"},
                 "check_in":1759276800,"check_out":1759536000,
                 "total_price":320.75,"currency":"EUR","listing_id":"ignored"}
                """);

        assertEquals(new NormalizedBooking(
                "airbnb_42", "airbnb", "Ada Lovelace", "2025-10-01", "2025-10-04", 320.75, "EUR"),
                ChannelPayloadNormalizer.normalize(raw));
    }

    @Test
    void rejectsMissingRequiredFieldInsteadOfSilentlyDefaulting() throws Exception {
        var raw = MAPPER.readTree("""
                {"channel":"booking","booking_id":"booking_42","guest_name":"Ada Lovelace",
                 "check_in":"2025-10-01","check_out":"2025-10-04","currency":"EUR"}
                """);

        assertThrows(IllegalArgumentException.class, () -> ChannelPayloadNormalizer.normalize(raw));
    }
}
