import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { Bell, CheckCheck, Trash2, BellRing } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync, useTitle } from '../lib/hooks';
import { useNotifications } from '../context/NotificationContext';
import { useToast } from '../context/ToastContext';
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui';
import { fmtDateTime, timeAgo } from '../lib/format';

export default function Notifications() {
  useTitle('Notifications');
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh, requestPush } = useNotifications();
  const { data, error, loading, reload } = useAsync(() => api.get('/notifications?limit=100'), []);
  const pushState = 'Notification' in window ? Notification.permission : 'unsupported';

  const open = async (n) => {
    if (!n.is_read) await api.post(`/notifications/${n.id}/read`).catch(() => {});
    refresh();
    if (n.link) navigate(n.link);
    else reload(true);
  };
  const remove = async (n) => {
    await api.del(`/notifications/${n.id}`);
    reload(true);
    refresh();
  };
  const readAll = async () => {
    await api.post('/notifications/read-all');
    reload(true);
    refresh();
  };
  const enablePush = async () => {
    const r = await requestPush();
    if (r === 'granted') toast.success('Browser notifications enabled');
    else toast.info('Notifications were not enabled');
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle="Approvals, rejections, reminders, overdue alerts and waitlist updates."
        actions={
          <>
            {pushState === 'default' && <Button variant="secondary" icon={BellRing} onClick={enablePush}>Enable push notifications</Button>}
            <Button variant="secondary" icon={CheckCheck} onClick={readAll}>Mark all read</Button>
          </>
        }
      />
      <Card>
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : data.data.length === 0 ? (
          <EmptyState icon={Bell} title="No notifications yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.data.map((n) => (
              <li key={n.id} className={clsx('flex items-start gap-3 px-5 py-3', !n.is_read && 'bg-brand-50/40')}>
                <span className={clsx('mt-2 size-2 shrink-0 rounded-full', n.is_read ? 'bg-slate-200' : 'bg-brand-600')} aria-hidden />
                <button onClick={() => open(n)} className="min-w-0 flex-1 text-left">
                  <p className="text-sm font-medium text-slate-900">{n.title}</p>
                  <p className="text-sm text-slate-600">{n.message}</p>
                  <p className="mt-0.5 text-xs text-slate-400" title={fmtDateTime(n.created_at)}>{timeAgo(n.created_at)}</p>
                </button>
                <button onClick={() => remove(n)} className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600" aria-label="Delete notification">
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
