package es.workfactory.bookingsync.pms.client;

import es.workfactory.bookingsync.domain.NormalizedBooking;

public interface PmsClient {
    record Result(boolean ok, String pmsReference, int status) {}

    Result submit(NormalizedBooking booking) throws Exception;
}
