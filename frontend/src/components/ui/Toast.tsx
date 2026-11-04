import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { cn } from '../../lib/cn';

type ToastTone = 'success' | 'error' | 'info' | 'warning';
type Toast = { id: string; title: string; description?: string; tone: ToastTone };

const ToastContext = createContext<{ notify: (toast: Omit<Toast, 'id'>) => void } | null>(null);

const TONES: Record<ToastTone, string> = {
  success: 'border-accent-200 bg-white text-ink-900',
  error: 'border-danger-200 bg-white text-ink-900',
  info: 'border-info-200 bg-white text-ink-900',
  warning: 'border-warning-200 bg-white text-ink-900',
};
const ACCENT: Record<ToastTone, string> = {
  success: 'bg-accent-500',
  error: 'bg-danger-500',
  info: 'bg-info-500',
  warning: 'bg-warning-500',
};

/** App-wide toast host. Mount once, call useToast() anywhere. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setToasts((current) => [...current, { ...toast, id }]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-4 sm:top-20 sm:bottom-auto sm:items-end"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={cn(
              'pointer-events-auto flex w-full max-w-sm animate-slide-in overflow-hidden rounded-xl border shadow-pop',
              TONES[toast.tone],
            )}
          >
            <span className={cn('w-1 shrink-0', ACCENT[toast.tone])} aria-hidden="true" />
            <div className="flex-1 px-3.5 py-3">
              <p className="text-sm font-semibold">{toast.title}</p>
              {toast.description && <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{toast.description}</p>}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="px-3 text-ink-400 transition-colors hover:text-ink-700"
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
