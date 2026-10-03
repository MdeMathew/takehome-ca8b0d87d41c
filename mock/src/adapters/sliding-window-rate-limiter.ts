/**
 * How many calls a candidate gets, over a window that slides.
 *
 * Kept per candidate on purpose: one person hammering the service must never be the reason another
 * one gets refused. The window slides rather than resetting on the hour, so nobody can wait for a
 * boundary and dump a burst through it.
 *
 * The default is wide. Working through the exercise by hand never reaches it; polling a pending
 * batch in a closed loop reaches it in a second, which is the point.
 */
import type { RateLimiter } from "../domain/ports.ts";

export class SlidingWindowRateLimiter implements RateLimiter {
    private readonly callsByCandidate = new Map<string, number[]>();
    private readonly limit: number;
    private readonly windowMs: number;

    constructor(limit: number, windowMs: number) {
        this.limit = limit;
        this.windowMs = windowMs;
    }

    admit(candidateId: string, at: Date): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
        const now = at.getTime();
        const since = now - this.windowMs;

        const recent = (this.callsByCandidate.get(candidateId) ?? []).filter((moment) => moment > since);

        if (recent.length >= this.limit) {
            // The oldest call still inside the window is the one whose expiry frees a slot.
            const freesUpAt = recent[0] + this.windowMs;
            this.callsByCandidate.set(candidateId, recent);
            return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((freesUpAt - now) / 1000)) };
        }

        recent.push(now);
        this.callsByCandidate.set(candidateId, recent);
        return { allowed: true };
    }
}
