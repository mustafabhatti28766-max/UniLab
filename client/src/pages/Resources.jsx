import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Users, MapPin, Plus, Search, CalendarPlus, Filter, X, Package, FlaskConical } from 'lucide-react';
import clsx from 'clsx';
import { api, qs } from '../lib/api';
import { useAsync, useDebounced, useTitle } from '../lib/hooks';
import { useAuth } from '../context/AuthContext';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Meter, PageHeader, Select, Skeleton, Tabs } from '../components/ui';
import { LiveBadge, MaintBadge } from '../components/booking-ui';
import { LabFormModal, EquipmentFormModal } from '../components/ResourceForms';
import { TIME_OPTIONS, fmtTime, todayStr, CONDITION_LABELS } from '../lib/format';

function LabCard({ lab }) {
  const windowOk = lab.window ? lab.window.available : null;
  return (
    <Card className="flex flex-col overflow-hidden transition-colors duration-150 hover:border-brand-400">
      <Link to={`/labs/${lab.id}`} className="flex-1 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500">
              {lab.code} · {lab.department_code}
            </p>
            <h3 className="mt-0.5 truncate font-semibold text-slate-900">{lab.name}</h3>
          </div>
          <LiveBadge status={lab.live_status} />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" /> {lab.capacity} seats
          </span>
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5" /> {lab.location}
          </span>
          <span className="inline-flex items-center gap-1">
            <Package className="size-3.5" /> {lab.equipment_count} equipment type{lab.equipment_count === 1 ? '' : 's'}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {lab.facilities.slice(0, 4).map((f) => (
            <span key={f} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
              {f}
            </span>
          ))}
          {lab.facilities.length > 4 && <span className="px-1 text-xs text-slate-400">+{lab.facilities.length - 4}</span>}
        </div>
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
          <span className="shrink-0 whitespace-nowrap">Utilization (30d)</span>
          <Meter value={lab.utilization} label="30-day utilization" />
          <span className="w-9 text-right font-medium text-slate-700 tabular">{lab.utilization}%</span>
        </div>
      </Link>
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-2.5">
        <div className="flex flex-wrap gap-1.5">
          {lab.approval_level === 'coordinator' && <Badge tone="amber">Coordinator approval</Badge>}
          {lab.approval_level === 'none' && <Badge tone="emerald">Instant booking</Badge>}
          {lab.restricted_to_department && <Badge tone="slate">{lab.department_code} only</Badge>}
          {windowOk === true && <Badge tone="emerald">Free for your slot</Badge>}
          {windowOk === false && <Badge tone="red">Busy for your slot</Badge>}
        </div>
        <Link to={`/book?lab=${lab.id}`}>
          <Button size="xs" variant="soft" icon={CalendarPlus}>
            Book
          </Button>
        </Link>
      </div>
    </Card>
  );
}

function StockCell({ e }) {
  return (
    <div className="flex items-center gap-3 text-xs tabular">
      <span title="Total">
        <span className="text-slate-400">Total </span>
        <span className="font-medium">{e.total_quantity}</span>
      </span>
      <span title="Reserved for the rest of today">
        <span className="text-slate-400">Rsv </span>
        <span className="font-medium text-indigo-700">{e.reserved}</span>
      </span>
      <span title="Currently issued">
        <span className="text-slate-400">Out </span>
        <span className="font-medium text-violet-700">{e.in_use}</span>
      </span>
      {e.maintenance > 0 && (
        <span title="In maintenance">
          <span className="text-slate-400">Fix </span>
          <span className="font-medium text-amber-700">{e.maintenance}</span>
        </span>
      )}
    </div>
  );
}

export default function Resources() {
  useTitle('Labs & equipment');
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'labs');
  const [q, setQ] = useState(params.get('q') || '');
  const [dept, setDept] = useState(params.get('department_id') || '');
  const [category, setCategory] = useState(params.get('category_id') || '');
  const [status, setStatus] = useState('');
  const [date, setDate] = useState('');
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('12:00');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [labModal, setLabModal] = useState(false);
  const [eqModal, setEqModal] = useState(false);
  const dq = useDebounced(q);

  // Pick up searches coming from the top bar (external URL changes only).
  const urlQ = params.get('q') || '';
  useEffect(() => {
    if (urlQ !== dq) setQ(urlQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlQ]);
  useEffect(() => {
    const next = new URLSearchParams();
    if (tab !== 'labs') next.set('tab', tab);
    if (dq) next.set('q', dq);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, dq]);

  const catalog = useAsync(() => Promise.all([api.get('/departments'), api.get('/categories')]), []);
  const [departments, categories] = catalog.data || [[], []];
  const windowParams = date ? { date, start_time: start, end_time: end, available_only: availableOnly ? '1' : '' } : { available_only: availableOnly && tab === 'equipment' ? '1' : '' };

  const labs = useAsync(() => api.get(`/labs${qs({ q: dq, department_id: dept, status, ...windowParams })}`), [dq, dept, status, date, start, end, availableOnly], { enabled: tab === 'labs' });
  const equipment = useAsync(
    () => api.get(`/equipment${qs({ q: dq, department_id: dept, category_id: category, ...windowParams })}`),
    [dq, dept, category, date, start, end, availableOnly],
    { enabled: tab === 'equipment' },
  );

  const activeFilters = [dept, category, status, date, availableOnly].filter(Boolean).length;
  const grouped = useMemo(() => {
    const out = new Map();
    for (const e of equipment.data || []) {
      if (!out.has(e.category)) out.set(e.category, []);
      out.get(e.category).push(e);
    }
    return [...out];
  }, [equipment.data]);

  return (
    <div>
      <PageHeader
        title="Labs & equipment"
        subtitle="Browse shared resources, check live status and availability for a time slot."
        actions={
          <>
            {can('labs.manage') && tab === 'labs' && (
              <Button variant="secondary" icon={Plus} onClick={() => setLabModal(true)}>
                Add lab
              </Button>
            )}
            {can('equipment.manage') && tab === 'equipment' && (
              <Button variant="secondary" icon={Plus} onClick={() => setEqModal(true)}>
                Add equipment
              </Button>
            )}
            <Link to="/book">
              <Button variant="cta" icon={CalendarPlus}>New booking</Button>
            </Link>
          </>
        }
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'labs', label: 'Laboratories', count: labs.data?.length },
          { value: 'equipment', label: 'Equipment', count: equipment.data?.length },
        ]}
      />

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'labs' ? 'Search by name, code, location or facility…' : 'Search equipment by name, code or category…'} className="pl-9" aria-label="Search" />
        </div>
        <Button variant="secondary" icon={Filter} onClick={() => setShowFilters((s) => !s)} className="shrink-0">
          Filters{activeFilters ? ` (${activeFilters})` : ''}
        </Button>
      </div>

      {showFilters && (
        <Card className="mt-3 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <label className="label" htmlFor="f-dept">Department</label>
            <Select id="f-dept" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </div>
          {tab === 'equipment' ? (
            <div className="lg:col-span-2">
              <label className="label" htmlFor="f-cat">Category</label>
              <Select id="f-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">All categories</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
          ) : (
            <div className="lg:col-span-2">
              <label className="label" htmlFor="f-status">Live status</label>
              <Select id="f-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Any status</option>
                {['available', 'reserved', 'in_use', 'maintenance', 'closed'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </Select>
            </div>
          )}
          <div className="lg:col-span-2">
            <label className="label" htmlFor="f-date">Check availability on</label>
            <Input id="f-date" type="date" min={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {date && (
            <>
              <div className="lg:col-span-2">
                <label className="label" htmlFor="f-start">From</label>
                <Select id="f-start" value={start} onChange={(e) => setStart(e.target.value)}>
                  {TIME_OPTIONS.map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}
                </Select>
              </div>
              <div className="lg:col-span-2">
                <label className="label" htmlFor="f-end">To</label>
                <Select id="f-end" value={end} onChange={(e) => setEnd(e.target.value)}>
                  {TIME_OPTIONS.filter((t) => t > start).map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}
                </Select>
              </div>
            </>
          )}
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700 lg:col-span-2">
            <input type="checkbox" checked={availableOnly} onChange={(e) => setAvailableOnly(e.target.checked)} className="size-4 rounded border-slate-300 text-brand-600" />
            Only show available
          </label>
          {activeFilters > 0 && (
            <div className="flex items-end lg:col-span-6">
              <Button size="sm" variant="ghost" icon={X} onClick={() => { setDept(''); setCategory(''); setStatus(''); setDate(''); setAvailableOnly(false); }}>
                Clear filters
              </Button>
            </div>
          )}
        </Card>
      )}

      <div className="mt-5">
        {tab === 'labs' &&
          (labs.error ? (
            <ErrorState error={labs.error} onRetry={labs.reload} />
          ) : labs.loading && !labs.data ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-60" />)}</div>
          ) : labs.data.length === 0 ? (
            <EmptyState icon={FlaskConical} title="No labs match your search" description="Try a different keyword or clear the filters." />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{labs.data.map((l) => <LabCard key={l.id} lab={l} />)}</div>
          ))}

        {tab === 'equipment' &&
          (equipment.error ? (
            <ErrorState error={equipment.error} onRetry={equipment.reload} />
          ) : equipment.loading && !equipment.data ? (
            <Skeleton className="h-96" />
          ) : equipment.data.length === 0 ? (
            <EmptyState icon={Package} title="No equipment matches your search" />
          ) : (
            <div className="space-y-6">
              {grouped.map(([cat, items]) => (
                <section key={cat}>
                  <h2 className="mb-2 text-sm font-semibold text-slate-700">{cat}</h2>
                  <Card className="divide-y divide-slate-100">
                    {items.map((e) => {
                      const avail = date ? e.window_available : e.available_quantity;
                      return (
                        <div key={e.id} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
                          <Link to={`/equipment/${e.id}`} className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-900 hover:text-brand-700">{e.name}</p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              <span className="font-mono">{e.code}</span> · {e.lab_name} · Condition: {CONDITION_LABELS[e.condition]}
                            </p>
                          </Link>
                          <div className="flex flex-wrap items-center gap-3">
                            <StockCell e={e} />
                            {e.maintenance_status !== 'operational' && <MaintBadge status={e.maintenance_status} />}
                            <span className={clsx('w-28 text-right text-sm font-semibold tabular', avail > 0 ? 'text-emerald-700' : 'text-red-600')}>
                              {avail} available
                              <span className="block text-[11px] font-normal text-slate-400">{date ? 'for your slot' : 'rest of today'}</span>
                            </span>
                            <Link to={`/book?equipment=${e.id}`}>
                              <Button size="xs" variant="soft" icon={CalendarPlus}>
                                Book
                              </Button>
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                  </Card>
                </section>
              ))}
            </div>
          ))}
      </div>

      <LabFormModal open={labModal} onClose={() => setLabModal(false)} onSaved={() => labs.reload()} />
      <EquipmentFormModal open={eqModal} onClose={() => setEqModal(false)} onSaved={() => equipment.reload()} />
    </div>
  );
}
