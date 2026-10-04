package es.workfactory.bookingsync.channel;

import com.fasterxml.jackson.databind.JsonNode;

/** payload is what the channel sent, exactly as it sent it. */
public record ChannelEvent(String eventId, String channel, int deliveryAttempt, JsonNode payload) {}
