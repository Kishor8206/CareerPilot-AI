import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationDto } from '@careerpilot/shared';
import { apiGet, apiGetPaginated, apiPost } from '@/services/api';
import { getSocket } from '@/services/socket';

/**
 * Notification list plus live delivery over Socket.IO (§25).
 *
 * Polling is kept as a slow fallback so a dropped socket does not leave the
 * badge permanently stale, but the socket does the real work.
 */
export function useNotifications() {
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiGetPaginated<NotificationDto>('/notifications', { limit: 20 }),
    staleTime: 30_000,
  });

  const unread = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => apiGet<{ unreadCount: number }>('/notifications/unread-count'),
    refetchInterval: 120_000,
    staleTime: 30_000,
  });

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onNew = () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    };

    socket.on('notification:new', onNew);
    return () => {
      socket.off('notification:new', onNew);
    };
  }, [queryClient]);

  const markRead = useMutation({
    mutationFn: (id: string) => apiPost(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => apiPost('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return {
    notifications: list.data?.items ?? [],
    unreadCount: unread.data?.unreadCount ?? 0,
    isLoading: list.isLoading,
    markRead,
    markAllRead,
  };
}
