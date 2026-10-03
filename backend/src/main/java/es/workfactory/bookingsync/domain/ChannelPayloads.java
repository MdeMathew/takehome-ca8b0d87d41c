package es.workfactory.bookingsync.domain;

import com.fasterxml.jackson.databind.JsonNode;

public final class ChannelPayloads {

    private ChannelPayloads() {}

    /**
     * YOUR JOB: turn whatever a channel sent into NormalizedBooking.
     *
     * "booking" sends check_in/check_out as YYYY-MM-DD strings and the guest as guest_name.
     * "airbnb" sends them as Unix seconds and the guest as guest.first_name + guest.last_name.
     * Both are real payloads the mock sends; nothing here is hidden, it just is not written yet.
     */
    public static NormalizedBooking normalize(JsonNode raw) {
        throw new UnsupportedOperationException("not implemented");
    }
}
