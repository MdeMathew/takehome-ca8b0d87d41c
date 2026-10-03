package es.workfactory.bookingsync.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

/** This one passes from the very first moment: it is your harness, so you do not start from zero. */
class DatesTest {

    @Test
    void unixTimestampSurvivesTimeZones() {
        assertEquals("2025-10-01", Dates.toIsoDate(1759276800));
        assertEquals("1970-01-01", Dates.toIsoDate(0));
    }
}
