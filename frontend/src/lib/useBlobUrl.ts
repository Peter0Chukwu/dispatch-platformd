import { getAccessToken } from './api';
import { useEffect, useState } from 'react';

/**
 * Turns a private API path into something an <img> can show.
 *
 * The access token lives in memory and is sent as an Authorization header, so a
 * plain `src="/api/v1/files/..."` arrives unauthenticated and the browser paints
 * a broken image. Here the bytes are fetched with the token, wrapped in an object
 * URL, and released when the component unmounts or the source changes.
 *
 * A null result means "show the fallback" — never an error box. A missing avatar
 * is a normal state, not a failure.
 */
export function useBlobUrl(src: string | null | undefined): { url: string | null; loading: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!src);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    if (!src) {
      setUrl(null);
      setLoading(false);
      return;
    }

    // Anything that is not our own API (a data URL, an external avatar) is used as-is.
    if (!src.startsWith('/api/')) {
      setUrl(src);
      setLoading(false);
      return;
    }

    setLoading(true);
    void (async () => {
      try {
        const token = getAccessToken();
        const response = await fetch(src, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          credentials: 'include',
        });
        if (!response.ok) throw new Error(`image ${response.status}`);
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (!cancelled) setUrl(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  return { url, loading };
}
