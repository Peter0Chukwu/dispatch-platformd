import { cn } from '../../lib/cn';

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card-surface', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b border-ink-200 px-5 py-4', className)}>
      <div>
        <h3 className="text-base font-semibold text-ink-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('p-5', className)}>{children}</div>;
}

/**
 * Dashboard statistic card. `delta` is intentionally a string produced by the
 * caller from real data — never a hardcoded "+12%" in the component.
 */
export function StatCard({
  label,
  value,
  delta,
  deltaTone = 'neutral',
  hint,
  icon,
  isLoading,
}: {
  label: string;
  value: React.ReactNode;
  delta?: string;
  deltaTone?: 'up' | 'down' | 'neutral';
  hint?: string;
  icon?: React.ReactNode;
  isLoading?: boolean;
}) {
  const deltaColour =
    deltaTone === 'up' ? 'text-accent-700 bg-accent-50' : deltaTone === 'down' ? 'text-danger-700 bg-danger-50' : 'text-ink-600 bg-ink-100';
  return (
    <div className="card-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-500">{label}</p>
        {icon && <span className="text-brand-400">{icon}</span>}
      </div>
      {isLoading ? (
        <div className="mt-3 h-8 w-24 animate-pulse rounded bg-ink-200" />
      ) : (
        <p className="mt-2 text-2xl font-bold tracking-tight text-ink-900">{value}</p>
      )}
      <div className="mt-2 flex items-center gap-2">
        {delta && <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', deltaColour)}>{delta}</span>}
        {hint && <span className="text-xs text-ink-500">{hint}</span>}
      </div>
    </div>
  );
}
