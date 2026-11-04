import { cn } from '../../lib/cn';
import { formatNaira, formatNairaCompact } from '@dispatch/shared';

/**
 * The ONLY component that renders money. Amounts arrive from the API as strings
 * (BigInt kobo serialised safely); this formats them as ₦ with no float maths.
 * `signed` renders +/- for ledger-style views.
 */
export function MoneyText({
  kobo,
  size = 'md',
  compact = false,
  signed = false,
  muted = false,
  className,
}: {
  kobo: string | number | bigint | null | undefined;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  compact?: boolean;
  signed?: boolean;
  muted?: boolean;
  className?: string;
}) {
  if (kobo === null || kobo === undefined) {
    return <span className={cn('text-ink-400', className)}>—</span>;
  }
  const amount = BigInt(typeof kobo === 'number' ? Math.round(kobo) : kobo);
  const text = compact ? formatNairaCompact(amount) : formatNaira(amount);
  const sizes = { sm: 'text-sm', md: 'text-base', lg: 'text-lg', xl: 'text-2xl font-bold' }[size];
  return (
    <span
      className={cn(
        'tabular-nums',
        sizes,
        muted ? 'text-ink-500' : 'text-ink-900',
        signed && amount > 0n && 'text-accent-700',
        signed && amount < 0n && 'text-danger-600',
        className,
      )}
    >
      {signed && amount > 0n ? '+' : ''}
      {text}
    </span>
  );
}
