#!/usr/bin/env node
/**
 * El comprobador de `sincronizador-de-reservas`, un solo script para cualquier lenguaje.
 *
 * Nada de aquí llama a tu servicio para alimentarlo: tu servicio no expone webhooks, pregunta por
 * sus eventos. Así que el comprobador arranca el simulador, arranca tu servicio, espera a que corra
 * la sesión y lee lo que el simulador vio. El mismo script sirve para tu comprobación y para la
 * verificación de una entrega, solo cambia el `--start`.
 *
 *   node check/check.mjs --cwd backend --start "npm start"
 *
 * Opciones: --cwd (dónde se arranca tu servicio), --start (el comando), --mock (carpeta con
 * src/application/local-main.ts), --only (números de escenario separados por comas). Sin ellas lee
 * `config.json`, que está junto a este fichero.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const option = (name) => {
    const at = process.argv.indexOf(`--${name}`);
    return at >= 0 ? process.argv[at + 1] : undefined;
};
const configFile = resolve(here, "config.json");
const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : {};

const CWD = resolve(option("cwd") ?? resolve(here, "..", config.cwd ?? "."));
const configured = typeof config.start === "object" ? config.start[process.platform === "win32" ? "win32" : "posix"] : config.start;
const START = option("start") ?? configured;
const MOCK = resolve(option("mock") ?? resolve(here, "..", config.mock ?? "mock"));
const EVALUATOR = "check-evaluator";
const only = option("only");
let scenarioNumber = 0;

if (!START) {
    console.error(
        "Todavía no sé cómo se arranca tu servicio.\n" +
            "Rellena `start` (y `cwd`, la carpeta desde la que se lanza) en check/config.json,\n" +
            'o pásalo así: node check/check.mjs --start "tu comando" --cwd tu-carpeta',
    );
    process.exit(2);
}

const sleep = (ms) => new Promise((wake) => setTimeout(wake, ms));

const freePort = () =>
    new Promise((found) => {
        const probe = createServer();
        probe.listen(0, () => {
            const { port } = probe.address();
            probe.close(() => found(port));
        });
    });

function launch(command, args, options) {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"], shell: options.shell ?? false });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.tail = () => output.split("\n").slice(-12).join("\n");
    return child;
}

function stop(child) {
    return new Promise((done) => {
        if (child.exitCode !== null) return done();
        child.once("exit", () => done());
        if (process.platform === "win32") {
            spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
            child.kill("SIGKILL");
        }
        setTimeout(done, 3000);
    });
}

async function untilResponding(url, child, seconds) {
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`se detuvo antes de responder:\n${child.tail()}`);
        try {
            await fetch(url);
            return;
        } catch {
            await sleep(300);
        }
    }
    throw new Error(`nada respondió en ${url} tras ${seconds} s:\n${child.tail()}`);
}

async function waitFor(what, seconds, probe) {
    const deadline = Date.now() + seconds * 1000;
    let last;
    while (Date.now() < deadline) {
        last = await probe();
        if (last.done) return last.value;
        await sleep(500);
    }
    throw new Error(`${what} no ocurrió en ${seconds} s${last?.hint ? `: ${last.hint}` : ""}`);
}

async function scenario(name, mockEnv, run) {
    scenarioNumber += 1;
    if (only && !only.split(",").includes(String(scenarioNumber))) return;
    const token = `wf_check_${name}`;
    const mockPort = await freePort();
    const appPort = await freePort();
    const mockBase = `http://localhost:${mockPort}`;
    const appBase = `http://localhost:${appPort}`;

    const mock = launch(process.execPath, ["--experimental-strip-types", "src/application/local-main.ts"], {
        cwd: MOCK,
        // El límite de ritmo es el del servicio de verdad: un bucle que consulta sin esperar lo nota aquí también.
        env: { ...process.env, PORT: String(mockPort), EVALUATOR_TOKEN: EVALUATOR, CHANNEL_SEED: "check", RATE_LIMIT: "600", ...mockEnv },
    });
    let app;
    try {
        await untilResponding(mockBase + "/", mock, 20);
        app = launch(START, [], {
            cwd: CWD,
            shell: true,
            env: {
                ...process.env,
                PORT: String(appPort),
                API_BASE: mockBase,
                // Dónde alcanza un contenedor al simulador, para un --start que ejecute la entrega en Docker.
                API_BASE_FROM_DOCKER: `http://host.docker.internal:${mockPort}`,
                API_TOKEN: token,
            },
        });
        await untilResponding(appBase + "/health", app, 60);

        const report = async () => {
            const response = await fetch(`${mockBase}/admin/candidates/${token.slice("wf_".length)}/report`, {
                headers: { authorization: `Bearer ${EVALUATOR}` },
            });
            return response.status === 200 ? { status: 200, body: await response.json() } : { status: response.status, body: null };
        };
        return await run({ appBase, report, sleep, waitFor, app });
    } finally {
        await Promise.all([app ? stop(app) : null, stop(mock)]);
    }
}

const results = [];
async function verify(label, check) {
    try {
        await check();
        results.push({ label, ok: true });
        console.log(`  ok    ${label}`);
    } catch (error) {
        results.push({ label, ok: false });
        console.log(`  FALLA ${label}\n        ${String(error.message ?? error).split("\n").join("\n        ")}`);
    }
}
const expect = (condition, message) => {
    if (!condition) throw new Error(message);
};

const STATUSES = ["pending", "syncing", "synced", "retrying", "failed"];
const CONTRACT_FIELDS = ["id", "channel", "guestName", "checkIn", "checkOut", "totalPrice", "currency", "status", "attempts", "lastError", "pmsReference", "updatedAt"];

const listOf = async (appBase) => {
    const response = await fetch(appBase + "/api/bookings");
    expect(response.status === 200, `GET /api/bookings respondió ${response.status} y debe responder 200`);
    const body = await response.json();
    expect(body && Array.isArray(body.items), "GET /api/bookings debe devolver { \"items\": [ ... ] }");
    return body.items;
};

const sessionRan = (report) => async () => {
    const seen = await report();
    return seen.status === 200
        ? { done: seen.body.complete, value: seen.body, hint: `confirmó ${seen.body.channel.acks} de ${seen.body.channel.eventsInStream} eventos a tiempo, ${seen.body.channel.lateAcks} llegaron tarde` }
        : { done: false, hint: "tu servicio nunca ha pedido eventos al canal" };
};

console.log("\n1. Normalización, canal impaciente y ecos de red");
await scenario(
    "normalizacion",
    { CHANNEL_EVENT_COUNT: "12", CHANNEL_INTERVAL_MS: "300", CHANNEL_ECHO_PROBABILITY: "0.5", CHANNEL_ECHO_GAP_MS: "50", PMS_ERROR_RATE: "0", PMS_DELAY_MIN_MS: "1000", PMS_DELAY_MAX_MS: "1500" },
    async ({ appBase, report }) => {
        let final;
        try {
            await waitFor("que termine la sesión", 90, sessionRan(report));
            final = await waitFor("que todas las reservas lleguen al PMS", 90, async () => {
                const seen = (await report()).body;
                return { done: seen.missing.length === 0, value: seen, hint: `aún faltan ${seen.missing.length} reservas` };
            });
            await sleep(3000);
            final = (await report()).body;
        } catch (error) {
            await verify("tu servicio consume todos los eventos y lleva todas las reservas al PMS", () => {
                throw error;
            });
            return;
        }
        await verify("confirma cada evento en menos de 500 ms, aunque el PMS tarde 1 s o más", () => {
            expect(final.channel.lateAcks === 0, `${final.channel.lateAcks} confirmaciones llegaron tarde (p95: ${final.channel.ackLatencyMs.p95} ms)`);
            expect(final.channel.ackLatencyMs.p95 < 500, `el p95 de la confirmación fue de ${final.channel.ackLatencyMs.p95} ms`);
        });
        await verify("todas las reservas llegan al PMS", () => expect(final.missing.length === 0, `faltan: ${final.missing.join(", ")}`));
        await verify("los dos canales se normalizan igual", () =>
            expect(final.mismatches.length === 0, `mal normalizado: ${JSON.stringify(final.mismatches.slice(0, 3))}`));
        await verify("el mismo booking_id recibido dos veces llega al PMS una sola vez", () =>
            expect(final.duplicatesInPms.length === 0, `duplicadas en el PMS: ${JSON.stringify(final.duplicatesInPms)}`));
        await verify("GET / sirve una pantalla (HTML)", async () => {
            const response = await fetch(appBase + "/");
            expect(response.status === 200, `GET / respondió ${response.status}`);
            const html = await response.text();
            expect(/html/i.test(response.headers.get("content-type") ?? "") || /<html|<!doctype/i.test(html), "GET / no devuelve una página HTML");
            expect(!html.includes("PANTALLA_SIN_ESCRIBIR"), "la pantalla sigue mostrando el aviso de la base de partida");
        });
        await verify("el contrato: GET /api/bookings devuelve las reservas con todos sus campos y un estado válido", async () => {
            const items = await listOf(appBase);
            expect(items.length > 0, "GET /api/bookings no devolvió ninguna reserva");
            for (const item of items.slice(0, 5)) {
                const missing = CONTRACT_FIELDS.filter((field) => !(field in item));
                expect(missing.length === 0, `a la reserva ${item.id ?? "?"} le faltan campos: ${missing.join(", ")}`);
                expect(STATUSES.includes(item.status), `estado no válido en ${item.id}: ${item.status}`);
            }
        });
        await verify("el contrato: GET /api/bookings/{id} devuelve la reserva, y 404 si no existe", async () => {
            const [first] = await listOf(appBase);
            const found = await fetch(`${appBase}/api/bookings/${encodeURIComponent(first.id)}`);
            expect(found.status === 200, `GET /api/bookings/${first.id} respondió ${found.status} y debe responder 200`);
            expect((await found.json()).id === first.id, "el detalle no es la reserva pedida");
            const missing = await fetch(`${appBase}/api/bookings/no-existe-esta-reserva`);
            expect(missing.status === 404, `una reserva que no existe respondió ${missing.status} y debe responder 404`);
        });
        await verify("el contrato: reintentar una reserva que no está fallida da 409, y una que no existe da 404", async () => {
            const items = await listOf(appBase);
            const synced = items.find((item) => item.status === "synced");
            expect(synced, "ninguna reserva llegó a synced, no se puede comprobar");
            const notFailed = await fetch(`${appBase}/api/bookings/${encodeURIComponent(synced.id)}/retry`, { method: "POST" });
            expect(notFailed.status === 409, `reintentar una reserva synced respondió ${notFailed.status} y debe responder 409`);
            const missing = await fetch(`${appBase}/api/bookings/no-existe-esta-reserva/retry`, { method: "POST" });
            expect(missing.status === 404, `reintentar una reserva que no existe respondió ${missing.status} y debe responder 404`);
        });
    },
);

console.log("\n2. Resiliencia: se recupera de fallos transitorios");
await scenario(
    "recupera",
    { CHANNEL_EVENT_COUNT: "6", CHANNEL_INTERVAL_MS: "300", CHANNEL_ECHO_PROBABILITY: "0.3", PMS_ERROR_RATE: "0", PMS_FAIL_FIRST_N: "4", PMS_DELAY_MIN_MS: "100", PMS_DELAY_MAX_MS: "200" },
    async ({ report }) => {
        try {
            await waitFor("que termine la sesión", 60, sessionRan(report));
            const final = await waitFor("que todas las reservas lleguen al PMS", 90, async () => {
                const seen = (await report()).body;
                return { done: seen.missing.length === 0, value: seen, hint: `faltan ${seen.missing.length} reservas, el PMS vio ${seen.pms.failures} fallos` };
            });
            await verify("reintenta tras los fallos y todas las reservas acaban en el PMS", () => {
                expect(final.pms.failures >= 4, `el PMS solo vio ${final.pms.failures} intentos fallidos`);
                expect(final.missing.length === 0, `faltan: ${final.missing.join(", ")}`);
            });
        } catch (error) {
            await verify("reintenta tras los fallos y todas las reservas acaban en el PMS", () => {
                throw error;
            });
        }
    },
);

console.log("\n3. Resiliencia: se rinde en vez de reintentar para siempre");
await scenario(
    "se-rinde",
    { CHANNEL_EVENT_COUNT: "3", CHANNEL_INTERVAL_MS: "300", CHANNEL_ECHO_PROBABILITY: "0", PMS_ERROR_RATE: "1", PMS_DELAY_MIN_MS: "100", PMS_DELAY_MAX_MS: "200" },
    async ({ appBase, report }) => {
        try {
            await waitFor("que termine la sesión", 60, sessionRan(report));
            // No se presupone ningún backoff: se espera a que tu API llame «failed» a todas, tarde lo que tarde
            // tu política, y solo entonces se mira si los intentos han dejado de crecer.
            await verify("las marca como fallidas en su propia API", async () => {
                await waitFor("que todas queden marcadas como failed", 150, async () => {
                    const list = await listOf(appBase).catch(() => []);
                    const notFailed = list.filter((item) => item.status !== "failed");
                    return { done: list.length > 0 && notFailed.length === 0, hint: `${notFailed.length} de ${list.length} no están marcadas como failed` };
                });
            });
            const before = (await report()).body;
            await sleep(4000);
            const after = (await report()).body;
            await verify("reintenta una reserva que el PMS nunca acepta, pero acaba parando", () => {
                expect(before.pms.attempts > before.emitted.length, `solo ${before.pms.attempts} intentos para ${before.emitted.length} reservas: nunca reintentó`);
                expect(after.pms.attempts === before.pms.attempts, `siguió reintentando después de rendirse: ${before.pms.attempts} y luego ${after.pms.attempts} intentos`);
            });
            await verify("el contrato: reintentar una reserva fallida da 202", async () => {
                const failed = (await listOf(appBase)).find((item) => item.status === "failed");
                expect(failed, "no hay ninguna reserva fallida para reintentar");
                const response = await fetch(`${appBase}/api/bookings/${encodeURIComponent(failed.id)}/retry`, { method: "POST" });
                expect(response.status === 202, `reintentar una reserva fallida respondió ${response.status} y debe responder 202`);
            });
        } catch (error) {
            await verify("las marca como fallidas en su propia API", () => {
                throw error;
            });
        }
    },
);

const failed = results.filter((each) => !each.ok).length;
console.log(`\n${results.length - failed} de ${results.length} comprobaciones pasan${failed ? `, ${failed} fallan` : ""}.`);
process.exit(failed ? 1 : 0);
