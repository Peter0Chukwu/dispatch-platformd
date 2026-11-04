import { useEffect, useState } from 'react';

/**
 * Counts down to an absolute deadline.
 *
 * The remaining time is always recomputed from `expiresAt` on every tick rather
 * than decremented, so a backgrounded tab, a slow render or a throttled timer
 * cannot make the clock drift into the future. When the deadline passes the
 * component reports it once, and the caller refetches — the server is the only
 * authority on whether the offer is really gone.
 */
export function useCountdown(expiresAt: string | undefined, onExpire?: () => void) {
  const remaining = () => {
    if (!expiresAt) return 0;
    return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000));
  };
  const [secondsLeft, setSecondsLeft] = useState(remaining);

  useEffect(() => {
    setSecondsLeft(remaining());
    if (!expiresAt) return;
    const timer = window.setInterval(() => {
      const next = remaining();
      setSecondsLeft(next);
      if (next === 0) {
        window.clearInterval(timer);
        onExpire?.();
      }
    }, 250);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);

  return secondsLeft;
}

/** Circular countdown ring: the arc drains as the offer runs out. */
export function OfferCountdown({
  expiresAt,
  totalSeconds,
  onExpire,
  size = 56,
}: {
  expiresAt: string;
  totalSeconds: number;
  onExpire?: () => void;
  size?: number;
}) {
  const secondsLeft = useCountdown(expiresAt, onExpire);
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = totalSeconds > 0 ? Math.min(1, secondsLeft / totalSeconds) : 0;
  const urgent = secondsLeft <= 5;

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="timer"
      aria-live={urgent ? 'assertive' : 'off'}
      aria-label={`${secondsLeft} seconds left to accept`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={4} className="stroke-ink-200" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          className={urgent ? 'stroke-danger-500 transition-[stroke-dashoffset] duration-200' : 'stroke-accent-500 transition-[stroke-dashoffset] duration-200'}
        />
      </svg>
      <span
        className={
          urgent
            ? 'absolute text-sm font-bold tabular-nums text-danger-600'
            : 'absolute text-sm font-bold tabular-nums text-ink-800'
        }
      >
        {secondsLeft}
      </span>
    </div>
  );
}
