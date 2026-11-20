import { pageRedirectTarget } from '../src/common/page-fallback';

const SITE = 'https://traderswelfarelogistics.online';

describe('a page request that reached the API', () => {
  it('is sent to the same path on the site, query string intact', () => {
    expect(
      pageRedirectTarget({
        method: 'GET',
        accept: 'text/html,application/xhtml+xml',
        path: '/reset-password?token=abc123',
        host: 'www.traderswelfarelogistics.online',
        siteOrigin: SITE,
      }),
    ).toBe('https://traderswelfarelogistics.online/reset-password?token=abc123');
  });

  it('is left alone when the API itself is the site', () => {
    expect(
      pageRedirectTarget({
        method: 'GET',
        accept: 'text/html',
        path: '/reset-password',
        host: 'traderswelfarelogistics.online',
        siteOrigin: SITE,
      }),
    ).toBeNull();
  });

  it('never redirects the API namespace', () => {
    expect(
      pageRedirectTarget({
        method: 'GET',
        accept: 'text/html',
        path: '/api/v1/chat/unread',
        host: 'www.example.com',
        siteOrigin: SITE,
      }),
    ).toBeNull();
  });

  it('never redirects the socket handshake', () => {
    expect(
      pageRedirectTarget({
        method: 'GET',
        accept: 'text/html',
        path: '/socket.io/?EIO=4&transport=polling',
        host: 'www.example.com',
        siteOrigin: SITE,
      }),
    ).toBeNull();
  });

  it('leaves JSON clients with a JSON 404', () => {
    expect(
      pageRedirectTarget({
        method: 'GET',
        accept: 'application/json',
        path: '/reset-password',
        host: 'www.example.com',
        siteOrigin: SITE,
      }),
    ).toBeNull();
    expect(
      pageRedirectTarget({
        method: 'POST',
        accept: 'text/html',
        path: '/reset-password',
        host: 'www.example.com',
        siteOrigin: SITE,
      }),
    ).toBeNull();
  });

  it('does nothing when the site address is unparseable', () => {
    expect(
      pageRedirectTarget({
        method: 'GET',
        accept: 'text/html',
        path: '/login',
        host: 'www.example.com',
        siteOrigin: 'not a url',
      }),
    ).toBeNull();
  });
});
