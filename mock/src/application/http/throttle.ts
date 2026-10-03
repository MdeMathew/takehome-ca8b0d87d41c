/**
 * The authority pushing back.
 *
 * It sits in front of every router rather than inside one, because a limit that only covered the
 * declarations would let a loop over the guest pages hammer the service just as hard. The identity
 * is checked here as well as in the router: an HMAC is cheap, and the alternative is threading a
 * half-resolved identity through the transport, which is a worse trade than one extra hash.
 *
 * Nobody without a token is throttled. They get their 401 from the router, and a refusal that says
 * "too many" to someone who never authenticated tells them something about other people's traffic.
 */
import type { Credentials, RateLimiter } from "../../domain/ports.ts";
import type { Incoming, Outgoing } from "./router.ts";

export class Throttle {
    private readonly credentials: Credentials;
    private readonly limiter: RateLimiter;
    private readonly now: () => Date;

    constructor(credentials: Credentials, limiter: RateLimiter, now: () => Date = () => new Date()) {
        this.credentials = credentials;
        this.limiter = limiter;
        this.now = now;
    }

    /** The refusal, or null when the call goes through. */
    refuse(request: Incoming): Outgoing | null {
        const identity = this.credentials.check(request.token);
        if (!identity.known) return null;

        const verdict = this.limiter.admit(identity.candidateId, this.now());
        if (verdict.allowed) return null;

        return {
            status: 429,
            body: {
                error: "too_many_requests",
                message: `Too many requests. Try again in ${verdict.retryAfterSeconds} s.`,
                retryAfterSeconds: verdict.retryAfterSeconds,
            },
            // The standard header, so a client that already knows how to wait does not need to read
            // the body to find out how long.
            headers: { "retry-after": String(verdict.retryAfterSeconds) },
            route: "other",
            candidate: identity.attributable ? identity.candidateId : undefined,
        };
    }
}
