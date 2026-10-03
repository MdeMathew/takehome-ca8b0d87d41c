package es.workfactory.bookingsync.domain.payload_normalize.normalizers;

import com.fasterxml.jackson.databind.JsonNode;
import es.workfactory.bookingsync.domain.Dates;
import es.workfactory.bookingsync.domain.NormalizedBooking;

public final class AirbnbPayloadNormalizer {
    private AirbnbPayloadNormalizer() {}

    public static NormalizedBooking normalize(JsonNode raw) {
        JsonNode guest = raw.path("guest");
        return new NormalizedBooking(
                PayloadFieldsChecker.text(raw, "booking_id"),
                "airbnb",
                PayloadFieldsChecker.text(guest, "first_name") + " " + PayloadFieldsChecker.text(guest, "last_name"),
                Dates.toIsoDate(PayloadFieldsChecker.unixSeconds(raw, "check_in")),
                Dates.toIsoDate(PayloadFieldsChecker.unixSeconds(raw, "check_out")),
                PayloadFieldsChecker.price(raw, "total_price"),
                PayloadFieldsChecker.text(raw, "currency"));
    }
}
