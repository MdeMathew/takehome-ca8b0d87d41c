/**
 * Pushes request counts and latencies to an OpenTelemetry collector over HTTP.
 *
 * Written by hand rather than with the SDK because this service has no runtime dependencies and it
 * is worth keeping that way: candidates read this code, and `npm install` in the image would be
 * fifteen megabytes and an install step for two metrics. The payload below is the whole of the OTLP
 * metrics protocol that two metrics need.
 *
 * Pushing rather than being scraped, because the collector's Prometheus is configured with static
 * targets: being scraped would mean editing shared monitoring config on the host, while pushing
 * needs nothing from anyone.
 *
 * What the names become on the other side, verified against the real collector: the unit is
 * appended and a histogram is split, so a dashboard queries these and not the names below:
 *
 *   mock_api_requests_total
 *   mock_api_request_duration_milliseconds_bucket / _sum / _count
 */
import type { Telemetry } from "../domain/ports.ts";

/** CUMULATIVE. Prometheus wants running totals, not per-window deltas. */
const CUMULATIVE = 2;

/** Milliseconds. Wide at the top because a slow request matters more than an exact figure. */
const LATENCY_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500];

interface Counters {
    readonly route: string;
    readonly status: number;
    count: number;
}

interface Latencies {
    readonly route: string;
    count: number;
    sum: number;
    readonly buckets: number[];
}

/** Tighter around the 500 ms budget: that is the line the confirmation is judged against. */
const ACK_BUCKETS = [50, 100, 200, 300, 400, 500, 750, 1000, 2000];

interface ChannelCounters {
    readonly candidate: string;
    readonly event: string;
    count: number;
}

interface AckLatencies {
    readonly candidate: string;
    count: number;
    sum: number;
    readonly buckets: number[];
}

interface CandidateCounters {
    readonly candidate: string;
    readonly route: string;
    readonly status: number;
    count: number;
}

export class OtlpTelemetry implements Telemetry {
    private readonly endpoint: string;
    private readonly headers: Record<string, string>;
    private readonly serviceName: string;
    private readonly startedAt: bigint;
    private readonly requests = new Map<string, Counters>();
    private readonly latencies = new Map<string, Latencies>();
    private readonly byCandidate = new Map<string, CandidateCounters>();
    private readonly channelEvents = new Map<string, ChannelCounters>();
    private readonly ackLatencies = new Map<string, AckLatencies>();
    private timer: ReturnType<typeof setInterval> | null = null;

    /**
     * `token` is for a collector that asks for one.
     *
     * A collector reachable only from inside its own machine does not need to: it is behind the
     * same door as everything else there. One published on a private network between two machines
     * does, or anybody on that network can write into the metrics of anybody else.
     */
    constructor(endpoint: string, serviceName: string, intervalMs: number, token: string | null = null) {
        this.endpoint = endpoint.replace(/\/$/, "") + "/v1/metrics";
        this.headers = {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
        };
        this.serviceName = serviceName;
        this.startedAt = BigInt(Date.now()) * 1_000_000n;

        this.timer = setInterval(() => {
            // A failed push must not take the service with it: the exercise matters, the metric
            // does not.
            void this.flush().catch(() => {});
        }, intervalMs);
        // Never hold the process open just to report on itself.
        this.timer.unref?.();
    }

    recordRequest(entry: {
        route: string;
        status: number;
        durationMs: number;
        candidate?: string | null;
    }): void {
        const requestKey = `${entry.route}|${entry.status}`;
        const seen = this.requests.get(requestKey);
        if (seen) seen.count += 1;
        else this.requests.set(requestKey, { route: entry.route, status: entry.status, count: 1 });

        let latency = this.latencies.get(entry.route);
        if (!latency) {
            latency = {
                route: entry.route,
                count: 0,
                sum: 0,
                // One extra slot for everything above the last bound.
                buckets: new Array(LATENCY_BUCKETS.length + 1).fill(0),
            };
            this.latencies.set(entry.route, latency);
        }
        latency.count += 1;
        latency.sum += entry.durationMs;
        latency.buckets[this.bucketFor(entry.durationMs)] += 1;

        // Its own metric, not a label on the ones above: health stays cheap and always present,
        // and if this dimension ever costs more than it is worth it can be dropped on its own.
        if (entry.candidate) {
            const key = `${entry.candidate}|${entry.route}|${entry.status}`;
            const seenCandidate = this.byCandidate.get(key);
            if (seenCandidate) seenCandidate.count += 1;
            else this.byCandidate.set(key, {
                candidate: entry.candidate,
                route: entry.route,
                status: entry.status,
                count: 1,
            });
        }
    }

    recordChannel(entry: {
        event: "delivered" | "redelivered" | "acked" | "late_ack";
        latencyMs?: number;
        candidate?: string | null;
    }): void {
        if (!entry.candidate) return;
        const key = `${entry.candidate}|${entry.event}`;
        const seen = this.channelEvents.get(key);
        if (seen) seen.count += 1;
        else this.channelEvents.set(key, { candidate: entry.candidate, event: entry.event, count: 1 });

        if (entry.latencyMs === undefined) return;
        let latency = this.ackLatencies.get(entry.candidate);
        if (!latency) {
            latency = {
                candidate: entry.candidate,
                count: 0,
                sum: 0,
                buckets: new Array(ACK_BUCKETS.length + 1).fill(0),
            };
            this.ackLatencies.set(entry.candidate, latency);
        }
        latency.count += 1;
        latency.sum += entry.latencyMs;
        let slot = ACK_BUCKETS.findIndex((bound) => entry.latencyMs! <= bound);
        if (slot === -1) slot = ACK_BUCKETS.length;
        latency.buckets[slot] += 1;
    }

    private bucketFor(durationMs: number): number {
        for (let index = 0; index < LATENCY_BUCKETS.length; index++) {
            if (durationMs <= LATENCY_BUCKETS[index]) return index;
        }
        return LATENCY_BUCKETS.length;
    }

    /**
     * Pushed on every flush, traffic or none. Without it silence is ambiguous: a service nobody is
     * using looks exactly like one that died, because both stop reporting. With it, silence means
     * dead and a dashboard can say so honestly.
     */
    async flush(): Promise<void> {
        const now = (BigInt(Date.now()) * 1_000_000n).toString();
        const start = this.startedAt.toString();

        const response = await fetch(this.endpoint, {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify(this.payload(start, now)),
        });

        if (!response.ok) {
            throw new Error(`collector returned HTTP ${response.status}`);
        }
    }

    private payload(start: string, now: string) {
        return {
            resourceMetrics: [{
                resource: {
                    attributes: [
                        { key: "service.name", value: { stringValue: this.serviceName } },
                    ],
                },
                scopeMetrics: [{
                    scope: { name: "mock-api" },
                    metrics: [
                        {
                            name: "mock_api_up",
                            description: "1 while the service is running. Absent means it is not.",
                            unit: "1",
                            sum: {
                                aggregationTemporality: CUMULATIVE,
                                isMonotonic: false,
                                dataPoints: [{
                                    startTimeUnixNano: start,
                                    timeUnixNano: now,
                                    asInt: "1",
                                    attributes: [],
                                }],
                            },
                        },
                        {
                            name: "mock_api_requests_total",
                            description: "Requests served, by route template and status.",
                            unit: "1",
                            sum: {
                                aggregationTemporality: CUMULATIVE,
                                isMonotonic: true,
                                dataPoints: [...this.requests.values()].map((entry) => ({
                                    startTimeUnixNano: start,
                                    timeUnixNano: now,
                                    asInt: String(entry.count),
                                    attributes: [
                                        { key: "route", value: { stringValue: entry.route } },
                                        { key: "status", value: { intValue: String(entry.status) } },
                                    ],
                                })),
                            },
                        },
                        {
                            name: "mock_api_request_duration",
                            description: "How long a request took, by route template.",
                            unit: "ms",
                            histogram: {
                                aggregationTemporality: CUMULATIVE,
                                dataPoints: [...this.latencies.values()].map((entry) => ({
                                    startTimeUnixNano: start,
                                    timeUnixNano: now,
                                    count: String(entry.count),
                                    sum: entry.sum,
                                    explicitBounds: LATENCY_BUCKETS,
                                    bucketCounts: entry.buckets.map(String),
                                    attributes: [
                                        { key: "route", value: { stringValue: entry.route } },
                                    ],
                                })),
                            },
                        },
                        {
                            name: "mock_api_candidate_requests_total",
                            description: "Requests per candidate. Present only for signed tokens.",
                            unit: "1",
                            sum: {
                                aggregationTemporality: CUMULATIVE,
                                isMonotonic: true,
                                dataPoints: [...this.byCandidate.values()].map((entry) => ({
                                    startTimeUnixNano: start,
                                    timeUnixNano: now,
                                    asInt: String(entry.count),
                                    attributes: [
                                        { key: "candidate", value: { stringValue: entry.candidate } },
                                        { key: "route", value: { stringValue: entry.route } },
                                        { key: "status", value: { intValue: String(entry.status) } },
                                    ],
                                })),
                            },
                        },
                        {
                            name: "mock_api_channel_events_total",
                            description: "Channel events per candidate: delivered, redelivered, acked, late_ack.",
                            unit: "1",
                            sum: {
                                aggregationTemporality: CUMULATIVE,
                                isMonotonic: true,
                                dataPoints: [...this.channelEvents.values()].map((entry) => ({
                                    startTimeUnixNano: start,
                                    timeUnixNano: now,
                                    asInt: String(entry.count),
                                    attributes: [
                                        { key: "candidate", value: { stringValue: entry.candidate } },
                                        { key: "event", value: { stringValue: entry.event } },
                                    ],
                                })),
                            },
                        },
                        {
                            name: "mock_api_channel_ack_latency",
                            description: "How long each candidate took to confirm a delivered event.",
                            unit: "ms",
                            histogram: {
                                aggregationTemporality: CUMULATIVE,
                                dataPoints: [...this.ackLatencies.values()].map((entry) => ({
                                    startTimeUnixNano: start,
                                    timeUnixNano: now,
                                    count: String(entry.count),
                                    sum: entry.sum,
                                    explicitBounds: ACK_BUCKETS,
                                    bucketCounts: entry.buckets.map(String),
                                    attributes: [
                                        { key: "candidate", value: { stringValue: entry.candidate } },
                                    ],
                                })),
                            },
                        },
                    ],
                }],
            }],
        };
    }
}

/** What runs when no collector is configured. A laptop has nowhere to send this. */
export class SilentTelemetry implements Telemetry {
    // The parameter is declared even though it is unused: dropping it is legal when implementing
    // the interface, but it makes the class impossible to call directly.
    recordRequest(_entry: {
        route: string;
        status: number;
        durationMs: number;
        candidate?: string | null;
    }): void {}

    recordChannel(_entry: {
        event: "delivered" | "redelivered" | "acked" | "late_ack";
        latencyMs?: number;
        candidate?: string | null;
    }): void {}

    async flush(): Promise<void> {}
}
