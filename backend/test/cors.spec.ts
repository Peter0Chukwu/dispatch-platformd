import { describe, expect, it } from 'vitest';
import { decideCorsOrigin, emailLinkOrigin } from '../src/common/cors';

/**
 * A refused origin used to throw inside the CORS callback, which Express turned
 * into a 500 before the request-id middleware had run — so a browser was told
 * "Something went wrong on our side. Reference: unknown" when the real problem
 * was an allowlist that did not mention the deployment's own URL. That cost a
 * working admin sign-in. These tests pin the behaviour that replaced it.
 */

const PREVIEW = 'p01--twl-frontend--glzb7542cqkx.code.run';

describe('who may call the API from a browser', () => {
  it('allows requests with no Origin at all — curl, webhooks, native apps', () => {
    expect(decideCorsOrigin(undefined, PREVIEW, undefined, [])).toEqual({ allowed: true, reason: 'no-origin' });
    expect(decideCorsOrigin(null, PREVIEW, undefined, [])).toEqual({ allowed: true, reason: 'no-origin' });
  });

  it('allows the deployment’s own origin even when the allowlist is empty', () => {
    // This is the case that broke sign-in: same-origin POSTs always carry Origin.
    const decision = decideCorsOrigin(`https://${PREVIEW}`, PREVIEW, undefined, ['http://localhost:5173']);
    expect(decision).toEqual({ allowed: true, reason: 'same-origin' });
  });

  it('allows the origin the proxy forwarded when Host was rewritten', () => {
    const decision = decideCorsOrigin(
      'https://dispatch.example.com',
      'twl-frontend:4000',
      'dispatch.example.com',
      [],
    );
    expect(decision).toEqual({ allowed: true, reason: 'same-origin' });
  });

  it('allows anything in the allowlist, ignoring case and a trailing slash', () => {
    expect(decideCorsOrigin('https://App.Example.com', PREVIEW, undefined, ['https://app.example.com/'])).toEqual({
      allowed: true,
      reason: 'allowlisted',
    });
  });

  it('refuses a different site — quietly, without throwing', () => {
    const decision = decideCorsOrigin('https://evil.example.com', PREVIEW, undefined, ['https://app.example.com']);
    expect(decision).toEqual({ allowed: false, reason: 'blocked' });
  });

  it('refuses a lookalike host that merely contains the real one', () => {
    const decision = decideCorsOrigin(`https://${PREVIEW}.evil.com`, PREVIEW, undefined, []);
    expect(decision.allowed).toBe(false);
  });

  it('never throws, whatever it is handed', () => {
    expect(() => decideCorsOrigin('not a url', 'also not a url', '', [''])).not.toThrow();
    expect(() => decideCorsOrigin('', '', undefined, [])).not.toThrow();
  });
});

/**
 * Where email links point, and whether that address may sign in.
 *
 * Both halves of this were real: a comma-separated list used as a site address, and
 * a site address missing from the CORS allowlist — which let the link open while the
 * browser refused to sign in from the very page it landed on.
 */
describe('the address used in email links', () => {
  it('takes one origin from a list', () => {
    expect(
      emailLinkOrigin(
        'https://www.example.com,https://example.com',
        'https://example.com,https://www.example.com',
      ).origin,
    ).toBe('https://www.example.com');
  });

  it('strips a trailing slash so paths do not double up', () => {
    expect(emailLinkOrigin('https://example.com/', null).origin).toBe('https://example.com');
  });

  it('says whether that address is allowed to make browser requests', () => {
    expect(emailLinkOrigin('https://example.com', 'https://example.com').allowed).toBe(true);
    expect(emailLinkOrigin('https://www.example.com', 'https://example.com').allowed).toBe(false);
  });

  it('does not warn when no allowlist is configured at all', () => {
    expect(emailLinkOrigin('http://localhost:5173', '').allowed).toBe(true);
  });

  it('falls back to the development site rather than an empty string', () => {
    expect(emailLinkOrigin('', '').origin).toBe('http://localhost:5173');
  });
});
