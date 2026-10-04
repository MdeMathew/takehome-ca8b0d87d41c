package es.workfactory.bookingsync.channel;

public record Acknowledgement(boolean ok, int status) {}
