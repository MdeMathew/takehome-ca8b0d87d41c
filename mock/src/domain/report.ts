import type { ChannelEvent } from "./channel-event.ts";
import type { Ack, Delivery, PmsAttempt, Received } from "./ports.ts";
import type { Reservation } from "./reservation.ts";

export interface Mismatch {
    readonly bookingId: string;
    readonly field: string;
    readonly expected: unknown;
    readonly actual: unknown;
}

const dayOf = (unixSeconds: number): string => new Date(unixSeconds * 1000).toISOString().slice(0, 10);

/** The answer key: what a correct normalization of this event looks like. */
export function expectedReservation(event: ChannelEvent): Reservation {
    const raw = event.payload as Record<string, unknown>;
    if (event.channel === "airbnb") {
        const guest = raw.guest as { first_name: string; last_name: string };
        return {
            bookingId: event.bookingId,
            channel: "airbnb",
            guestName: `${guest.first_name} ${guest.last_name}`,
            checkIn: dayOf(raw.check_in as number),
            checkOut: dayOf(raw.check_out as number),
            totalPrice: raw.total_price as number,
            currency: raw.currency as string,
        };
    }
    return {
        bookingId: event.bookingId,
        channel: "booking",
        guestName: raw.guest_name as string,
        checkIn: raw.check_in as string,
        checkOut: raw.check_out as string,
        totalPrice: raw.total_price as number,
        currency: raw.currency as string,
    };
}

const percentile = (sorted: readonly number[], fraction: number): number | null => {
    if (sorted.length === 0) return null;
    return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
};

export interface Report {
    readonly candidateId: string;
    /** True once every event of the stream was confirmed in time. */
    readonly complete: boolean;
    /** Reservations the PMS holds that are not the correct normalization of what the channel sent. */
    readonly mismatches: readonly Mismatch[];
    readonly emitted: readonly string[];
    readonly receivedByPms: readonly string[];
    readonly missing: readonly string[];
    readonly duplicatesInPms: readonly { readonly bookingId: string; readonly receptions: number }[];
    readonly channel: {
        readonly eventsInStream: number;
        readonly deliveries: number;
        readonly redeliveries: number;
        readonly acks: number;
        readonly lateAcks: number;
        readonly ackLatencyMs: { readonly p50: number | null; readonly p95: number | null; readonly max: number | null };
    };
    readonly pms: { readonly attempts: number; readonly failures: number; readonly accepted: number };
}

/** What was emitted against what the PMS ended up holding. Pure: it reads nothing, it compares. */
export function buildReport(input: {
    readonly candidateId: string;
    readonly stream: readonly ChannelEvent[];
    readonly deliveries: readonly Delivery[];
    readonly acks: readonly Ack[];
    readonly received: readonly Received[];
    readonly attempts: readonly PmsAttempt[];
}): Report {
    const emitted = [...new Set(input.stream.map((event) => event.bookingId))];
    const counts = new Map<string, number>();
    for (const item of input.received) {
        counts.set(item.reservation.bookingId, (counts.get(item.reservation.bookingId) ?? 0) + 1);
    }
    const latencies = input.acks.map((ack) => ack.latencyMs).sort((a, b) => a - b);

    const settled = new Set(input.acks.filter((ack) => ack.withinBudget).map((ack) => ack.eventId));
    const expectedByBooking = new Map<string, Reservation>();
    for (const event of input.stream) {
        if (!expectedByBooking.has(event.bookingId)) expectedByBooking.set(event.bookingId, expectedReservation(event));
    }
    const mismatches: Mismatch[] = [];
    for (const item of input.received) {
        const expected = expectedByBooking.get(item.reservation.bookingId);
        if (!expected) continue;
        for (const field of ["channel", "guestName", "checkIn", "checkOut", "totalPrice", "currency"] as const) {
            if (item.reservation[field] !== expected[field]) {
                mismatches.push({
                    bookingId: expected.bookingId,
                    field,
                    expected: expected[field],
                    actual: item.reservation[field],
                });
            }
        }
    }

    return {
        candidateId: input.candidateId,
        complete: input.stream.length > 0 && input.stream.every((event) => settled.has(event.eventId)),
        mismatches,
        emitted,
        receivedByPms: [...counts.keys()],
        missing: emitted.filter((bookingId) => !counts.has(bookingId)),
        duplicatesInPms: [...counts.entries()]
            .filter(([, receptions]) => receptions > 1)
            .map(([bookingId, receptions]) => ({ bookingId, receptions })),
        channel: {
            eventsInStream: input.stream.length,
            deliveries: input.deliveries.length,
            redeliveries: input.deliveries.filter((delivery) => delivery.attempt > 1).length,
            acks: input.acks.filter((ack) => ack.withinBudget).length,
            lateAcks: input.acks.filter((ack) => !ack.withinBudget).length,
            ackLatencyMs: {
                p50: percentile(latencies, 0.5),
                p95: percentile(latencies, 0.95),
                max: latencies.at(-1) ?? null,
            },
        },
        pms: {
            attempts: input.attempts.length,
            failures: input.attempts.filter((attempt) => !attempt.ok).length,
            accepted: input.attempts.filter((attempt) => attempt.ok).length,
        },
    };
}
