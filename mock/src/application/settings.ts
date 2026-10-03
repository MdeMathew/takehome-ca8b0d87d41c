/**
 * Everything configurable, read once. Nothing else in the service touches `process.env`, so what
 * can be tuned is the list below and not whatever someone reaches for from inside a handler.
 */
import { normaliseBasePath } from "./http/public-path.ts";

export interface Settings {
    readonly port: number;
    readonly pageSize: number;
    readonly flakyOneIn: number;
    readonly tokenPrefix: string;
    /** When set, tokens must be signed with it. Absent means prefix-only: fine locally, not exposed. */
    readonly sharedSecret: string | null;
    /**
     * Freezes the day the whole service works from: the stays, the ages of the guests and the
     * validation the authority applies. Absent means today, which is what makes the exercise stay
     * valid without anyone bumping a year every January.
     */
    readonly frozenDate: string | null;
    /** Absent means nothing is reported, which is the right answer on a laptop. */
    readonly telemetryEndpoint: string | null;
    readonly telemetryIntervalMs: number;
    /** El bearer del colector, cuando pide uno. Vacío = no lo pide. */
    readonly telemetryToken: string | null;
    readonly serviceName: string;
    /** Where the packaged starting points live. Absent means none are on offer. */
    readonly basesDirectory: string | null;
    /**
     * The prefix this API is reachable under from outside, when it shares a hostname with the
     * candidate page. Empty means it is at the root, which is how it runs on a laptop.
     */
    readonly publicBasePath: string;
    /** Calls per candidate inside the window before the authority pushes back. */
    readonly rateLimit: number;
    readonly rateWindowMs: number;
    readonly pmsDelayMinMs: number;
    readonly pmsDelayMaxMs: number;
    readonly pmsErrorRate: number;
    /** Fixes the failure sequence of every candidate. Absent means a different one each run. */
    readonly pmsSeed: string | null;
    /** The first N tries of every candidate fail, whatever the rate says: for deterministic checks. */
    readonly pmsFailFirstN: number;
    readonly channelEventCount: number;
    readonly channelIntervalMs: number;
    readonly channelEchoProbability: number;
    readonly channelEchoGapMs: number;
    readonly channelAckBudgetMs: number;
    /** Fixes every candidate's stream. Absent means each session draws its own, and keeps it. */
    readonly channelSeed: string | null;
    /** Who may read the evaluation report. Absent means the report does not exist. */
    readonly evaluatorToken: string | null;
    /** Where the journal lives. Absent means nothing survives a restart, which is fine on a laptop. */
    readonly dataDirectory: string | null;
}

const number = (value: string | undefined, fallback: number): number => {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) ? parsed : fallback;
};

export function settingsFromEnvironment(env: NodeJS.ProcessEnv = process.env): Settings {
    return {
        port: number(env.PORT, 4000),
        pageSize: number(env.PAGE_SIZE, 3),
        flakyOneIn: number(env.FLAKY_ONE_IN, 15),
        tokenPrefix: env.TOKEN_PREFIX ?? "wf_",
        sharedSecret: env.HIRING_SHARED_SECRET || null,
        frozenDate: env.FROZEN_DATE || null,
        telemetryEndpoint: env.OTEL_METRICS_ENDPOINT || null,
        telemetryIntervalMs: number(env.OTEL_INTERVAL_MS, 30000),
        telemetryToken: env.OTEL_METRICS_TOKEN || null,
        serviceName: env.SERVICE_NAME ?? "mock-api",
        basesDirectory: env.BASES_DIR || null,
        publicBasePath: normaliseBasePath(env.PUBLIC_BASE_PATH),
        // Wide enough that working through the exercise never reaches it, narrow enough that a
        // poll with no wait between calls reaches it in under a second.
        //
        // 120 was set when the check judged one booking. Judging the three costs 70 calls on a
        // cold run, measured against the reference solution: paginating every booking, declaring
        // each one and polling its batch until the authority answers. It drops to about 44 once
        // the batches are already settled and an Idempotency-Key resolves to them, so 70 is the
        // number that matters: it is what the first run of the day costs.
        //
        // At 120 the second run inside a minute already got a 429, which punished iterating,
        // the behaviour the exercise is trying to reward. A runaway loop does hundreds a second
        // and still hits 300 just as fast, so the trap survives the change.
        rateLimit: number(env.RATE_LIMIT, 300),
        rateWindowMs: number(env.RATE_WINDOW_MS, 60000),
        pmsDelayMinMs: number(env.PMS_DELAY_MIN_MS, 3000),
        pmsDelayMaxMs: number(env.PMS_DELAY_MAX_MS, 5000),
        pmsErrorRate: number(env.PMS_ERROR_RATE, 0.3),
        pmsSeed: env.PMS_SEED || null,
        pmsFailFirstN: number(env.PMS_FAIL_FIRST_N, 0),
        channelEventCount: number(env.CHANNEL_EVENT_COUNT, 40),
        channelIntervalMs: number(env.CHANNEL_INTERVAL_MS, 4000),
        channelEchoProbability: number(env.CHANNEL_ECHO_PROBABILITY, 0.25),
        channelEchoGapMs: number(env.CHANNEL_ECHO_GAP_MS, 400),
        channelAckBudgetMs: number(env.CHANNEL_ACK_BUDGET_MS, 500),
        channelSeed: env.CHANNEL_SEED || null,
        evaluatorToken: env.EVALUATOR_TOKEN || null,
        dataDirectory: env.DATA_DIR || null,
    };
}
