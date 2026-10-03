package es.workfactory.bookingsync;

import es.workfactory.bookingsync.domain.BookingRecord;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Where the state of each booking lives while the process is up. In memory, on purpose: the
 * brief does not ask for a database, and adding one would spend your time on plumbing instead of
 * on what this exercise is about.
 *
 * Written and complete. What you decide to call, and when, is what the exercise measures.
 */
public final class Store {

    private static final Map<String, BookingRecord> RECORDS = new ConcurrentHashMap<>();

    private Store() {}

    public static void upsert(BookingRecord record) {
        RECORDS.put(record.getId(), record);
    }

    public static Optional<BookingRecord> get(String id) {
        return Optional.ofNullable(RECORDS.get(id));
    }

    public static List<BookingRecord> list() {
        return RECORDS.values().stream()
                .sorted(Comparator.comparing(BookingRecord::getUpdatedAt).reversed())
                .toList();
    }

    /** Only for the check: starts every run from an empty store. */
    public static void clear() {
        RECORDS.clear();
    }
}
