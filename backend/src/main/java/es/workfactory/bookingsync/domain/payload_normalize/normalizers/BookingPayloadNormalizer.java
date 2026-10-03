package es.workfactory.bookingsync.domain.payload_normalize.normalizers;

import com.fasterxml.jackson.databind.JsonNode;
import es.workfactory.bookingsync.domain.NormalizedBooking;

public final class BookingPayloadNormalizer {
    private BookingPayloadNormalizer() {}

    public static NormalizedBooking normalize(JsonNode raw) {
        return new NormalizedBooking(
                PayloadFieldsChecker.text(raw, "booking_id"),
                "booking",
                PayloadFieldsChecker.text(raw, "guest_name"),
                PayloadFieldsChecker.isoDate(raw, "check_in"),
                PayloadFieldsChecker.isoDate(raw, "check_out"),
                PayloadFieldsChecker.price(raw, "total_price"),
                PayloadFieldsChecker.text(raw, "currency"));
    }
}
