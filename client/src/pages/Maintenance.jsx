import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Wrench, Plus, AlertTriangle, CalendarClock, Sparkles, CheckCircle2 } from 'lucide-react';
import { api, qs, fileUrl } from '../lib/api';
import { useAsync, useTitle } from '../lib/hooks';
import { useToast } from '../context/ToastContext';
import { Badge, Button, Card, EmptyState, ErrorState, Meter, PageHeader, Select, Skeleton, Tabs } from '../components/ui';
import { MaintBadge } from '../components/booking-ui';
import { BlockModal } from '../components/BlockModal';
import { fmtDateTime, timeAgo } from '../lib/format';

function Recommendations() {
  const { data, error, loading, reload } = useAsync(() => api.get('/maintenance/recommendations'), []);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !data) return <Skeleton className="h-64" />;
  if (!data.length) return <Card><EmptyState icon={CheckCircle2} title="All equipment looks healthy" /></Card>;
  return (
    <Card>
      <div className="border-b border-slate-100 px-5 py-3 text-xs text-slate-500">
        Risk combines fault/damage reports per checkout (120 days), condition, time since last service and unresolved reports.
      </div>
      <ul className="divide-y divide-slate-100">
        {data.map((m) => (
          <li key={m.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/equipment/${m.id}`} className="font-medium hover:text-brand-700">{m.name}</Link>
                <MaintBadge status={m.maintenance_status} />
                {m.maintenance_quantity > 0 && <Badge tone="amber">{m.maintenance_quantity} unit(s) in repair</Badge>}
              </div>
              <p className="text-xs text-slate-500">{m.category} · {m.lab_name}</p>
              <p className="mt-1 text-sm text-slate-600">{m.reasons.join(' · ')}</p>
            </div>
            <div className="w-full md:w-56">
              <div className="mb-1 flex justify-between text-xs">
                <span className="font-medium text-slate-800">{m.action}</span>
                <span className="tabular">{m.risk}</span>
              </div>
              <Meter value={m.risk} tone={m.level === 'critical' ? 'red' : m.level === 'high' ? 'amber' : 'blue'} label="Risk score" />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DamageReports() {
  const toast = useToast();
  const [status, setStatus] = useState('open');
  const { data, error, loading, reload } = useAsync(() => api.get(`/damage-reports${qs({ status })}`), [status]);
  const update = async (r, s) => {
    try {
      await api.patch(`/damage-reports/${r.id}`, { status: s });
      toast.success(s === 'resolved' ? 'Resolved — units returned to service' : s === 'written_off' ? 'Units written off inventory' : 'Report updated');
      reload(true);
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <div>
      <div className="mb-3 flex gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Status filter">
          <option value="open">Open</option>
          <option value="in_repair">In repair</option>
          <option value="resolved">Resolved</option>
          <option value="written_off">Written off</option>
          <option value="">All</option>
        </Select>
      </div>
      <Card>
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <Skeleton className="m-4 h-40" />
        ) : data.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="No reports with this status" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((r) => (
              <li key={r.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row">
                {r.image_path && (
                  <a href={fileUrl(r.image_path)} target="_blank" rel="noreferrer" className="shrink-0">
                    <img src={fileUrl(r.image_path)} alt="Damage" className="size-20 rounded-lg border border-slate-200 object-cover" />
                  </a>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/equipment/${r.equipment_id}`} className="font-medium hover:text-brand-700">{r.equipment_name}</Link>
                    <Badge tone={r.kind === 'missing' ? 'red' : r.kind === 'damaged' ? 'orange' : 'amber'}>{r.kind} · {r.quantity}</Badge>
                    <Badge tone={r.severity === 'high' ? 'red' : r.severity === 'medium' ? 'amber' : 'slate'}>{r.severity}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{r.description}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {r.lab_name} · reported by {r.reported_by_name || 'staff'} {timeAgo(r.created_at)}
                    {r.responsible_name && ` · borrower ${r.responsible_name}`}
                    {r.ref_code && <> · <Link to={`/bookings/${r.booking_id}`} className="underline">{r.ref_code}</Link></>}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-start gap-2">
                  {r.status === 'open' && <Button size="xs" variant="secondary" onClick={() => update(r, 'in_repair')}>Start repair</Button>}
                  {['open', 'in_repair'].includes(r.status) && <Button size="xs" variant="success" onClick={() => update(r, 'resolved')}>{r.kind === 'missing' ? 'Found' : 'Resolved'}</Button>}
                  {['open', 'in_repair'].includes(r.status) && r.kind !== 'fault' && <Button size="xs" variant="ghost" onClick={() => update(r, 'written_off')}>Write off</Button>}
                  {['resolved', 'written_off'].includes(r.status) && <Badge tone="emerald">{r.status.replace('_', ' ')} {r.resolved_at && `· ${timeAgo(r.resolved_at)}`}</Badge>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Schedule() {
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const { data, error, loading, reload } = useAsync(() => api.get('/blocks?upcoming=1'), []);
  const setStatus = async (k, status) => {
    try {
      await api.patch(`/blocks/${k.id}`, { status });
      toast.success(status === 'completed' ? 'Marked complete' : 'Cancelled');
      reload(true);
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button icon={Plus} onClick={() => setModal(true)}>Schedule maintenance / block</Button>
      </div>
      <Card>
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <Skeleton className="m-4 h-40" />
        ) : data.length === 0 ? (
          <EmptyState icon={CalendarClock} title="Nothing scheduled" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((k) => (
              <li key={k.id} className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{k.title}</span>
                    <Badge tone={k.kind === 'maintenance' ? 'amber' : 'slate'}>{k.kind}</Badge>
                    <Badge tone={k.status === 'in_progress' ? 'violet' : 'blue'}>{k.status.replace('_', ' ')}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">
                    <Link to={`/${k.resource_type === 'lab' ? 'labs' : 'equipment'}/${k.resource_id}`} className="underline">{k.resource_name}</Link>
                    {k.quantity ? ` (${k.quantity} units)` : ''} · {fmtDateTime(k.start_at)} → {fmtDateTime(k.end_at)} · by {k.created_by_name}
                  </p>
                  {k.reason && <p className="text-xs text-slate-500">{k.reason}</p>}
                </div>
                <div className="flex gap-2">
                  <Button size="xs" variant="success" onClick={() => setStatus(k, 'completed')}>Complete</Button>
                  <Button size="xs" variant="ghost" onClick={() => setStatus(k, 'cancelled')}>Cancel</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <BlockModal open={modal} onClose={() => setModal(false)} onSaved={() => reload(true)} />
    </div>
  );
}

export default function Maintenance() {
  useTitle('Maintenance');
  const [tab, setTab] = useState('recommendations');
  return (
    <div>
      <PageHeader title="Maintenance" subtitle="Predictive maintenance recommendations, damage & fault reports, and scheduled maintenance windows." />
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4"
        tabs={[
          { value: 'recommendations', label: <span className="inline-flex items-center gap-1.5"><Sparkles className="size-4" />Recommendations</span> },
          { value: 'reports', label: <span className="inline-flex items-center gap-1.5"><AlertTriangle className="size-4" />Damage reports</span> },
          { value: 'schedule', label: <span className="inline-flex items-center gap-1.5"><Wrench className="size-4" />Scheduled & blocks</span> },
        ]}
      />
      {tab === 'recommendations' && <Recommendations />}
      {tab === 'reports' && <DamageReports />}
      {tab === 'schedule' && <Schedule />}
    </div>
  );
}
