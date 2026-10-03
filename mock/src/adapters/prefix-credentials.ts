/**
 * Accepts any token with the right shape. This is what the exercise runs on today.
 *
 * ⚠️ It does NOT prove the token is ours. `wf_anything` gets in, two candidates can share one, and
 * the line it writes to the log is whatever string the caller sent. Good enough while the API is
 * only reachable from inside; not good enough the day it is exposed. `SignedCredentials` is the
 * replacement and swapping them is one line in the wiring.
 */
import type { Credentials, Identity } from "../domain/ports.ts";

export class PrefixCredentials implements Credentials {
    private readonly prefix: string;

    constructor(prefix: string) {
        this.prefix = prefix;
    }

    check(presented: string | null): Identity {
        if (!presented) return { known: false, reason: "no token presented" };
        if (!presented.startsWith(this.prefix)) return { known: false, reason: "malformed token" };
                // attributable: false. Aqui el "id" es el token pelado. Sirve para sembrar los datos,
        // no para etiquetar una metrica que alguien podria leer.
        return {
            known: true,
            token: presented,
            candidateId: presented.slice(this.prefix.length),
            attributable: false,
        };
    }
}
