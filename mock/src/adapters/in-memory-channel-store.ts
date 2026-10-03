import type { Ack, ChannelSession, ChannelStore, Delivery, Journal } from "../domain/ports.ts";

export class InMemoryChannelStore implements ChannelStore {
    private readonly sessions = new Map<string, ChannelSession>();
    private readonly deliveryLog = new Map<string, Delivery[]>();
    private readonly ackLog = new Map<string, Ack[]>();
    private readonly journal: Journal | null;

    constructor(journal: Journal | null = null) {
        this.journal = journal;
        for (const entry of journal?.replay() ?? []) {
            if (entry.kind === "session") this.sessions.set(entry.session.candidateId, entry.session);
            if (entry.kind === "delivery") this.push(this.deliveryLog, entry.delivery.candidateId, entry.delivery);
            if (entry.kind === "ack") this.push(this.ackLog, entry.ack.candidateId, entry.ack);
        }
    }

    session(candidateId: string): ChannelSession | null {
        return this.sessions.get(candidateId) ?? null;
    }

    start(session: ChannelSession): void {
        this.sessions.set(session.candidateId, session);
        this.journal?.append({ kind: "session", session });
    }

    deliveries(candidateId: string): readonly Delivery[] {
        return this.deliveryLog.get(candidateId) ?? [];
    }

    acks(candidateId: string): readonly Ack[] {
        return this.ackLog.get(candidateId) ?? [];
    }

    recordDelivery(delivery: Delivery): void {
        this.push(this.deliveryLog, delivery.candidateId, delivery);
        this.journal?.append({ kind: "delivery", delivery });
    }

    recordAck(ack: Ack): void {
        this.push(this.ackLog, ack.candidateId, ack);
        this.journal?.append({ kind: "ack", ack });
    }

    candidates(): readonly string[] {
        return [...this.sessions.keys()];
    }

    private push<T>(log: Map<string, T[]>, candidateId: string, item: T): void {
        const list = log.get(candidateId) ?? [];
        list.push(item);
        log.set(candidateId, list);
    }
}
