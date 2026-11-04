import { cn } from '../../lib/cn';

export type Tone = 'neutral' | 'info' | 'warning' | 'success' | 'danger' | 'brand';

const TONES: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-700 ring-ink-200',
  info: 'bg-info-50 text-info-700 ring-info-200',
  warning: 'bg-warning-50 text-warning-700 ring-warning-200',
  success: 'bg-accent-50 text-accent-700 ring-accent-200',
  danger: 'bg-danger-50 text-danger-700 ring-danger-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const DOT: Record<Tone, string> = {
  neutral: 'bg-ink-400',
  info: 'bg-info-500',
  warning: 'bg-warning-500',
  success: 'bg-accent-500',
  danger: 'bg-danger-500',
  brand: 'bg-brand-500',
};

/** Delivery status pill — uses the shared status→tone map so every portal agrees. */
export function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <Badge tone={tone}>
      <span className={cn('h-1.5 w-1.5 rounded-full', DOT[tone])} aria-hidden="true" />
      {label}
    </Badge>
  );
}
