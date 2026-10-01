import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Search, Filter, X, Download, Activity, Table2, RefreshCw } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAsync, useDebounced, useInterval, useTitle } from '../lib/hooks';
import { useAuth } from '../context/AuthContext';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Input, PageHeader, Select, Skeleton, DOT_TONES } from '../components/ui';
import { StatusBadge } from '../components/booking-ui';
import { ROLE_LABELS, STATUS_META, TIME_OPTIONS, describeBooking, fmtDate, fmtTime, timeAgo } from '../lib/format';

const PAGE = 25;
const EVENT_LABELS = {
  submitted: 'submitted', auto_approved: 'auto-approved', approved: 'approved', rejected: 'rejected', escalated: 'escalated', reserved: 'reserved',
  cancelled: 'cancelled', no_show: 'no-show', checked_in: 'checked in', returned: 'returned', completed: 'completed', auto_completed: 'completed',
  overdue: 'became overdue', expired: 'expired', draft_saved: 'saved draft',
};

function toCsv(rows) {
  const head = ['booking_id', 'ref_code', 'user', 'role', 'resource_type', 'resource_id', 'lab', 'equipment', 'booking_date', 'start_time', 'end_time', 'purpose', 'approval_status', 'booking_status', 'approved_by'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((b) =>
    [b.booking_id, b.ref_code, b.user_name, b.user_role, b.resource_type, b.resource_id, b.lab_name, b.items.map((i) => `${i.quantity}x ${i.name}`).join('; '), b.booking_date, b.start_time, b.end_time, b.purpose, b.approval_status, b.booking_status, b.approved_by_name]
      .map(esc)
      .join(','),
  );
  return [head.join(','), ...lines].join('\n');
}

export default function AllBookings() {
  useTitle('All bookings');
  const { user } = useAuth();
  const [q, setQ] = useState('');
  const [statuses, setStatuses] = useState([]);
  const [f, setF] = useState({ department_id: '', lab_id: '', equipment_id: '', category_id: '', resource_type: '', from: '', to: '', start_time: '', end_time: '' });
  const [showFilters, setShowFilters] = useState(true);
  const [page, setPage] = useState(0);
  const dq = useDebounced(q);
  const set = (k) => (e) => {
    setF((x) => ({ ...x, [k]: e.target.value }));
    setPage(0);
  };

  const catalog = useAsync(() => Promise.all([api.get('/departments'), api.get('/labs'), api.get('/equipment'), api.get('/categories')]), []);
  const [departments, labs, equipment, categories] = catalog.data || [[], [], [], []];
  const params = useMemo(() => ({ scope: 'all', q: dq, status: statuses.join(','), ...f }), [dq, statuses, f]);
  const { data, error, loading, reload } = useAsync(() => api.get(`/bookings${qs({ ...params, limit: PAGE, offset: page * PAGE })}`), [params, page]);
  const totalsNoStatus = useAsync(() => api.get(`/bookings${qs({ ...params, status: '', limit: 1 })}`), [dq, f]);
  const feed = useAsync(() => api.get('/bookings/activity?limit=25'), []);
  useInterval(() => {
    feed.reload(true);
    reload(true);
  }, 30000);

  const counts = totalsNoStatus.data?.counts || {};
  const toggleStatus = (s) => {
    setStatuses((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]));
    setPage(0);
  };
  const active = Object.values(f).filter(Boolean).length + statuses.length + (dq ? 1 : 0);
  const clear = () => {
    setQ('');
    setStatuses([]);
    setF({ department_id: '', lab_id: '', equipment_id: '', category_id: '', resource_type: '', from: '', to: '', start_time: '', end_time: '' });
    setPage(0);
  };
  const exportCsv = async () => {
    const r = await api.get(`/bookings${qs({ ...params, limit: 200 })}`);
    const blob = new Blob([toCsv(r.data)], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'unilab-bookings.csv' });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <PageHeader
        title="All bookings"
        subtitle={user.role === 'admin' ? 'Monitor booking activity across the university.' : `Monitor booking activity in ${user.department_name}.`}
        actions={
          <>
            <Button variant="secondary" icon={RefreshCw} onClick={() => { reload(); feed.reload(); }}>Refresh</Button>
            <Button variant="secondary" icon={Download} onClick={exportCsv}>Export CSV</Button>
          </>
        }
      />

      {/* Booking status filter with live counts */}
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter by booking status">
        {Object.entries(STATUS_META).map(([s, m]) => {
          const on = statuses.includes(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => toggleStatus(s)}
              className={clsx('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300')}
            >
              <span className={clsx('size-1.5 rounded-full', on ? 'bg-white' : DOT_TONES[m.tone])} aria-hidden />
              {m.label}
              <span className={clsx('tabular', on ? 'text-white/80' : 'text-slate-400')}>{counts[s] || 0}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search reference, requester, university ID, lab or purpose" className="pl-9" aria-label="Search bookings" />
        </div>
        <Button variant="secondary" icon={Filter} onClick={() => setShowFilters((s) => !s)}>Filters{active ? ` (${active})` : ''}</Button>
        {active > 0 && <Button variant="ghost" icon={X} onClick={clear}>Clear</Button>}
      </div>

      {showFilters && (
        <Card className="mt-3 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          {user.role === 'admin' && (
            <div>
              <label className="label" htmlFor="ab-dept">Department</label>
              <Select id="ab-dept" value={f.department_id} onChange={set('department_id')}>
                <option value="">All departments</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </div>
          )}
          <div>
            <label className="label" htmlFor="ab-lab">Lab</label>
            <Select id="ab-lab" value={f.lab_id} onChange={set('lab_id')}>
              <option value="">Any lab</option>
              {labs.filter((l) => user.role === 'admin' || l.department_id === user.department_id).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </div>
          <div>
            <label className="label" htmlFor="ab-cat">Equipment category</label>
            <Select id="ab-cat" value={f.category_id} onChange={set('category_id')}>
              <option value="">Any category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div>
            <label className="label" htmlFor="ab-eq">Equipment</label>
            <Select id="ab-eq" value={f.equipment_id} onChange={set('equipment_id')}>
              <option value="">Any equipment</option>
              {equipment.filter((e) => !f.category_id || String(e.category_id) === String(f.category_id)).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </div>
          <div>
            <label className="label" htmlFor="ab-type">Resource type</label>
            <Select id="ab-type" value={f.resource_type} onChange={set('resource_type')}>
              <option value="">Any</option>
              <option value="lab">Lab only</option>
              <option value="equipment">Equipment only</option>
              <option value="lab_equipment">Lab + equipment</option>
            </Select>
          </div>
          <div>
            <label className="label" htmlFor="ab-from">Date from</label>
            <Input id="ab-from" type="date" value={f.from} onChange={set('from')} />
          </div>
          <div>
            <label className="label" htmlFor="ab-to">Date to</label>
            <Input id="ab-to" type="date" value={f.to} onChange={set('to')} />
          </div>
          <div>
            <label className="label" htmlFor="ab-st">Time from</label>
            <Select id="ab-st" value={f.start_time} onChange={set('start_time')}>
              <option value="">Any time</option>
              {TIME_OPTIONS.map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}
            </Select>
          </div>
          <div>
            <label className="label" htmlFor="ab-et">Time to</label>
            <Select id="ab-et" value={f.end_time} onChange={set('end_time')}>
              <option value="">Any time</option>
              {TIME_OPTIONS.map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}
            </Select>
          </div>
        </Card>
      )}

      <div className="mt-4 grid gap-6 2xl:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="overflow-x-auto">
          <CardHeader title={data ? `${data.total.toLocaleString()} booking${data.total === 1 ? '' : 's'}` : 'Bookings'} icon={Table2} />
          {error ? (
            <ErrorState error={error} onRetry={reload} />
          ) : loading && !data ? (
            <Skeleton className="m-4 h-64" />
          ) : data.data.length === 0 ? (
            <EmptyState title="No bookings match these filters" />
          ) : (
            <>
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Booking</th>
                    <th className="px-3 py-2 font-medium">Requester</th>
                    <th className="px-3 py-2 font-medium">Resource</th>
                    <th className="px-3 py-2 font-medium">Date & time</th>
                    <th className="px-3 py-2 font-medium">Approval</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.data.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <Link to={`/bookings/${b.id}`} className="font-mono text-xs font-semibold text-brand-700 hover:underline">{b.ref_code}</Link>
                        <p className="text-[11px] text-slate-400">#{b.booking_id} · {timeAgo(b.created_at)}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="font-medium">{b.user_name}</p>
                        <p className="text-xs text-slate-500">{ROLE_LABELS[b.user_role]}{b.user_department_code ? ` · ${b.user_department_code}` : ''}</p>
                      </td>
                      <td className="max-w-[260px] px-3 py-2.5">
                        <p className="truncate">{describeBooking(b)}</p>
                        <p className="text-xs text-slate-500">{b.resource_type.replace('_', ' + ')}</p>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <p>{fmtDate(b.booking_date)}</p>
                        <p className="text-xs text-slate-500 tabular">{fmtTime(b.start_time)}–{fmtTime(b.end_time)}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={b.approval_status === 'rejected' ? 'rose' : b.approval_status === 'pending' ? 'amber' : b.approval_status === 'none' ? 'slate' : 'emerald'}>
                          {b.approval_status === 'auto' ? 'auto-approved' : b.approval_status}
                        </Badge>
                        {b.approved_by_name && <p className="mt-0.5 text-[11px] text-slate-400">by {b.approved_by_name}</p>}
                      </td>
                      <td className="px-3 py-2.5"><StatusBadge status={b.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.total > PAGE && (
                <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
                  <span>{page * PAGE + 1}–{Math.min(data.total, (page + 1) * PAGE)} of {data.total}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                    <Button size="sm" variant="secondary" disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage((p) => p + 1)}>Next</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>

        <Card className="2xl:sticky 2xl:top-20 2xl:self-start">
          <CardHeader title="Live booking activity" subtitle="Approval history across all bookings · refreshes every 30s" icon={Activity} />
          {!feed.data ? (
            <Skeleton className="m-4 h-40" />
          ) : (
            <ol className="grid max-h-[560px] divide-y divide-slate-100 overflow-y-auto sm:grid-cols-2 sm:divide-y-0 2xl:grid-cols-1 2xl:divide-y">

              {feed.data.map((e) => (
                <li key={e.id} className="px-4 py-2.5 text-xs">
                  <p className="text-slate-700">
                    <span className="font-medium">{e.actor_name || 'System'}</span> {EVENT_LABELS[e.action] || e.action.replace(/_/g, ' ')}{' '}
                    <Link to={`/bookings/${e.booking_id}`} className="font-mono text-brand-700 hover:underline">{e.ref_code}</Link>
                  </p>
                  <p className="text-slate-500">{e.lab_name || e.user_name} · {timeAgo(e.created_at)}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
