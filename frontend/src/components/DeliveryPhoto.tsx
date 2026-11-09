import { useEffect, useState } from 'react';
import { API_BASE, getAccessToken } from '../lib/api';

/**
 * Shows the parcel photo for a delivery.
 *
 * It cannot be a plain <img src="..."> because the access token lives in memory
 * and is sent as an Authorization header, not a cookie the browser attaches to
 * image requests. So the image is fetched with the token, turned into an object
 * URL, and revoked when the component unmounts.
 *
 * Renders nothing at all when the delivery has no photo, or when the server says
 * "not found" because this user is not entitled to see it — a viewer that always
 * draws an empty frame would look broken on every delivery without a photo.
 */
export function DeliveryPhoto({
  deliveryId,
  alt = 'Parcel photo',
  className = 'h-40 w-full rounded-xl object-cover',
}: {
  deliveryId: string;
  alt?: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'absent'>('loading');

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const token = getAccessToken();
        const response = await fetch(`${API_BASE}/deliveries/${deliveryId}/package-photo`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          credentials: 'include',
        });
        if (!response.ok) throw new Error(`photo ${response.status}`);
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setState('ready');
      } catch {
        if (!cancelled) setState('absent');
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [deliveryId]);

  if (state === 'absent') return null;
  if (state === 'loading') {
    return <div className={`animate-pulse bg-ink-100 ${className}`} aria-hidden />;
  }

  return <img src={url ?? undefined} alt={alt} className={className} />;
}
