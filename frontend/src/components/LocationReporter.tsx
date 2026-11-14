import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Alert } from './ui';

/**
 * WHERE THE RIDER'S POSITION COMES FROM
 *
 * This component is the only thing in the browser that reads the device GPS. It
 * runs while a rider is online, reports at the cadence the API advertises
 * (`/rider/location/config`, from TRACKING_PING_INTERVAL_SECONDS), and attaches
 * the ping to the job the rider is currently carrying.
 *
 * Three behaviours matter more than the happy path:
 *
 *   · **Permission denied is a first-class state.** The rider sees a clear banner
 *     explaining that dispatch cannot see them and offers will stop arriving, with
 *     a retry button. Nothing is sent, and no position is invented — the platform
 *     would rather have no marker than a wrong one.
 *   · **A failed ping never blocks the app.** Errors are counted and shown, the
 *     loop keeps going, and the next ping may well succeed.
 *   · **Pings are cheap.** A watchPosition fix is reused between ticks instead of
 *     waking the GPS on a timer, so a rider's battery is not spent on a map.
 */

type GeoState = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable';

interface PingConfig {
  pingIntervalSeconds: number;
  retentionDays: number;
  staleAfterSeconds: number;
}

export function LocationReporter({ deliveryId }: { deliveryId?: string | null }) {
  const [state, setState] = useState<GeoState>('idle');
  const [lastSentAt, setLastSentAt] = useState<Date | null>(null);
  const [failures, setFailures] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const fix = useRef<GeolocationPosition | null>(null);
  const sending = useRef(false);

  const config = useQuery({
    queryKey: ['rider', 'location-config'],
    queryFn: () => api.get<PingConfig>('/rider/location/config'),
    staleTime: 10 * 60 * 1000,
  });
  const intervalMs = Math.max(5, config.data?.pingIntervalSeconds ?? 15) * 1000;

  // Watch the device while mounted; `attempt` lets the retry button restart it.
  useEffect(() => {
    if (!navigator.geolocation) {
      setState('unavailable');
      return;
    }
    setState('requesting');
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        fix.current = position;
        setState('granted');
      },
      (error) => {
        setState(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [attempt]);

  const send = useCallback(async () => {
    const position = fix.current;
    if (!position || sending.current) return;
    sending.current = true;
    try {
      await api.post('/rider/location', {
        lat: Number(position.coords.latitude.toFixed(6)),
        lng: Number(position.coords.longitude.toFixed(6)),
        accuracyM: position.coords.accuracy ? Math.round(position.coords.accuracy) : undefined,
        speedKph:
          position.coords.speed != null && position.coords.speed >= 0
            ? Math.round(position.coords.speed * 3.6)
            : undefined,
        heading: position.coords.heading != null && !Number.isNaN(position.coords.heading)
          ? Math.round(position.coords.heading)
          : undefined,
        ...(deliveryId ? { deliveryId } : {}),
      });
      setLastSentAt(new Date());
      setFailures(0);
    } catch {
      setFailures((count) => count + 1);
    } finally {
      sending.current = false;
    }
  }, [deliveryId]);

  // Send immediately once a fix exists, then keep to the advertised cadence.
  useEffect(() => {
    if (state !== 'granted') return;
    void send();
    const timer = setInterval(() => void send(), intervalMs);
    return () => clearInterval(timer);
  }, [state, send, intervalMs]);

  if (state === 'idle' || state === 'requesting') return null;

  if (state === 'denied') {
    return (
      <Alert tone="warning" title="Location permission is blocked">
        We cannot see you, so you will not receive any offers. Allow location for this site in your browser
        settings, then{' '}
        <button type="button" className="font-semibold underline" onClick={() => setAttempt((value) => value + 1)}>
          try again
        </button>
        . Nothing is being sent, and no position is being guessed on your behalf.
      </Alert>
    );
  }

  if (state === 'unavailable') {
    return (
      <Alert tone="warning" title="Your device is not reporting a position">
        This can happen indoors or with GPS switched off. Retry from somewhere with a clearer view of the sky.
      </Alert>
    );
  }

  if (failures > 0) {
    return (
      <Alert tone="warning" title="Your location is not getting through">
        We could not send your position {failures} time{failures === 1 ? '' : 's'}. We will keep trying every{' '}
        {Math.round(intervalMs / 1000)} seconds. Last successful update:{' '}
        {lastSentAt ? lastSentAt.toLocaleTimeString('en-NG') : 'none yet'}.
      </Alert>
    );
  }

  // Success is deliberately quiet: a small line, not a banner.
  return (
    <p className="text-[11px] text-ink-400">
      Sharing your position{lastSentAt ? ` · last report ${lastSentAt.toLocaleTimeString('en-NG')}` : ''} · every{' '}
      {Math.round(intervalMs / 1000)} s while this screen is open
    </p>
  );
}
