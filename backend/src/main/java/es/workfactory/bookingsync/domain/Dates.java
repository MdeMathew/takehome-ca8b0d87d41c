package es.workfactory.bookingsync.domain;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;

public final class Dates {

    private Dates() {}

    /**
     * Unix seconds to YYYY-MM-DD, in UTC. It comes solved, and solved this way on purpose: with
     * LocalDate and a time zone in the middle, the same instant lands on a different calendar
     * day depending on the machine's time zone, and the airbnb channel sends exactly this kind
     * of timestamp.
     */
    public static String toIsoDate(long unixSeconds) {
        return DateTimeFormatter.ISO_LOCAL_DATE.format(Instant.ofEpochSecond(unixSeconds).atZone(ZoneOffset.UTC));
    }
}
