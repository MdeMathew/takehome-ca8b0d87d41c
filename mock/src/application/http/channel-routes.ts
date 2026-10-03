/**
 * The sales channels, from the candidate's side. Nothing is pushed to them: they ask for what has
 * come due and confirm what they received, and the clock that judges them runs on our side.
 */
import type { Credentials } from "../../domain/ports.ts";
import type { ChannelFeed } from "../../domain/channel-feed.ts";
import type { Incoming, Outgoing } from "./router.ts";

const EVENTS = "/channels/events";
const ACK = /^\/channels\/events\/([^/]+)\/ack$/;
const POLL_ROUTE = "GET /channels/events";
const ACK_ROUTE = "POST /channels/events/{id}/ack";
const MAX_LIMIT = 10;

export class ChannelRouter {
    private readonly credentials: Credentials;
    private readonly feed: ChannelFeed;
    private readonly now: () => number;

    constructor(credentials: Credentials, feed: ChannelFeed, now: () => number = Date.now) {
        this.credentials = credentials;
        this.feed = feed;
        this.now = now;
    }

    handle(request: Incoming): Outgoing {
        const identity = this.credentials.check(request.token);
        if (!identity.known) {
            return {
                status: 401,
                body: { error: "unauthorized", message: "Send your token as `Authorization: Bearer <token>`." },
                route: "other",
            };
        }
        const stamp = (outcome: Outgoing): Outgoing =>
            identity.attributable ? { ...outcome, candidate: identity.candidateId } : outcome;

        if (request.path === EVENTS && request.method === "GET") {
            return stamp(this.poll(identity.candidateId, request.query));
        }

        const ack = ACK.exec(request.path);
        if (ack && request.method === "POST") return stamp(this.acknowledge(identity.candidateId, ack[1]));

        if (request.path === EVENTS || ack) {
            return stamp({
                status: 405,
                body: { error: "method_not_allowed", allowed: ack ? ["POST"] : ["GET"] },
                route: ack ? ACK_ROUTE : POLL_ROUTE,
            });
        }
        return stamp({ status: 404, body: { error: "not_found", path: request.path }, route: "other" });
    }

    private poll(candidateId: string, query: URLSearchParams): Outgoing {
        const asked = Number.parseInt(query.get("limit") ?? "1", 10);
        const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(asked) ? asked : 1));
        const { events, done } = this.feed.poll(candidateId, this.now(), limit);

        return {
            status: 200,
            body: {
                events: events.map(({ event, attempt }) => ({
                    eventId: event.eventId,
                    channel: event.channel,
                    deliveryAttempt: attempt,
                    payload: event.payload,
                    _links: { ack: { href: `${EVENTS}/${event.eventId}/ack` } },
                })),
                done,
                _links: { self: { href: EVENTS } },
            },
            route: POLL_ROUTE,
            channel: events.map(({ attempt }) => ({ event: attempt > 1 ? "redelivered" : "delivered" })),
        };
    }

    private acknowledge(candidateId: string, eventId: string): Outgoing {
        const outcome = this.feed.acknowledge(candidateId, eventId, this.now());

        switch (outcome.kind) {
            case "acknowledged":
                return {
                    status: 200,
                    body: { eventId, acknowledged: true, latencyMs: outcome.latencyMs },
                    route: ACK_ROUTE,
                    channel: [{ event: "acked", latencyMs: outcome.latencyMs }],
                };
            case "already_acknowledged":
                return { status: 200, body: { eventId, acknowledged: true, alreadyAcknowledged: true }, route: ACK_ROUTE };
            case "late":
                return {
                    status: 409,
                    body: {
                        error: "ack_too_late",
                        eventId,
                        message: "The channel stopped waiting and will deliver this event again.",
                    },
                    route: ACK_ROUTE,
                    channel: [{ event: "late_ack", latencyMs: outcome.latencyMs }],
                };
            case "not_delivered":
                return {
                    status: 409,
                    body: { error: "event_not_delivered", eventId, message: "That event was never delivered to you." },
                    route: ACK_ROUTE,
                };
            default:
                return { status: 404, body: { error: "event_not_found", eventId }, route: ACK_ROUTE };
        }
    }
}
