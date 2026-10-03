/**
 * Where this API hangs when it is not at the root of its host.
 *
 * The candidate page and this API share one hostname: the page is at `/` and the API under a
 * prefix, which the proxy strips before the request gets here. So every route inside keeps
 * speaking in its own paths (nothing in the routers knows about this), and the only thing that
 * has to change is the `_links` that go back out, because those are what the candidate follows.
 *
 * Doing it here rather than at each `href` is deliberate: a link added later cannot forget it.
 */

/** A prefix, normalised: leading slash, no trailing one. Empty when the API is at the root. */
export function normaliseBasePath(raw: string | null | undefined): string {
    const trimmed = (raw ?? "").trim().replace(/\/+$/, "");
    if (trimmed.length === 0) return "";
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/**
 * Rewrites every `href` in a response so it points at the public address.
 *
 * Only absolute paths: a link that is already whole is somebody else's and stays as it is.
 */
export function withBasePath<T>(body: T, basePath: string): T {
    if (basePath.length === 0) return body;

    const rewrite = (node: unknown): unknown => {
        if (Array.isArray(node)) return node.map(rewrite);
        if (node === null || typeof node !== "object") return node;

        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            out[key] =
                key === "href" && typeof value === "string" && value.startsWith("/")
                    ? `${basePath}${value}`
                    : rewrite(value);
        }
        return out;
    };

    return rewrite(body) as T;
}
