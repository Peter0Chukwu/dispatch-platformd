import { useLiveStatus } from '../lib/live';
import { cn } from '../lib/cn';

/**
 * Honest connection badge. "Live" means the socket is actually connected right now —
 * it is not decoration. When the channel drops the screens fall back to refetching on
 * navigation, and the badge says so instead of pretending.
 */
export function LiveIndicator() {
  const isLive = useLiveStatus();
  return (
    <span
      className="hidden items-center gap-1.5 rounded-full border border-ink-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-ink-600 sm:inline-flex"
      title={isLive ? 'Connected for live dispatch updates' : 'Reconnecting to live updates…'}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          isLive ? 'bg-accent-500' : 'bg-warning-500 animate-pulse',
        )}
      />
      {isLive ? 'Live' : 'Reconnecting'}
    </span>
  );
}
