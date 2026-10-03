/**
 * The HTTP app: node's server, and the only file that knows what a socket is. Everything it does is
 * translate between the wire and a router, then hand the outcome to the log and the metrics.
 *
 * Three routers, picked by prefix. The provider and the authority are separate services in the real
 * world and the exercise treats them as such: one hands out guests, the other accepts declarations
 * and disagrees about how to spell them. The third is not part of that fiction at all: it hands out
 * the starting point, which is us talking to the candidate rather than the story talking to them.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { RequestLog, Telemetry } from "../../domain/ports.ts";
import type { Outgoing, Router } from "./router.ts";
import type { SesRouter } from "./ses-routes.ts";
import type { BasesRouter } from "./bases-routes.ts";
import type { PmsRouter } from "./pms-routes.ts";
import type { ChannelRouter } from "./channel-routes.ts";
import type { AdminRouter } from "./admin-routes.ts";
import type { Throttle } from "./throttle.ts";
import { withBasePath } from "./public-path.ts";

/** A body larger than this is refused unread: nothing legitimate here comes close. */
const MAX_BODY_BYTES = 1_000_000;

const bearer = (request: IncomingMessage): string | null => {
    const header = request.headers.authorization ?? "";
    const match = header.match(/^Bearer\s+(\S+)$/i);
    return match ? match[1] : null;
};

async function readBody(request: IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false }> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) return { ok: false };
        chunks.push(chunk as Buffer);
    }
    if (chunks.length === 0) return { ok: true, value: null };
    try {
        return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    } catch {
        return { ok: false };
    }
}

export function serve(
    router: Router,
    ses: SesRouter,
    bases: BasesRouter,
    pms: PmsRouter,
    channels: ChannelRouter,
    admin: AdminRouter,
    throttle: Throttle,
    log: RequestLog,
    telemetry: Telemetry,
    port: number,
    publicBasePath = "",
): Server {
    return createServer((request: IncomingMessage, response: ServerResponse) => {
        const startedAt = performance.now();
        const url = new URL(request.url ?? "/", `http://localhost:${port}`);
        const token = bearer(request);
        const method = request.method ?? "GET";

        const header = (name: string): string | null => {
            const value = request.headers[name.toLowerCase()];
            return typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? null) : null;
        };
        // A HEAD is a GET whose body is thrown away: same route, same status, same headers. The
        // router only knows about resources, so the distinction is resolved here; otherwise a
        // HEAD to a page answered `405` in JSON while the GET next to it served HTML.
        const asksForBody = method !== "HEAD";
        const incoming = {
            method: method === "HEAD" ? "GET" : method,
            path: url.pathname,
            query: url.searchParams,
            token,
            header,
        };

        const finish = (outcome: Outgoing) => {
            const durationMs = performance.now() - startedAt;

            // Two different things on purpose. The log is evaluation material: who did what, per
            // candidate. Telemetry is service health, plus a per-candidate metric of its own.
            telemetry.recordRequest({
                route: outcome.route,
                status: outcome.status,
                durationMs,
                candidate: outcome.candidate,
            });

            for (const occurrence of outcome.channel ?? []) {
                telemetry.recordChannel({ ...occurrence, candidate: outcome.candidate });
            }

            log.record({
                // The evaluator's token never goes to a log that candidates' lines share.
                token: url.pathname.startsWith("/admin") ? "evaluator" : (token ?? "-"),
                method,
                path: url.pathname,
                status: outcome.status,
                durationMs,
            });

            if (outcome.download) {
                const { filename, bytes, contentType } = outcome.download;
                response.writeHead(outcome.status, {
                    "content-type": contentType,
                    "content-length": bytes.byteLength,
                    // Without this the browser renders the archive instead of saving it.
                    "content-disposition": `attachment; filename="${filename}"`,
                });
                response.end(asksForBody ? Buffer.from(bytes) : undefined);
                return;
            }

            // A route that declares its own content type is not sending a resource: it is sending
            // a document, and JSON-encoding it would deliver a quoted string instead of a page.
            const isDocument = typeof outcome.body === "string" && outcome.headers?.["content-type"];
            // The links go out pointing at the public address, which is not always the root.
            const payload = isDocument
                ? (outcome.body as string)
                : JSON.stringify(withBasePath(outcome.body, publicBasePath), null, 2);
            response.writeHead(outcome.status, {
                "content-type": "application/json; charset=utf-8",
                "content-length": Buffer.byteLength(payload),
                ...outcome.headers,
            });
            // The length still describes the body that a GET would have returned, which is the
            // point of a HEAD.
            response.end(asksForBody ? payload : undefined);
        };

        const refused = throttle.refuse(incoming);
        if (refused) {
            // The body, if any, is never read. Draining it keeps the connection reusable instead of
            // leaving a half-read request on a socket the client will try again on.
            request.resume();
            finish(refused);
            return;
        }

        if (url.pathname === "/bases" || url.pathname.startsWith("/bases/")) {
            finish(bases.handle(incoming));
            return;
        }

        if (url.pathname === "/channels" || url.pathname.startsWith("/channels/")) {
            void readBody(request).then(() => finish(channels.handle(incoming)));
            return;
        }

        if (url.pathname === "/admin" || url.pathname.startsWith("/admin/")) {
            finish(admin.handle(incoming));
            return;
        }

        if (url.pathname === "/pms" || url.pathname.startsWith("/pms/")) {
            void readBody(request).then((body) => {
                if (!body.ok) {
                    finish({
                        status: 400,
                        body: { error: "invalid_body", message: "JSON is expected, and under 1 MB." },
                        route: "other",
                    });
                    return;
                }
                void pms.handle(incoming, body.value).then(finish);
            });
            return;
        }

        if (!url.pathname.startsWith("/ses")) {
            finish(router.handle(incoming));
            return;
        }

        // Only the authority takes a body, so only this branch pays for reading one.
        void readBody(request).then((body) => {
            if (!body.ok) {
                finish({
                    status: 400,
                    body: { error: "invalid_body", message: "JSON is expected, and under 1 MB." },
                    route: "other",
                });
                return;
            }
            finish(ses.handle(incoming, body.value));
        });
    });
}
