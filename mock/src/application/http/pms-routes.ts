/**
 * The PMS: the legacy system the candidate's service forwards bookings to.
 *
 * It is slow, it fails now and then, and it does NOT deduplicate. Receiving the same booking twice
 * files it twice, and the response says so. Not filing it twice is the caller's job.
 */
import type { Credentials, Identity, PmsBehaviour, Reservations } from "../../domain/ports.ts";
import { validateReservation, type Received } from "../../domain/reservation.ts";
import type { Incoming, Outgoing } from "./router.ts";

const COLLECTION = "/pms/reservations";
const ITEM = /^\/pms\/reservations\/([^/]+)$/;
const ITEM_ROUTE = "/pms/reservations/{id}";
const RECEIVE_ROUTE = "POST /pms/reservations";
const LIST_ROUTE = "GET /pms/reservations";
const PAGE_SIZE = 20;
const RETRY_AFTER_SECONDS = 2;

const DUPLICATE_WARNING =
    "This booking has already been received. The PMS files every reception, so it now holds several " +
    "copies. Make sure the same booking is never sent twice.";

const resource = (received: Received, receptions: number) => ({
    reservationId: received.id,
    bookingId: received.reservation.bookingId,
    channel: received.reservation.channel,
    guestName: received.reservation.guestName,
    checkIn: received.reservation.checkIn,
    checkOut: received.reservation.checkOut,
    totalPrice: received.reservation.totalPrice,
    currency: received.reservation.currency,
    receivedAt: new Date(received.receivedAt).toISOString(),
    receptionsForBooking: receptions,
    _links: { self: { href: `${COLLECTION}/${received.id}` } },
});

export class PmsRouter {
    private sequence = 0;
    private readonly credentials: Credentials;
    private readonly reservations: Reservations;
    private readonly behaviour: PmsBehaviour;
    private readonly sleep: (milliseconds: number) => Promise<void>;
    private readonly now: () => number;

    constructor(
        credentials: Credentials,
        reservations: Reservations,
        behaviour: PmsBehaviour,
        sleep: (milliseconds: number) => Promise<void> = (milliseconds) =>
            new Promise((resolve) => setTimeout(resolve, milliseconds)),
        now: () => number = Date.now,
    ) {
        this.credentials = credentials;
        this.reservations = reservations;
        this.behaviour = behaviour;
        this.sleep = sleep;
        this.now = now;
    }

    async handle(request: Incoming, body: unknown): Promise<Outgoing> {
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

        if (request.path === COLLECTION && request.method === "POST") {
            return stamp(await this.receive(identity, body));
        }
        if (request.path === COLLECTION && request.method === "GET") {
            return stamp(this.list(identity, request.query));
        }
        const item = ITEM.exec(request.path);
        if (item && request.method === "GET") return stamp(this.read(identity, item[1]));

        if (request.path === COLLECTION || item) {
            return stamp({
                status: 405,
                body: { error: "method_not_allowed", allowed: request.path === COLLECTION ? ["GET", "POST"] : ["GET"] },
                route: item ? ITEM_ROUTE : COLLECTION,
            });
        }
        return stamp({ status: 404, body: { error: "not_found", path: request.path }, route: "other" });
    }

    private async receive(identity: Identity & { known: true }, body: unknown): Promise<Outgoing> {
        const checked = validateReservation(body);
        if (!checked.valid) {
            return {
                status: 422,
                body: { error: "invalid_reservation", invalid: checked.invalid },
                route: RECEIVE_ROUTE,
            };
        }

        await this.sleep(this.behaviour.delayMs(identity.candidateId));

        const failed = this.behaviour.shouldFail(identity.candidateId);
        this.reservations.noteAttempt({
            candidateId: identity.candidateId,
            bookingId: checked.reservation.bookingId,
            at: this.now(),
            ok: !failed,
        });

        if (failed) {
            return {
                status: 500,
                body: {
                    error: "pms_unavailable",
                    message: "The PMS is saturated. Try again later.",
                    retryAfterSeconds: RETRY_AFTER_SECONDS,
                },
                headers: { "retry-after": String(RETRY_AFTER_SECONDS) },
                route: RECEIVE_ROUTE,
            };
        }

        this.sequence += 1;
        const received: Received = {
            id: `pms-${this.sequence.toString(16).padStart(5, "0")}${Math.random().toString(16).slice(2, 6)}`,
            candidateId: identity.candidateId,
            receivedAt: this.now(),
            reservation: checked.reservation,
        };
        this.reservations.record(received);
        const receptions = this.reservations.countForBooking(identity.candidateId, checked.reservation.bookingId);

        return {
            status: 201,
            body: {
                ...resource(received, receptions),
                ...(receptions > 1 ? { warning: DUPLICATE_WARNING } : {}),
            },
            headers: { location: `${COLLECTION}/${received.id}` },
            route: RECEIVE_ROUTE,
        };
    }

    private list(identity: Identity & { known: true }, query: URLSearchParams): Outgoing {
        const page = Math.max(1, Number.parseInt(query.get("page") ?? "1", 10) || 1);
        const all = this.reservations.list(identity.candidateId);
        const items = all
            .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
            .map((received) =>
                resource(received, this.reservations.countForBooking(identity.candidateId, received.reservation.bookingId)),
            );
        const hasNext = page * PAGE_SIZE < all.length;

        return {
            status: 200,
            body: {
                page,
                pageSize: PAGE_SIZE,
                total: all.length,
                items,
                _links: {
                    self: { href: `${COLLECTION}?page=${page}` },
                    ...(hasNext ? { next: { href: `${COLLECTION}?page=${page + 1}` } } : {}),
                },
            },
            route: LIST_ROUTE,
        };
    }

    private read(identity: Identity & { known: true }, id: string): Outgoing {
        const received = this.reservations.find(identity.candidateId, id);
        if (!received) return { status: 404, body: { error: "reservation_not_found", id }, route: ITEM_ROUTE };
        return {
            status: 200,
            body: resource(
                received,
                this.reservations.countForBooking(identity.candidateId, received.reservation.bookingId),
            ),
            route: ITEM_ROUTE,
        };
    }
}
