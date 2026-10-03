/**
 * Proves the token was issued by us, without a database and without calling anyone.
 *
 * The token is `<prefix><candidateId>.<expiry>.<signature>`, where the expiry is a Unix timestamp
 * in seconds and the signature is an HMAC-SHA256 over `<candidateId>.<expiry>` under a secret
 * shared with the recruiting platform.
 *
 * The expiry is in the token and not in a database on purpose. This service verifies without
 * calling anyone, which is what makes its request log trustworthy, but it also meant a token was
 * good forever: deleting a candidate over there revoked nothing here, because nothing here ever
 * asked. A date the caller cannot alter without breaking the signature is the only revocation a
 * stateless verifier can have.
 *
 * With this in place every log line belongs to a real candidate, so the request log can be crossed
 * with the delivery.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Credentials, Identity } from "../domain/ports.ts";

export class SignedCredentials implements Credentials {
    private readonly prefix: string;
    private readonly secret: string;
    private readonly now: () => number;

    constructor(prefix: string, secret: string, now: () => number = Date.now) {
        if (!secret) throw new Error("SignedCredentials needs a shared secret.");
        this.prefix = prefix;
        this.secret = secret;
        this.now = now;
    }

    check(presented: string | null): Identity {
        if (!presented) return { known: false, reason: "no token presented" };
        if (!presented.startsWith(this.prefix)) return { known: false, reason: "malformed token" };

        const [candidateId, expiry, signature] = presented.slice(this.prefix.length).split(".");
        if (!candidateId || !expiry || !signature) return { known: false, reason: "malformed token" };
        if (!this.matches(`${candidateId}.${expiry}`, signature)) {
            return { known: false, reason: "bad signature" };
        }

        // After the signature, never before: an unsigned token has no expiry worth reading, and
        // saying "expired" to a forgery tells the forger their date was the only thing wrong.
        const expiresAt = Number(expiry);
        if (!Number.isFinite(expiresAt)) return { known: false, reason: "malformed token" };
        if (this.now() >= expiresAt * 1000) return { known: false, reason: "token expired" };

                // attributable: true. La firma prueba que el id lo emitimos nosotros, asi que es un
        // identificador y no una credencial: puede viajar como etiqueta.
        return { known: true, token: presented, candidateId, attributable: true };
    }

    private matches(signed: string, signature: string): boolean {
        const expected = createHmac("sha256", this.secret).update(signed).digest();
        let presented: Buffer;
        try {
            presented = Buffer.from(signature, "base64url");
        } catch {
            return false;
        }
        // Length has to match before the constant-time compare, which throws on mismatched sizes.
        return presented.length === expected.length && timingSafeEqual(presented, expected);
    }
}
