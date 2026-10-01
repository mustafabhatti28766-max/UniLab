import { useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { BarChart3, TrendingUp, TrendingDown, Minus, Table2, Wrench } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAsync, useTitle } from '../lib/hooks';
import { useAuth } from '../context/AuthContext';
import { Badge, Card, CardHeader, ErrorState, PageHeader, Select, Skeleton, Meter } from '../components/ui';
import { BarList, ChartTooltip, Heatmap, HourHeatmap, KpiTile, VIZ } from '../components/charts';
import { REJECTION_LABELS, STATUS_META, fmtTime } from '../lib/format';

const monthLabel = (m) => new Date(`${m}-15T12:00`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

function Trend({ pct }) {
  if (Math.abs(pct) < 2) return <span className="inline-flex items-center gap-0.5 text-xs text-slate-500"><Minus className="size-3" />flat</span>;
  const up = pct > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? 'text-[#006300]' : 'text-slate-600'}`}>
      {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      {up ? '+' : ''}
      {pct}%/wk
    </span>
  );
}

function ColumnChart({ data, dataKey, xKey, xFormat, name, height = 220 }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke={VIZ.grid} />
          <XAxis dataKey={xKey} tickFormatter={xFormat} tick={{ fontSize: 11, fill: VIZ.muted }} axisLine={{ stroke: VIZ.axis }} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: VIZ.muted }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: 'rgba(42,120,214,0.08)' }} content={<ChartTooltip labelFormatter={xFormat} />} />
          <Bar dataKey={dataKey} name={name} fill={VIZ.series[0]} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Analytics() {
  useTitle('Analytics');
  const { user } = useAuth();
  const [days, setDays] = useState(90);
  const [dept, setDept] = useState('');
  const [showTable, setShowTable] = useState(false);
  const [heatMode, setHeatMode] = useState('weekday');
  const [labFilter, setLabFilter] = useState('');
  const departments = useAsync(() => api.get('/departments'), []);
  const { data, error, reload } = useAsync(() => api.get(`/analytics/overview${qs({ days, department_id: dept, lab_id: labFilter })}`), [days, dept, labFilter]);
  const pred = useAsync(() => api.get(`/analytics/predictions${qs({ department_id: dept })}`), [dept]);

  return (
    <div>
      <PageHeader
        title="Dashboard & analytics"
        subtitle={user.role === 'admin' ? 'System-wide usage, demand and reliability.' : `Usage and demand for ${user.department_name}.`}
        actions={
          <div className="flex flex-wrap gap-2">
            {user.role === 'admin' && (
              <Select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department" className="w-auto">
                <option value="">All departments</option>
                {(departments.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            )}
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period" className="w-auto">
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={180}>Last 180 days</option>
            </Select>
          </div>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">{Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiTile label="Total bookings" value={data.kpis.total.toLocaleString()} sub={`last ${days} days`} />
            <KpiTile label="Approved" value={data.kpis.approved.toLocaleString()} sub={`${data.kpis.approval_rate}% approval rate`} />
            <KpiTile label="Pending requests" value={data.kpis.pending} sub="right now" />
            <KpiTile label="Cancelled" value={data.kpis.cancelled} sub={`${data.kpis.rejected} rejected`} />
            <KpiTile label="Equipment issued" value={data.kpis.issued_now} sub="units out right now" />
            <KpiTile label="Overdue" value={data.kpis.overdue} sub={`${data.kpis.returned_late} returned late`} tone={data.kpis.overdue ? 'bad' : undefined} />
            <KpiTile label="Avg. lab utilization" value={`${data.kpis.avg_utilization}%`} sub="booked ÷ open hours" />
            <KpiTile label="Completed" value={data.kpis.completed.toLocaleString()} />
            <KpiTile label="Damage reports" value={data.kpis.damage_reports} sub={`${data.kpis.damage_open} still open`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Bookings by month" subtitle="All submitted requests, last 6 months" icon={BarChart3} />
              <div className="p-4"><ColumnChart data={data.months} dataKey="bookings" xKey="month" xFormat={monthLabel} name="bookings" /></div>
            </Card>
            <Card>
              <CardHeader title="Booked hours by month" subtitle="Resource usage (approved & completed)" icon={BarChart3} />
              <div className="p-4"><ColumnChart data={data.months} dataKey="hours" xKey="month" xFormat={monthLabel} name="hours" /></div>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader
                title="Usage heatmap"
                subtitle={heatMode === 'weekday' ? `Occupied booking-hours by weekday and hour${labFilter ? ' — selected lab' : ''}` : heatMode === 'lab' ? 'Occupied booking-hours by lab and hour' : "Booking-hours by requester's department and hour"}
                action={
                  <div className="flex flex-wrap gap-2">
                    {heatMode === 'weekday' && (
                      <Select value={labFilter} onChange={(e) => setLabFilter(e.target.value)} className="w-auto py-1 text-xs" aria-label="Lab">
                        <option value="">All labs</option>
                        {data.labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </Select>
                    )}
                    <Select value={heatMode} onChange={(e) => setHeatMode(e.target.value)} className="w-auto py-1 text-xs" aria-label="Heatmap view">
                      <option value="weekday">By weekday</option>
                      <option value="lab">By lab</option>
                      <option value="department">By department</option>
                    </Select>
                  </div>
                }
              />
              <div className="p-5">
                {heatMode === 'weekday' && <Heatmap rows={data.heatmap} />}
                {heatMode === 'lab' && <HourHeatmap rows={data.heatmap_by_lab} ariaLabel="Usage heatmap by lab" />}
                {heatMode === 'department' && <HourHeatmap rows={data.heatmap_by_department} ariaLabel="Usage heatmap by department" />}
              </div>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader title="Peak booking hours" subtitle="Bookings by start time" />
              <div className="p-4"><ColumnChart data={data.peak_hours} dataKey="count" xKey="hour" xFormat={(h) => fmtTime(`${String(h).padStart(2, '0')}:00`).replace(':00', '')} name="bookings start" height={250} /></div>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader title="Most-booked labs" subtitle="Utilization of open hours" />
              <div className="p-5"><BarList data={data.top_labs} valueKey="utilization" labelKey="name" max={100} format={(v, d) => `${v}% · ${d.bookings}`} /></div>
            </Card>
            <Card>
              <CardHeader title="Most-used equipment" subtitle="Units booked" />
              <div className="p-5"><BarList data={data.top_equipment} valueKey="units" labelKey="name" format={(v, d) => `${v} units · ${d.bookings}`} /></div>
            </Card>
            <Card>
              <CardHeader title="Usage by department" subtitle="Bookings by the requester's department" />
              <div className="p-5"><BarList data={data.by_department} valueKey="bookings" labelKey="name" format={(v, d) => `${v} · ${d.hours}h`} /></div>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader title="Underused labs" subtitle="Below 60% of the average utilization" />
              <div className="p-5">
                <BarList data={data.underused_labs} valueKey="utilization" labelKey="name" max={Math.max(25, ...data.labs.map((l) => l.utilization))} format={(v) => `${v}%`} empty="No underused labs" />
              </div>
            </Card>
            <Card>
              <CardHeader title="Frequently unavailable equipment" subtitle="Failed requests + waitlist joins" />
              <div className="p-5">
                <BarList data={data.frequently_unavailable.map((e) => ({ ...e, total: e.misses + e.waitlisted }))} valueKey="total" labelKey="name" format={(v, d) => `${v} (${d.total_quantity} units)`} empty="Demand is being met" />
              </div>
            </Card>
            <Card>
              <CardHeader title="Booking rejection reasons" />
              <div className="p-5">
                <BarList data={data.rejection_reasons.map((r) => ({ ...r, label: REJECTION_LABELS[r.category] || r.category }))} valueKey="count" labelKey="label" empty="No rejections" />
              </div>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Usage prediction — next 7 days" subtitle={pred.data?.method} icon={TrendingUp} />
              {pred.data ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500">
                      <tr>
                        <th className="px-5 py-2 font-medium">Lab</th>
                        <th className="px-3 py-2 font-medium">Already booked</th>
                        <th className="px-3 py-2 font-medium">Forecast</th>
                        <th className="px-3 py-2 font-medium">Predicted utilization</th>
                        <th className="px-3 py-2 font-medium">Trend</th>
                        <th className="px-3 py-2 font-medium">Peak day</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pred.data.labs.map((l) => (
                        <tr key={l.id}>
                          <td className="px-5 py-2.5 font-medium">{l.name}</td>
                          <td className="px-3 py-2.5 tabular">{l.already_booked_hours}h</td>
                          <td className="px-3 py-2.5 tabular">{l.forecast_hours}h</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <Meter value={l.predicted_utilization} className="w-24" label="Predicted utilization" />
                              <span className="w-9 tabular">{l.predicted_utilization}%</span>
                              <Badge tone={l.demand === 'high' ? 'red' : l.demand === 'medium' ? 'amber' : 'slate'}>{l.demand}</Badge>
                            </div>
                          </td>
                          <td className="px-3 py-2.5"><Trend pct={l.trend_pct} /></td>
                          <td className="px-3 py-2.5 text-slate-600">{l.peak_day || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Skeleton className="m-5 h-40" />
              )}
            </Card>
            <Card>
              <CardHeader title="Equipment demand forecast" subtitle="Predicted share of bookable unit-hours" icon={Wrench} />
              <div className="p-5">
                {pred.data && <BarList data={pred.data.equipment} valueKey="predicted_utilization" labelKey="name" max={Math.max(30, ...pred.data.equipment.map((e) => e.predicted_utilization))} format={(v, d) => `${v}% · ${d.demand}`} />}
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Lab utilization table"
              icon={Table2}
              action={<button onClick={() => setShowTable((s) => !s)} className="text-sm font-medium text-brand-700 hover:underline">{showTable ? 'Hide' : 'Show'} table</button>}
            />
            {showTable && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-5 py-2 font-medium">Lab</th>
                      <th className="px-3 py-2 font-medium">Dept</th>
                      <th className="px-3 py-2 font-medium">Bookings</th>
                      <th className="px-3 py-2 font-medium">Hours</th>
                      <th className="px-3 py-2 font-medium">Utilization</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular">
                    {data.labs.map((l) => (
                      <tr key={l.id}>
                        <td className="px-5 py-2">{l.name}</td>
                        <td className="px-3 py-2">{l.department_code}</td>
                        <td className="px-3 py-2">{l.bookings}</td>
                        <td className="px-3 py-2">{l.hours}</td>
                        <td className="px-3 py-2">{l.utilization}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex flex-wrap gap-2 border-t border-slate-100 px-5 py-3">
                  {data.status_breakdown.map((s) => <Badge key={s.status} tone={STATUS_META[s.status]?.tone}>{STATUS_META[s.status]?.label}: {s.count}</Badge>)}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
