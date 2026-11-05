import { formatNaira } from '@dispatch/shared';
import type { QuoteLine } from '../hooks/useDeliveries';
import { cn } from '../lib/cn';

/**
 * The price, line by line, exactly as the server calculated it.
 * Every number here was computed in kobo on the server — the browser only formats.
 */
export function PriceBreakdown({
  lines,
  totalKobo,
  compact = false,
  meta,
}: {
  lines: QuoteLine[];
  totalKobo: string;
  compact?: boolean;
  meta?: { distanceKm?: number; durationMinutes?: number; routeSource?: string; zoneName?: string | null };
}) {
  return (
    <div className={cn('rounded-xl border border-ink-200 bg-white', compact ? 'p-3.5' : 'p-4')}>
      <dl className="space-y-2 text-sm">
        {lines
          .filter((line) => line.label !== 'Total')
          .map((line) => (
            <div key={line.label} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <dt className="text-ink-700">{line.label}</dt>
                {line.note && <p className="text-xs text-ink-400">{line.note}</p>}
              </div>
              <dd
                className={cn(
                  'shrink-0 font-medium tabular-nums',
                  line.kind === 'discount' ? 'text-accent-700' : 'text-ink-800',
                )}
              >
                {line.kind === 'discount' ? '−' : ''}
                {formatNaira(line.amountKobo.replace('-', ''))}
              </dd>
            </div>
          ))}
      </dl>

      <div className="mt-3 flex items-center justify-between border-t border-ink-200 pt-3">
        <span className="text-sm font-semibold text-ink-900">Total</span>
        <span className="text-lg font-bold tabular-nums text-ink-900">{formatNaira(totalKobo)}</span>
      </div>

      {meta && (
        <p className="mt-2 text-xs text-ink-400">
          {meta.distanceKm !== undefined && `${meta.distanceKm} km`}
          {meta.durationMinutes !== undefined && ` · ~${meta.durationMinutes} min`}
          {meta.zoneName && ` · ${meta.zoneName}`}
          {meta.routeSource === 'STUB' && ' · straight-line estimate'}
        </p>
      )}
    </div>
  );
}
