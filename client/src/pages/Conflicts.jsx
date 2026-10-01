import { useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { GitMerge, CheckCircle2, Crown, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync, useTitle } from '../lib/hooks';
import { useToast } from '../context/ToastContext';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui';
import { PriorityBadge, ProblemList } from '../components/booking-ui';
import { RejectModal } from '../components/BookingActions';
import { PURPOSE_LABELS, ROLE_LABELS, describeBooking, fmtDate, fmtRange, fmtTime } from '../lib/format';

function ConflictGroup({ group, onResolved }) {
  const toast = useToast();
  const [winner, setWinner] = useState(group.recommended_id);
  const [busy, setBusy] = useState(false);
  const resolve = async () => {
    setBusy(true);
    try {
      await api.post('/bookings/conflicts/resolve', { winner_id: winner, loser_ids: group.bookings.filter((b) => b.id !== winner).map((b) => b.id) });
      toast.success('Conflict resolved — requesters have been notified');
      onResolved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader
        title={`${group.lab_name} · ${fmtDate(group.date)}`}
        subtitle={`${group.bookings.length} overlapping pending requests — only one can be approved`}
        icon={GitMerge}
        action={<Button size="sm" onClick={resolve} loading={busy}>Approve selected, reject others</Button>}
      />
      <ul className="divide-y divide-slate-100">
        {group.bookings.map((b) => (
          <li key={b.id}>
            <label className={clsx('flex cursor-pointer gap-3 px-5 py-3', winner === b.id && 'bg-emerald-50/60')}>
              <input type="radio" name={`g-${group.lab_id}-${group.date}`} checked={winner === b.id} onChange={() => setWinner(b.id)} className="mt-1 size-4 text-emerald-600" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium tabular">{fmtTime(b.start_time)}–{fmtTime(b.end_time)}</span>
                  <PriorityBadge level={b.priority} score={b.priority_score} />
                  {b.id === group.recommended_id && (
                    <Badge tone="emerald"><Crown className="size-3" /> Recommended</Badge>
                  )}
                  <Link to={`/bookings/${b.id}`} className="font-mono text-xs text-slate-500 hover:text-brand-700">{b.ref_code}</Link>
                </div>
                <p className="mt-0.5 text-sm text-slate-700">
                  {b.user_name} <span className="text-slate-500">({ROLE_LABELS[b.user_role]})</span> · {PURPOSE_LABELS[b.purpose_type]}
                </p>
                {b.purpose && <p className="text-xs text-slate-500">{b.purpose}</p>}
              </div>
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function Conflicts() {
  useTitle('Conflicts');
  const { data, error, loading, reload } = useAsync(() => api.get('/bookings/conflicts'), []);
  const [reject, setReject] = useState(null);

  return (
    <div>
      <PageHeader title="Conflict center" subtitle="Overlapping requests for the same lab and requests that can no longer be satisfied. The highest-priority request is recommended." />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading || !data ? (
        <Skeleton className="h-64" />
      ) : data.groups.length === 0 && data.blocked.length === 0 ? (
        <Card>
          <EmptyState icon={CheckCircle2} title="No conflicts" description="Every pending request can be approved independently." />
        </Card>
      ) : (
        <div className="space-y-6">
          {data.groups.map((g) => <ConflictGroup key={`${g.lab_id}-${g.date}-${g.bookings[0].id}`} group={g} onResolved={() => reload(true)} />)}
          {data.blocked.length > 0 && (
            <Card className="border-red-200">
              <CardHeader title="Requests blocked by existing bookings" subtitle="These pending requests overlap approved bookings, blocks or have insufficient equipment" icon={AlertTriangle} />
              <ul className="divide-y divide-slate-100">
                {data.blocked.map((b) => (
                  <li key={b.id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <Link to={`/bookings/${b.id}`} className="text-sm font-medium hover:text-brand-700">{describeBooking(b)}</Link>
                      <p className="text-xs text-slate-500">{b.ref_code} · {b.user_name} · {fmtRange(b)}</p>
                      <div className="mt-1"><ProblemList problems={b.conflict.problems} /></div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => setReject(b)}>Reject with reason</Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
      <RejectModal booking={reject} open={!!reject} onClose={() => setReject(null)} onDone={() => reload(true)} />
    </div>
  );
}
