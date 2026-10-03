/**
 * What only the evaluator sees: how a candidate is doing, judged from our side. Unreachable with a
 * candidate's token by design, so the hosted systems cannot be used to read their own answer.
 */
import type { ChannelStore, Credentials, Reservations } from "../../domain/ports.ts";
import type { ChannelFeed } from "../../domain/channel-feed.ts";
import { buildReport } from "../../domain/report.ts";
import type { Incoming, Outgoing } from "./router.ts";

const REPORT = /^\/admin\/candidates\/([^/]+)\/report$/;
const REPORT_ROUTE = "/admin/candidates/{id}/report";
const LIST = "/admin/candidates";

export class AdminRouter {
    private readonly credentials: Credentials;
    private readonly evaluatorToken: string | null;
    private readonly feed: ChannelFeed;
    private readonly store: ChannelStore;
    private readonly reservations: Reservations;

    constructor(
        credentials: Credentials,
        evaluatorToken: string | null,
        feed: ChannelFeed,
        store: ChannelStore,
        reservations: Reservations,
    ) {
        this.credentials = credentials;
        this.evaluatorToken = evaluatorToken;
        this.feed = feed;
        this.store = store;
        this.reservations = reservations;
    }

    handle(request: Incoming): Outgoing {
        if (!this.evaluatorToken) {
            return { status: 404, body: { error: "not_found", path: request.path }, route: "other" };
        }
        if (request.token !== this.evaluatorToken) {
            const identity = this.credentials.check(request.token);
            return identity.known
                ? { status: 403, body: { error: "forbidden", message: "This is not for candidates." }, route: "other" }
                : {
                      status: 401,
                      body: { error: "unauthorized", message: "Send your token as `Authorization: Bearer <token>`." },
                      route: "other",
                  };
        }
        if (request.method !== "GET") {
            return { status: 405, body: { error: "method_not_allowed", allowed: ["GET"] }, route: "other" };
        }

        if (request.path === LIST) {
            const candidates = this.store.candidates().map((id) => ({
                candidateId: id,
                _links: { report: { href: `/admin/candidates/${id}/report` } },
            }));
            return { status: 200, body: { candidates }, route: LIST };
        }

        const match = REPORT.exec(request.path);
        if (!match) return { status: 404, body: { error: "not_found", path: request.path }, route: "other" };

        const candidateId = decodeURIComponent(match[1]);
        if (!this.store.session(candidateId)) {
            return { status: 404, body: { error: "candidate_has_no_session", candidateId }, route: REPORT_ROUTE };
        }
        return {
            status: 200,
            body: buildReport({
                candidateId,
                stream: this.feed.eventsOf(candidateId),
                deliveries: this.store.deliveries(candidateId),
                acks: this.store.acks(candidateId),
                received: this.reservations.list(candidateId),
                attempts: this.reservations.attempts(candidateId),
            }),
            route: REPORT_ROUTE,
        };
    }
}
