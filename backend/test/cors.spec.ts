import { describe, expect, it } from 'vitest';
import { decideCorsOrigin } from '../src/common/cors';

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
