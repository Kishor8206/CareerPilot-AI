import * as React from 'react';
import { Link } from 'react-router-dom';
import { BellOff, CheckCheck } from 'lucide-react';
import { Button, Spinner } from '@/components/ui';
import { useNotifications } from '@/hooks/useNotifications';
import { formatRelative } from '@/utils/format';
import { cn } from '@/utils/cn';

export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const { notifications, unreadCount, isLoading, markRead, markAllRead } = useNotifications();
  const ref = React.useRef<HTMLDivElement>(null);

  // Dismiss on an outside click, so the panel behaves like a popover.
  React.useEffect(() => {
    function handler(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    // Deferred so the click that opened the panel does not immediately close it.
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] animate-fade-in overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
      role="dialog"
      aria-label="Notifications"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Notifications</h3>
        {unreadCount > 0 && (
          <Button variant="ghost" size="sm" onClick={() => markAllRead.mutate()} loading={markAllRead.isPending}>
            <CheckCheck className="size-3.5" />
            Mark all read
          </Button>
        )}
      </div>

      <div className="max-h-96 overflow-y-auto scrollbar-thin">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <BellOff className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">You have no notifications yet.</p>
          </div>
        ) : (
          <ul>
            {notifications.map((notification) => {
              const body = (
                <div
                  className={cn(
                    'border-b border-border px-4 py-3 transition-colors hover:bg-accent',
                    !notification.read && 'bg-primary/5',
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!notification.read && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                    <div className={cn('min-w-0 flex-1', notification.read && 'pl-3.5')}>
                      <p className="text-sm font-medium leading-snug">{notification.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{notification.body}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{formatRelative(notification.createdAt)}</p>
                    </div>
                  </div>
                </div>
              );

              return (
                <li key={notification.id}>
                  {notification.link ? (
                    <Link
                      to={notification.link}
                      onClick={() => {
                        if (!notification.read) markRead.mutate(notification.id);
                        onClose();
                      }}
                      className="block"
                    >
                      {body}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="block w-full text-left"
                      onClick={() => !notification.read && markRead.mutate(notification.id)}
                    >
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
