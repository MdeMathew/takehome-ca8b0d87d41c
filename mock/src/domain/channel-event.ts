import { generatorFor } from "./random.ts";

export type ChannelName = "booking" | "airbnb";

export interface ChannelEvent {
    readonly eventId: string;
    readonly channel: ChannelName;
    readonly bookingId: string;
    readonly offsetMs: number;
    readonly echoOf: string | null;
    readonly payload: Readonly<Record<string, unknown>>;
}

export interface SessionConfig {
    readonly eventCount: number;
    readonly intervalMs: number;
    readonly echoProbability: number;
    readonly echoGapMs: number;
}


const FIRST_NAMES = ["Alex", "Marta", "Jonas", "Ainhoa", "Liam", "Sofia", "Pablo", "Ines"];
const LAST_NAMES = ["Rivera", "Mendive", "Schmidt", "Dubois", "Novak", "Silva", "Olsen", "Rossi"];

const DAY_MS = 86_400_000;

const pick = <T>(items: readonly T[], roll: number): T => items[Math.floor(roll * items.length) % items.length];

const isoDate = (milliseconds: number): string => new Date(milliseconds).toISOString().slice(0, 10);

function payloadFor(
    channel: ChannelName,
    bookingId: string,
    baseDate: string,
    random: () => number,
): Readonly<Record<string, unknown>> {
    const first = pick(FIRST_NAMES, random());
    const last = pick(LAST_NAMES, random());
    const checkIn = Date.parse(`${baseDate}T00:00:00Z`) + (1 + Math.floor(random() * 20)) * DAY_MS;
    const checkOut = checkIn + (2 + Math.floor(random() * 6)) * DAY_MS;
    const totalPrice = Math.round((150 + random() * 750) * 100) / 100;

    if (channel === "airbnb") {
        return {
            channel,
            booking_id: bookingId,
            guest: { first_name: first, last_name: last },
            check_in: Math.floor(checkIn / 1000),
            check_out: Math.floor(checkOut / 1000),
            listing_id: `listing_${Math.floor(random() * 1e8).toString(16).padStart(8, "0")}`,
            total_price: totalPrice,
            currency: "EUR",
        };
    }
    return {
        channel,
        booking_id: bookingId,
        guest_name: `${first} ${last}`,
        check_in: isoDate(checkIn),
        check_out: isoDate(checkOut),
        property_id: `prop_${Math.floor(random() * 1e8).toString(16).padStart(8, "0")}`,
        total_price: totalPrice,
        currency: "EUR",
    };
}

/**
 * The whole stream a candidate will be offered, decided up front from the seed. Nothing here reads a
 * clock: an event has an offset from the moment the session started, so the same seed always yields
 * the same stream and a restart cannot change it.
 */
export function generateSession(seed: string, baseDate: string, config: SessionConfig): readonly ChannelEvent[] {
    const random = generatorFor(seed);
    const events: ChannelEvent[] = [];
    let sequence = 0;
    let slot = 0;

    while (events.length < config.eventCount) {
        const channel: ChannelName = random() < 0.5 ? "booking" : "airbnb";
        const bookingId = `${channel}_${Math.floor(random() * 1e10).toString(16).padStart(10, "0")}`;
        const offsetMs = slot * config.intervalMs;
        slot += 1;

        sequence += 1;
        events.push({
            eventId: `ev-${String(sequence).padStart(3, "0")}`,
            channel,
            bookingId,
            offsetMs,
            echoOf: null,
            payload: payloadFor(channel, bookingId, baseDate, random),
        });

        if (events.length < config.eventCount && random() < config.echoProbability) {
            sequence += 1;
            events.push({
                eventId: `ev-${String(sequence).padStart(3, "0")}`,
                channel,
                bookingId,
                offsetMs: offsetMs + config.echoGapMs,
                echoOf: events[events.length - 1].eventId,
                payload: events[events.length - 1].payload,
            });
        }
    }
    return events;
}
