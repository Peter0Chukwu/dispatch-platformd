import { cn } from '../../lib/cn';

export function Alert({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  const styles = {
    info: 'border-info-200 bg-info-50 text-info-700',
    success: 'border-accent-200 bg-accent-50 text-accent-800',
    warning: 'border-warning-200 bg-warning-50 text-warning-800',
    danger: 'border-danger-200 bg-danger-50 text-danger-700',
  }[tone];
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border p-3.5 text-sm', styles)} role="status">
      <div className="flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-1', 'text-[13px] leading-relaxed opacity-90')}>{children}</div>}
      </div>
      {action}
    </div>
  );
}
