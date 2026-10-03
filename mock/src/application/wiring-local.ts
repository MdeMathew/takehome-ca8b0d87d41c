/**
 * The mounting point of the simulator a candidate runs on their own machine: the sales channels, the
 * PMS and the report, and nothing of the other exercises. Like `wiring.ts`, it is the only place
 * that names an adapter, and it fills the same ports with the same code the hosted service runs.
 */
import { join } from "node:path";
import { ChannelRouter } from "./http/channel-routes.ts";
import { PmsRouter } from "./http/pms-routes.ts";
import { AdminRouter } from "./http/admin-routes.ts";
import { Throttle } from "./http/throttle.ts";
import type { Settings } from "./settings.ts";
import { ChannelFeed } from "../domain/channel-feed.ts";
import type { Credentials } from "../domain/ports.ts";
import { FileJournal } from "../adapters/file-journal.ts";
import { NoJournal } from "../adapters/no-journal.ts";
import { InMemoryChannelStore } from "../adapters/in-memory-channel-store.ts";
import { InMemoryReservations } from "../adapters/in-memory-reservations.ts";
import { SeededPmsBehaviour } from "../adapters/seeded-pms-behaviour.ts";
import { PrefixCredentials } from "../adapters/prefix-credentials.ts";
import { SignedCredentials } from "../adapters/signed-credentials.ts";
import { SlidingWindowRateLimiter } from "../adapters/sliding-window-rate-limiter.ts";
import { StdoutRequestLog } from "../adapters/stdout-request-log.ts";
import { SilentTelemetry } from "../adapters/otlp-telemetry.ts";
import { SystemClock } from "../adapters/system-clock.ts";

export function wireLocal(settings: Settings) {
    const clock = new SystemClock();
    const credentials: Credentials = settings.sharedSecret
        ? new SignedCredentials(settings.tokenPrefix, settings.sharedSecret)
        : new PrefixCredentials(settings.tokenPrefix);

    const journal = settings.dataDirectory ? new FileJournal(join(settings.dataDirectory, "journal.jsonl")) : new NoJournal();
    const channelStore = new InMemoryChannelStore(journal);
    const reservations = new InMemoryReservations(journal);
    const feed = new ChannelFeed(
        channelStore,
        {
            eventCount: settings.channelEventCount,
            intervalMs: settings.channelIntervalMs,
            echoProbability: settings.channelEchoProbability,
            echoGapMs: settings.channelEchoGapMs,
            ackBudgetMs: settings.channelAckBudgetMs,
        },
        (candidateId) => (settings.channelSeed ? `${settings.channelSeed}:${candidateId}` : String(Math.random())),
        () => clock.today(),
    );

    return {
        pms: new PmsRouter(
            credentials,
            reservations,
            new SeededPmsBehaviour(
                settings.pmsDelayMinMs,
                settings.pmsDelayMaxMs,
                settings.pmsErrorRate,
                settings.pmsSeed,
                settings.pmsFailFirstN,
            ),
        ),
        channels: new ChannelRouter(credentials, feed),
        admin: new AdminRouter(credentials, settings.evaluatorToken, feed, channelStore, reservations),
        throttle: new Throttle(credentials, new SlidingWindowRateLimiter(settings.rateLimit, settings.rateWindowMs)),
        log: new StdoutRequestLog(),
        telemetry: new SilentTelemetry(),
    };
}
