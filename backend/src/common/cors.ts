/**
 * WHO MAY CALL THE API FROM A BROWSER
 *
 * The allowlist is `CORS_ORIGINS`, but an allowlist alone was a trap: the
 * deployment URL of this platform is not permanent (Northflank issues a new one
 * whenever a service is recreated, and a custom domain arrives later still). A
 * browser sends `Origin` on *every* non-GET request, including same-origin ones,
 * so a stale entry in that variable turned "sign in" into a 500 that read
 * "Something went wrong on our side. Reference: unknown" — the most misleading
 * possible message for a configuration problem.
 *
 * Two things fix that for good:
 *
 *   1. THE APP'S OWN ORIGIN IS ALWAYS ALLOWED. If the `Origin` host matches the
 *      host the request arrived on, the request is same-origin by definition and
 *      no allowlist should be able to break it. This is what makes a new
 *      deployment work with no environment changes at all.
 *   2. A REFUSED ORIGIN IS NOT AN ERROR. The request simply gets no CORS headers,
 *      the browser blocks it, and the server logs one warning naming the origin.
 *      A configuration mistake stays a warning in the log instead of becoming a
 *      500 in a customer's face.
 */

export type CorsReason = 'no-origin' | 'same-origin' | 'allowlisted' | 'blocked';

export interface CorsDecision {
  allowed: boolean;
  reason: CorsReason;
}

/** `https://a.b/c/` → `a.b`. Returns null for anything unparseable. */
function hostOf(value: string | undefined | null): string | null {
  if (!value) return null;
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    // A bare host ("api.example.com:4000") is not a URL; give it a scheme so the
    // parser accepts it, since `Host` headers arrive in exactly that shape.
    const url = new URL(candidate.includes('://') ? candidate : `http://${candidate}`);
    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

const normaliseOrigin = (value: string): string => value.trim().replace(/\/+$/, '').toLowerCase();

/**
 * Decide whether a request from `originHeader` may call this API, given the host
 * the request arrived on and the configured allowlist.
 */
export function decideCorsOrigin(
  originHeader: string | undefined | null,
  hostHeader: string | undefined | null,
  forwardedHostHeader: string | string[] | undefined | null,
  allowlist: readonly string[],
): CorsDecision {
  // No Origin at all: curl, a native app, a server-to-server call, a webhook, or
  // a same-origin GET. CORS does not apply, so there is nothing to refuse.
  if (!originHeader) return { allowed: true, reason: 'no-origin' };

  const origin = normaliseOrigin(originHeader);

  if (allowlist.some((entry) => normaliseOrigin(entry) === origin)) {
    return { allowed: true, reason: 'allowlisted' };
  }

  const originHost = hostOf(origin);
  if (originHost) {
    // `x-forwarded-host` is what the browser actually typed when a reverse proxy
    // rewrites `Host` on the way in (our Docker deploy does exactly that).
    const forwarded = Array.isArray(forwardedHostHeader) ? forwardedHostHeader[0] : forwardedHostHeader;
    const candidates = [hostOf(hostHeader), hostOf(forwarded)].filter((host): host is string => !!host);
    if (candidates.includes(originHost)) return { allowed: true, reason: 'same-origin' };
  }

  return { allowed: false, reason: 'blocked' };
}
