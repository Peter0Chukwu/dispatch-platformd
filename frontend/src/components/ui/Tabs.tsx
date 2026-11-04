import { cn } from '../../lib/cn';

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex gap-1 overflow-x-auto rounded-xl bg-ink-100 p-1', className)} role="tablist">
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.value)}
            className={cn(
              'touch-target whitespace-nowrap rounded-lg px-3.5 text-sm font-medium transition-colors',
              selected ? 'bg-white text-brand-900 shadow-sm' : 'text-ink-600 hover:text-ink-900',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={cn('ml-1.5 text-xs', selected ? 'text-ink-500' : 'text-ink-400')}>({tab.count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
