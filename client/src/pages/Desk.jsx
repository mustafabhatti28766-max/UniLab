import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PackageCheck, LogIn, CheckCircle2, ScanLine, AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync, useInterval, useTitle } from '../lib/hooks';
import { useToast } from '../context/ToastContext';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, Tabs } from '../components/ui';
import { BookingRow } from '../components/booking-ui';
import { ReturnModal } from '../components/BookingActions';
import { fmtDateTime, nowLocal, timeAgo } from '../lib/format';

export default function Desk() {
  useTitle('Issue & return desk');
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api.get('/desk'), []);
  const [tab, setTab] = useState('to_issue');
  const [returning, setReturning] = useState(null);
  const [busy, setBusy] = useState(null);
  useInterval(() => reload(true), 60000);

  const run = async (b, path, msg) => {
    setBusy(b.id);
    try {
      await api.post(`/bookings/${b.id}/${path}`);
      toast.success(msg);
      reload(true);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  const lists = data || { to_issue: [], upcoming: [], in_use: [], overdue: [], returned: [] };
  const now = nowLocal();

  const actionsFor = (b) => {
    if (tab === 'to_issue') {
      const early = b.start_at > now && (new Date(b.start_at) - new Date()) / 60000 > 60;
      return (
        <Button size="sm" icon={b.items.length ? PackageCheck : LogIn} loading={busy === b.id} disabled={early} title={early ? 'Check-in opens 60 minutes before start' : undefined} onClick={() => run(b, 'check-in', b.items.length ? 'Equipment issued' : 'Lab access granted')}>
          {b.items.length ? 'Issue' : 'Check in'}
        </Button>
      );
    }
    if (tab === 'in_use' || tab === 'overdue') {
      return b.items.length ? (
        <Button size="sm" variant={tab === 'overdue' ? 'danger' : 'primary'} icon={PackageCheck} onClick={() => setReturning(b)}>Return</Button>
      ) : (
        <Button size="sm" variant="success" icon={CheckCircle2} loading={busy === b.id} onClick={() => run(b, 'complete', 'Lab checked out')}>Check out</Button>
      );
    }
    return null;
  };

  const current = lists[tab] || [];
  return (
    <div>
      <PageHeader
        title="Issue & return desk"
        subtitle="Hand out equipment, grant lab access, confirm returns and record damage."
        actions={
          <>
            <Button variant="secondary" icon={RefreshCw} onClick={() => reload()}>Refresh</Button>
            <Link to="/scan"><Button icon={ScanLine}>Scan QR / ID</Button></Link>
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'to_issue', label: 'Ready to issue today', count: lists.to_issue.length },
          { value: 'in_use', label: 'In use', count: lists.in_use.length },
          { value: 'overdue', label: 'Overdue', count: lists.overdue.length },
          { value: 'upcoming', label: 'Next 3 days', count: lists.upcoming.length },
          { value: 'returned', label: 'Recently returned' },
        ]}
      />
      <Card className="mt-4">
        {loading && !data ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : current.length === 0 ? (
          <EmptyState icon={tab === 'overdue' ? CheckCircle2 : PackageCheck} title={tab === 'overdue' ? 'Nothing overdue' : 'Nothing here right now'} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {current.map((b) => (
              <li key={b.id}>
                <BookingRow b={b} showUser actions={actionsFor(b)} />
                {(tab === 'in_use' || tab === 'overdue') && b.issues?.length > 0 && (
                  <p className={`-mt-1 flex items-center gap-1 px-4 pb-3 pl-15 text-xs ${tab === 'overdue' ? 'text-red-600' : 'text-slate-500'}`}>
                    {tab === 'overdue' ? <AlertTriangle className="size-3" /> : <Clock className="size-3" />}
                    {b.issues.map((i) => `${i.quantity} × ${i.equipment_name}`).join(', ')} · due {fmtDateTime(b.end_at)} ({timeAgo(b.end_at)})
                  </p>
                )}
                {tab === 'returned' && b.status !== 'completed' && (
                  <p className="-mt-1 px-4 pb-3 pl-15"><Badge tone={b.status === 'damaged' ? 'red' : 'orange'}>{b.status === 'damaged' ? 'Damage recorded' : 'Late return recorded'}</Badge></p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {returning && <ReturnModal booking={returning} issues={returning.issues} open onClose={() => setReturning(null)} onDone={() => reload(true)} />}
    </div>
  );
}
