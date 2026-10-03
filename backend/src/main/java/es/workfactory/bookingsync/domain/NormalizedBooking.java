package es.workfactory.bookingsync.domain;

/**
 * The shape everything else here uses. The two channels are documented in the brief; how you
 * get from one of their payloads to this shape is not written anywhere, which is your job.
 */
public record NormalizedBooking(
        String id,
        String channel,
        String guestName,
        String checkIn, // YYYY-MM-DD, always, regardless of channel
        String checkOut,
        double totalPrice,
        String currency) {
}
