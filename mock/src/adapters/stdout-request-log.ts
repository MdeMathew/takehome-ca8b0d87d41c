/**
 * One JSON line per request on stdout, which is where the container collects it. No bodies: the
 * method, the path and the status already say whether the candidate explored, paginated and
 * retried, and keeping payloads would hold more of their data than we need.
 */
import type { RequestLog } from "../domain/ports.ts";

export class StdoutRequestLog implements RequestLog {
    private readonly now: () => string;

    constructor(now: () => string = () => new Date().toISOString()) {
        this.now = now;
    }

    record(entry: {
        token: string;
        method: string;
        path: string;
        status: number;
        durationMs: number;
    }): void {
        process.stdout.write(
            JSON.stringify({
                timestamp: this.now(),
                token: entry.token,
                method: entry.method,
                path: entry.path,
                status: entry.status,
                durationMs: Number(entry.durationMs.toFixed(1)),
            }) + "\n",
        );
    }
}
