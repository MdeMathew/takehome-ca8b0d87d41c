package es.workfactory.bookingsync.domain.payload_normalize.normalizers;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;

final class PayloadFieldsChecker {
    private PayloadFieldsChecker() {}

    static String text(JsonNode raw, String field) {
        JsonNode value = raw.path(field);
        if (!value.isTextual() || value.asText().isBlank()) {
            throw new IllegalArgumentException(field + " must be non-empty text");
        }
        return value.asText().trim();
    }

    static String isoDate(JsonNode raw, String field) {
        String value = text(raw, field);
        try {
            return LocalDate.parse(value).toString();
        } catch (DateTimeParseException exception) {
            throw new IllegalArgumentException(field + " must be a YYYY-MM-DD date", exception);
        }
    }

    static long unixSeconds(JsonNode raw, String field) {
        JsonNode value = raw.path(field);
        if (!value.isIntegralNumber() || !value.canConvertToLong()) {
            throw new IllegalArgumentException(field + " must be Unix seconds");
        }
        return value.longValue();
    }

    static double price(JsonNode raw, String field) {
        JsonNode value = raw.path(field);
        if (!value.isNumber() || !Double.isFinite(value.doubleValue()) || value.doubleValue() < 0) {
            throw new IllegalArgumentException(field + " must be a non-negative number");
        }
        return value.doubleValue();
    }
}
