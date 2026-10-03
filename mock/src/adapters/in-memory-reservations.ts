import type { Journal, PmsAttempt, Received, Reservations } from "../domain/ports.ts";

const PER_CANDIDATE_LIMIT = 500;

export class InMemoryReservations implements Reservations {
    private readonly byCandidate = new Map<string, Received[]>();
    private readonly attemptsByCandidate = new Map<string, PmsAttempt[]>();
    private readonly journal: Journal | null;

    constructor(journal: Journal | null = null) {
        this.journal = journal;
        for (const entry of journal?.replay() ?? []) {
            if (entry.kind === "reservation") this.keep(entry.received);
            if (entry.kind === "attempt") this.keepAttempt(entry.attempt);
        }
    }

    record(received: Received): void {
        this.keep(received);
        this.journal?.append({ kind: "reservation", received });
    }

    noteAttempt(attempt: PmsAttempt): void {
        this.keepAttempt(attempt);
        this.journal?.append({ kind: "attempt", attempt });
    }

    attempts(candidateId: string): readonly PmsAttempt[] {
        return this.attemptsByCandidate.get(candidateId) ?? [];
    }

    find(candidateId: string, id: string): Received | null {
        return this.byCandidate.get(candidateId)?.find((received) => received.id === id) ?? null;
    }

    list(candidateId: string): readonly Received[] {
        return [...(this.byCandidate.get(candidateId) ?? [])].reverse();
    }

    countForBooking(candidateId: string, bookingId: string): number {
        return (this.byCandidate.get(candidateId) ?? []).filter(
            (received) => received.reservation.bookingId === bookingId,
        ).length;
    }

    private keep(received: Received): void {
        const theirs = this.byCandidate.get(received.candidateId) ?? [];
        theirs.push(received);
        while (theirs.length > PER_CANDIDATE_LIMIT) theirs.shift();
        this.byCandidate.set(received.candidateId, theirs);
    }

    private keepAttempt(attempt: PmsAttempt): void {
        const theirs = this.attemptsByCandidate.get(attempt.candidateId) ?? [];
        theirs.push(attempt);
        while (theirs.length > PER_CANDIDATE_LIMIT * 4) theirs.shift();
        this.attemptsByCandidate.set(attempt.candidateId, theirs);
    }
}
