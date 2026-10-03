package es.workfactory.bookingsync.domain;

import java.time.Instant;

/**
 * A booking plus where it stands with the PMS. Mutable on purpose: the same record gets marked
 * syncing, retrying, synced or failed as the attempts happen.
 */
public final class BookingRecord {

    private final String id;
    private final String channel;
    private final String guestName;
    private final String checkIn;
    private final String checkOut;
    private final double totalPrice;
    private final String currency;

    private volatile String status;
    private volatile int attempts;
    private volatile String lastError;
    private volatile String pmsReference;
    private volatile String updatedAt;

    public BookingRecord(NormalizedBooking booking, String status, int attempts) {
        this.id = booking.id();
        this.channel = booking.channel();
        this.guestName = booking.guestName();
        this.checkIn = booking.checkIn();
        this.checkOut = booking.checkOut();
        this.totalPrice = booking.totalPrice();
        this.currency = booking.currency();
        this.status = status;
        this.attempts = attempts;
        this.updatedAt = Instant.now().toString();
    }

    public NormalizedBooking toNormalizedBooking() {
        return new NormalizedBooking(id, channel, guestName, checkIn, checkOut, totalPrice, currency);
    }

    public void markStatus(String status, int attempts, String lastError, String pmsReference) {
        this.status = status;
        this.attempts = attempts;
        if (lastError != null) this.lastError = lastError;
        if (pmsReference != null) this.pmsReference = pmsReference;
        this.updatedAt = Instant.now().toString();
    }

    public String getId() { return id; }
    public String getChannel() { return channel; }
    public String getGuestName() { return guestName; }
    public String getCheckIn() { return checkIn; }
    public String getCheckOut() { return checkOut; }
    public double getTotalPrice() { return totalPrice; }
    public String getCurrency() { return currency; }
    public String getStatus() { return status; }
    public int getAttempts() { return attempts; }
    public String getLastError() { return lastError; }
    public String getPmsReference() { return pmsReference; }
    public String getUpdatedAt() { return updatedAt; }
}
