package es.workfactory.bookingsync.channel;

import java.util.List;

public record EventsPage(List<ChannelEvent> events, boolean done) {}
