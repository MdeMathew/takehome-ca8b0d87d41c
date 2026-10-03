/**
 * The simulator a candidate runs on their own machine. It is the same code the hosted service runs,
 * wired with fewer pieces (see `wiring-local.ts`), so what works here works there.
 */
import { serve } from "./http/serve.ts";
import { settingsFromEnvironment } from "./settings.ts";
import { wireLocal } from "./wiring-local.ts";

const settings = settingsFromEnvironment();
const parts = wireLocal(settings);

const notHere = { handle: () => ({ status: 404, body: { error: "not_found" }, route: "other" }) };

const server = serve(
    notHere as never,
    notHere as never,
    notHere as never,
    parts.pms,
    parts.channels,
    parts.admin,
    parts.throttle,
    parts.log,
    parts.telemetry,
    settings.port,
    settings.publicBasePath,
);

server.listen(settings.port, () => {
    process.stdout.write(JSON.stringify({ event: "listening", port: settings.port, mode: "local simulator" }) + "\n");
});
