import * as React from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '@/utils/cn';

type ToastVariant = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (input: { title: string; description?: string; variant?: ToastVariant }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

/** Toast notifications for action feedback. Errors persist longer than successes. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    ({ title, description, variant = 'info' }: { title: string; description?: string; variant?: ToastVariant }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((current) => [...current.slice(-3), { id, title, description, variant }]);
      // An error needs longer to read, and often names a corrective action.
      setTimeout(() => dismiss(id), variant === 'error' ? 8000 : 4000);
    },
    [dismiss],
  );

  const value = React.useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description) => toast({ title, description, variant: 'success' }),
      error: (title, description) => toast({ title, description, variant: 'error' }),
    }),
    [toast],
  );

  const styles: Record<ToastVariant, { wrapper: string; icon: string; Icon: typeof Info }> = {
    success: { wrapper: 'border-success/30 bg-card', icon: 'text-success', Icon: CheckCircle2 },
    error: { wrapper: 'border-destructive/30 bg-card', icon: 'text-destructive', Icon: AlertCircle },
    info: { wrapper: 'border-border bg-card', icon: 'text-info', Icon: Info },
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        {toasts.map((item) => {
          const style = styles[item.variant];
          const Icon = style.Icon;
          return (
            <div
              key={item.id}
              className={cn(
                'pointer-events-auto flex animate-fade-in items-start gap-3 rounded-lg border p-4 shadow-lg',
                style.wrapper,
              )}
              role={item.variant === 'error' ? 'alert' : 'status'}
            >
              <Icon className={cn('mt-0.5 size-4 shrink-0', style.icon)} aria-hidden />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm font-medium leading-snug">{item.title}</p>
                {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Dismiss notification"
              >
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider');
  return context;
}
