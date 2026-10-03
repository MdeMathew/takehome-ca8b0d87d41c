import { generateSession, type ChannelEvent, type SessionConfig } from "./channel-event.ts";
import type { ChannelStore } from "./ports.ts";

export interface FeedConfig extends SessionConfig {
    readonly ackBudgetMs: number;
}

export interface Delivered {
    readonly event: ChannelEvent;
    readonly attempt: number;
}

export type AckOutcome =
    | { readonly kind: "acknowledged"; readonly latencyMs: number }
    | { readonly kind: "already_acknowledged" }
    | { readonly kind: "late"; readonly latencyMs: number }
    | { readonly kind: "unknown_event" }
    | { readonly kind: "not_delivered" }
    | { readonly kind: "no_session" };

/**
 * The channels, seen from the candidate's side: events come due over time, each delivery starts a
 * clock, and an event that is not confirmed inside it comes back. There is no callback to a
 * candidate's machine anywhere: they ask, and we measure.
 */
export class ChannelFeed {
    private readonly store: ChannelStore;
    private readonly config: FeedConfig;
    private readonly newSeed: (candidateId: string) => string;
    private readonly today: () => string;
    private readonly streams = new Map<string, readonly ChannelEvent[]>();

    constructor(
        store: ChannelStore,
        config: FeedConfig,
        newSeed: (candidateId: string) => string,
        today: () => string,
    ) {
        this.store = store;
        this.config = config;
        this.newSeed = newSeed;
        this.today = today;
    }

    eventsOf(candidateId: string): readonly ChannelEvent[] {
        const session = this.store.session(candidateId);
        if (!session) return [];
        let stream = this.streams.get(candidateId);
        if (!stream) {
            stream = generateSession(session.seed, session.baseDate, this.config);
            this.streams.set(candidateId, stream);
        }
        return stream;
    }

    poll(candidateId: string, now: number, limit: number): { events: readonly Delivered[]; done: boolean } {
        if (!this.store.session(candidateId)) {
            this.store.start({ candidateId, startedAt: now, seed: this.newSeed(candidateId), baseDate: this.today() });
        }
        const session = this.store.session(candidateId)!;
        const stream = this.eventsOf(candidateId);

        const acked = new Set(this.store.acks(candidateId).filter((ack) => ack.withinBudget).map((ack) => ack.eventId));
        const lastDelivery = new Map<string, { at: number; attempt: number }>();
        for (const delivery of this.store.deliveries(candidateId)) {
            lastDelivery.set(delivery.eventId, { at: delivery.at, attempt: delivery.attempt });
        }

        const out: Delivered[] = [];
        for (const event of stream) {
            if (out.length >= limit) break;
            if (session.startedAt + event.offsetMs > now) continue;
            if (acked.has(event.eventId)) continue;
            const last = lastDelivery.get(event.eventId);
            if (last && now - last.at <= this.config.ackBudgetMs) continue;

            const attempt = (last?.attempt ?? 0) + 1;
            this.store.recordDelivery({ candidateId, eventId: event.eventId, at: now, attempt });
            out.push({ event, attempt });
        }

        return { events: out, done: stream.every((event) => acked.has(event.eventId)) };
    }

    acknowledge(candidateId: string, eventId: string, now: number): AckOutcome {
        if (!this.store.session(candidateId)) return { kind: "no_session" };
        if (!this.eventsOf(candidateId).some((event) => event.eventId === eventId)) return { kind: "unknown_event" };

        if (this.store.acks(candidateId).some((ack) => ack.eventId === eventId && ack.withinBudget)) {
            return { kind: "already_acknowledged" };
        }

        const deliveries = this.store.deliveries(candidateId).filter((delivery) => delivery.eventId === eventId);
        const last = deliveries[deliveries.length - 1];
        if (!last) return { kind: "not_delivered" };

        const latencyMs = now - last.at;
        const withinBudget = latencyMs <= this.config.ackBudgetMs;
        this.store.recordAck({ candidateId, eventId, at: now, latencyMs, withinBudget });
        return withinBudget ? { kind: "acknowledged", latencyMs } : { kind: "late", latencyMs };
    }
}
