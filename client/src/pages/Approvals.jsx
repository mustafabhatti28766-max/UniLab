import { useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Check, X, ArrowUpCircle, CheckCircle2, AlertTriangle, Users, Clock, Target, GitMerge } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAsync, useTitle } from '../lib/hooks';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, Tabs } from '../components/ui';
import { PriorityBadge, ProblemList } from '../components/booking-ui';
import { ApproveModal, RejectModal } from '../components/BookingActions';
import { PURPOSE_LABELS, ROLE_LABELS, describeBooking, fmtRange, timeAgo } from '../lib/format';

export default function Approvals() {
  useTitle('Approvals');
  const toast = useToast();
  const { user } = useAuth();
  const { refresh } = useNotifications();
  const [level, setLevel] = useState('');
  const { data, error, loading, reload } = useAsync(() => api.get(`/bookings/approvals${qs({ level })}`), [level]);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(null);

  const done = () => {
    reload(true);
    refresh();
  };
  const escalate = async (b) => {
    setBusy(b.id);
    try {
      await api.post(`/bookings/${b.id}/escalate`);
      toast.success(`${b.ref_code} escalated to the coordinator`);
      done();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Approval queue"
        subtitle="Requests are ordered by the priority recommendation — role, academic purpose, urgency, group size and reliability."
        actions={
          <Link to="/conflicts">
            <Button variant="secondary" icon={GitMerge}>Conflict center</Button>
          </Link>
        }
      />
      <Tabs
        value={level}
        onChange={setLevel}
        tabs={[
          { value: '', label: 'All pending' },
          { value: 'staff', label: 'Lab staff level' },
          { value: 'coordinator', label: 'Coordinator review' },
        ]}
      />
      <div className="mt-4 space-y-3">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)
        ) : data.length === 0 ? (
          <Card>
            <EmptyState icon={CheckCircle2} title="Queue is clear" description="There are no pending requests in your department." />
          </Card>
        ) : (
          data.map((b) => (
            <Card key={b.id} className={clsx('overflow-hidden', !b.conflict.available && 'border-red-200')}>
              <div className="flex flex-col gap-4 p-5 lg:flex-row">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <PriorityBadge level={b.priority} score={b.priority_score} />
                    <Link to={`/bookings/${b.id}`} className="font-mono text-sm font-semibold hover:text-brand-700">{b.ref_code}</Link>
                    <Badge tone={b.required_approval === 'coordinator' ? 'amber' : 'blue'}>{b.required_approval === 'coordinator' ? 'Coordinator review' : 'Staff approval'}</Badge>
                    {b.escalated ? <Badge tone="amber">Escalated</Badge> : null}
                    {b.conflict.available ? <Badge tone="emerald">Available</Badge> : <Badge tone="red">Conflict</Badge>}
                    {b.conflict.competing.length > 0 && <Badge tone="orange">{b.conflict.competing.length} competing request(s)</Badge>}
                    <span className="text-xs text-slate-400">submitted {timeAgo(b.created_at)}</span>
                  </div>
                  <p className="mt-2 font-medium text-slate-900">{describeBooking(b)}</p>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                    <span className="inline-flex items-center gap-1"><Clock className="size-3.5 text-slate-400" />{fmtRange(b)}</span>
                    <span className="inline-flex items-center gap-1"><Users className="size-3.5 text-slate-400" />{b.attendees} attendees</span>
                    <span className="inline-flex items-center gap-1"><Target className="size-3.5 text-slate-400" />{PURPOSE_LABELS[b.purpose_type]}</span>
                  </div>
                  {b.purpose && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">“{b.purpose}”</p>}
                  <p className="mt-2 text-xs text-slate-500">
                    {b.user_name} · {ROLE_LABELS[b.user_role]}
                    {b.user_department_code && ` · ${b.user_department_code}`}
                    {b.user_late_returns > 0 && <span className="font-medium text-amber-700"> · {b.user_late_returns} late return(s)</span>}
                  </p>
                  {!b.conflict.available && (
                    <div className="mt-3">
                      <ProblemList problems={b.conflict.problems} />
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-row flex-wrap gap-2 lg:w-44 lg:flex-col">
                  {b.can_approve ? (
                    <Button variant="success" icon={Check} onClick={() => setModal({ type: 'approve', b })} disabled={!b.conflict.available}>Approve</Button>
                  ) : (
                    <p className="flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="size-3.5" />Needs coordinator</p>
                  )}
                  <Button variant="secondary" icon={X} onClick={() => setModal({ type: 'reject', b })}>Reject</Button>
                  {b.can_escalate && b.required_approval !== 'coordinator' && (
                    <Button variant="ghost" icon={ArrowUpCircle} loading={busy === b.id} onClick={() => escalate(b)}>Escalate</Button>
                  )}
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
      <ApproveModal booking={modal?.b} open={modal?.type === 'approve'} onClose={() => setModal(null)} onDone={done} />
      <RejectModal booking={modal?.b} open={modal?.type === 'reject'} onClose={() => setModal(null)} onDone={done} />
    </div>
  );
}
