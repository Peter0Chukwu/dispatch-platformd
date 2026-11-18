import { describe, expect, it } from 'vitest';
import { cleanToken, firstOrigin } from '../src/auth/verification.service';

/**
 * The link inside a verification email.
 *
 * It is built from `FRONTEND_URL`, and the failure this guards against is the one
 * that actually happened: a comma-separated CORS list pasted into that variable
 * produced `https://www.example.com,https://example.com/verify?token=…` — a link
 * no browser will open, sent to every new customer.
 */
describe('phase 7 — the address in a verification link', () => {
  it('takes one origin from a comma-separated list', () => {
    expect(firstOrigin('https://www.traderswelfarelogistics.online,https://traderswelfarelogistics.online')).toBe(
      'https://www.traderswelfarelogistics.online',
    );
  });

  it('keeps a plain origin exactly as it is', () => {
    expect(firstOrigin('https://traderswelfarelogistics.online')).toBe('https://traderswelfarelogistics.online');
  });

  it('drops a trailing slash so the path does not double up', () => {
    expect(firstOrigin('https://traderswelfarelogistics.online/')).toBe('https://traderswelfarelogistics.online');
    expect(firstOrigin('https://traderswelfarelogistics.online///')).toBe('https://traderswelfarelogistics.online');
  });

  it('tolerates spaces around the entries', () => {
    expect(firstOrigin('  https://a.example , https://b.example  ')).toBe('https://a.example');
  });

  it('says nothing when nothing is configured', () => {
    expect(firstOrigin(undefined)).toBeNull();
    expect(firstOrigin('')).toBeNull();
    expect(firstOrigin('   ')).toBeNull();
    expect(firstOrigin(',https://b.example')).toBe('https://b.example');
  });
});

/**
 * The token a person actually sends back.
 *
 * Both failures here are copies of what really happened: a full stop glued to the
 * end of the link by the sentence, and the whole URL pasted into a box that wanted
 * only the code.
 */
describe('phase 7 — reading the token back', () => {
  const token = '3xCfKl3MuCo4qPeh5VZur4K80n05ML_T3gv2dcVMXuM';

  it('accepts the bare token', () => {
    expect(cleanToken(token)).toBe(token);
  });

  it('drops the full stop a sentence left behind', () => {
    expect(cleanToken(`${token}.`)).toBe(token);
  });

  it('pulls the token out of a whole pasted link, punctuation and all', () => {
    expect(cleanToken(`https://www.example.com/reset-password?token=${token}.`)).toBe(token);
  });

  it('survives a leading or trailing space from a copy', () => {
    expect(cleanToken(`  ${token}  `)).toBe(token);
  });

  it('stops at the first space, so the rest of the sentence is not swallowed', () => {
    expect(cleanToken(`${token} and then some words`)).toBe(token);
  });

  it('returns something that simply will not match when the input is nonsense', () => {
    // No crash, no exception — just a token that the lookup will refuse.
    expect(cleanToken('not a link at all')).toBe('not');
  });
});
