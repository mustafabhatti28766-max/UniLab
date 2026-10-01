import { Link } from 'react-router-dom';
import { ListOrdered, BellRing, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync, useTitle } from '../lib/hooks';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, Tabs } from '../components/ui';
import { fmtDate, fmtTime, timeAgo } from '../lib/format';
import { useState } from 'react';

const TONE = { waiting: 'amber', notified: 'emerald', booked: 'blue', expired: 'slate', cancelled: 'slate' };

export default function Waitlist() {
  useTitle('Waitlist');
  const toast = useToast();
  const { can } = useAuth();
  const isManager = can('bookings.view_all');
  const [scope, setScope] = useState('mine');
  const { data, error, loading, reload } = useAsync(() => api.get(`/waitlist${scope === 'manage' ? '?scope=manage' : ''}`), [scope]);

  const cancel = async (w) => {
    try {
      await api.del(`/waitlist/${w.id}`);
      toast.success('Removed from waitlist');
      reload(true);
    } catch (err) {
      toast.error(err);
    }
  };
  const bookLink = (w) => {
    const p = new URLSearchParams({ date: w.start_at.slice(0, 10), start: w.start_at.slice(11, 16), end: w.end_at.slice(11, 16) });
    if (w.resource_type === 'lab') p.set('lab', w.resource_id);
    else {
      p.set('equipment', w.resource_id);
      p.set('qty', w.quantity);
    }
    return `/book?${p}`;
  };

  return (
    <div>
      <PageHeader title="Waitlist" subtitle="When a fully booked lab or item frees up (cancellation, rejection or early return), you're notified immediately." />
      {isManager && (
        <Tabs value={scope} onChange={setScope} className="mb-4" tabs={[{ value: 'mine', label: 'My waitlist' }, { value: 'manage', label: 'All active entries' }]} />
      )}
      <Card>
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <div className="space-y-2 p-4">{[0, 1].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : data.length === 0 ? (
          <EmptyState icon={ListOrdered} title="No waitlist entries" description="If a slot is fully booked, choose “Join the waitlist” on the booking page." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((w) => (
              <li key={w.id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {w.resource_type === 'equipment' ? `${w.quantity} × ` : ''}
                    {w.resource_name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {fmtDate(w.start_at)} · {fmtTime(w.start_at.slice(11, 16))}–{fmtTime(w.end_at.slice(11, 16))} · joined {timeAgo(w.created_at)}
                    {scope === 'manage' && ` · ${w.user_name}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={TONE[w.status]}>{w.status === 'notified' ? 'Available now!' : w.status}</Badge>
                  {w.status === 'notified' && scope === 'mine' && (
                    <Link to={bookLink(w)}>
                      <Button size="xs" icon={BellRing}>Book now</Button>
                    </Link>
                  )}
                  {['waiting', 'notified'].includes(w.status) && (
                    <Button size="xs" variant="ghost" icon={X} onClick={() => cancel(w)}>Leave</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
