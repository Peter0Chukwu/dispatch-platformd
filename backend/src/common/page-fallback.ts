/**
 * WHEN A PAGE IS ASKED OF THE API
 *
 * The public site and the API are two services behind one domain: nginx serves the
 * app and proxies `/api/` to Nest. If a domain is ever attached to the API service
 * by mistake — or an old email link points at a host that is not the site — then a
 * person clicking a link in their inbox gets JSON:
 *
 *   {"error":{"code":"NOT_FOUND","message":"Cannot GET /reset-password?token=…"}}
 *
 * That message is useless to them: the link was fine, the routing was not. This
 * recognises the shape of that mistake — a browser asking for an HTML page from a
 * host that is not the site — and sends the person to the page they wanted, with
 * the query string intact, instead of answering with a machine-readable 404.
 *
 * Deliberately narrow:
 *   • only GET/HEAD (a POST means an API client, not a browser);
 *   • only when the browser asked for HTML (`Accept: text/html`), so SDKs, curl and
 *     the mobile app still receive JSON errors;
 *   • never for a path under `/api` (the API's namespace) or `/socket.io`;
 *   • never when the site is the same host as the API, which would be a redirect
 *     loop.
 */
export function pageRedirectTarget(input: {
  method: string;
  accept?: string | null;
  path: string;
  host?: string | null;
  siteOrigin: string;
}): string | null {
  const { method, accept, path, host, siteOrigin } = input;

  if (method !== 'GET' && method !== 'HEAD') return null;
  if (!accept || !accept.toLowerCase().includes('text/html')) return null;
  if (!path.startsWith('/')) return null;
  if (path === '/api' || path.startsWith('/api/')) return null;
  // The socket handshake is not a page, whatever the client claims to accept.
  if (path === '/socket.io' || path.startsWith('/socket.io/')) return null;

  let site: URL;
  try {
    site = new URL(siteOrigin);
  } catch {
    return null;
  }
  if (!site.host) return null;

  // Same host: the site *is* this service, so there is nowhere to send them.
  const hostName = (host ?? '').split(':')[0]?.toLowerCase();
  if (hostName && hostName === site.host.toLowerCase()) return null;

  return `${site.origin}${path}`;
}
