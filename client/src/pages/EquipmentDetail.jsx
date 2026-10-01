import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from 'recharts';
import { ArrowLeft, CalendarPlus, Pencil, Wrench, Ban, Printer, Package, AlertTriangle, Activity, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync, useTitle } from '../lib/hooks';
import { useToast } from '../context/ToastContext';
import { Alert, Badge, Button, Card, CardHeader, ErrorState, Field, Input, Modal, Select, Spinner } from '../components/ui';
import { BookingRow, MaintBadge } from '../components/booking-ui';
import { EquipmentFormModal } from '../components/ResourceForms';
import { BlockModal } from '../components/BlockModal';
import { CONDITION_LABELS, addDays, fmtDate, fmtDateTime, fmtTime, todayStr, timeAgo } from '../lib/format';
import { ChartTooltip, VIZ } from '../components/charts';

const SEGMENTS = [
  { key: 'available_quantity', label: 'Available', color: VIZ.series[0] },
  { key: 'reserved', label: 'Reserved today', color: VIZ.series[1] },
  { key: 'in_use', label: 'In use', color: VIZ.series[2] },
  { key: 'maintenance', label: 'Maintenance', color: VIZ.series[3] },
  { key: 'missing', label: 'Missing', color: VIZ.series[4] },
];

function StockBar({ eq }) {
  const total = Math.max(1, SEGMENTS.reduce((s, x) => s + (eq[x.key] || 0), 0));
  return (
    <div>
      <div className="flex h-4 w-full gap-0.5 overflow-hidden rounded-md bg-slate-100" role="img" aria-label="Stock breakdown">
        {SEGMENTS.filter((s) => eq[s.key] > 0).map((s) => (
          <div key={s.key} title={`${s.label}: ${eq[s.key]}`} style={{ width: `${(eq[s.key] / total) * 100}%`, background: s.color }} className="h-full first:rounded-l-md last:rounded-r-md" />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
        {SEGMENTS.map((s) => (
          <div key={s.key} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
            <dt className="text-xs text-slate-500">{s.label}</dt>
            <dd className="ml-auto text-sm font-semibold text-slate-900 tabular sm:ml-0">{eq[s.key] || 0}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function MaintenanceModal({ eq, open, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ maintenance_status: eq.maintenance_status, condition: eq.condition, to_maintenance: 0, repaired: 0, found: 0, wo_m: 0, wo_x: 0, note: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/equipment/${eq.id}/maintenance`, {
        maintenance_status: form.maintenance_status,
        condition: form.condition,
        to_maintenance: Number(form.to_maintenance),
        repaired: Number(form.repaired),
        found: Number(form.found),
        written_off: { maintenance: Number(form.wo_m), missing: Number(form.wo_x) },
        note: form.note,
      });
      toast.success('Maintenance status updated');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Update maintenance — ${eq.name}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Maintenance status">
          {(id) => (
            <Select id={id} value={form.maintenance_status} onChange={set('maintenance_status')}>
              <option value="operational">Operational</option>
              <option value="needs_inspection">Needs inspection</option>
              <option value="under_maintenance">Under maintenance (unbookable)</option>
              <option value="retired">Retired</option>
            </Select>
          )}
        </Field>
        <Field label="Condition">
          {(id) => (
            <Select id={id} value={form.condition} onChange={set('condition')}>
              {Object.entries(CONDITION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Move working units to maintenance">{(id) => <Input id={id} type="number" min={0} value={form.to_maintenance} onChange={set('to_maintenance')} />}</Field>
        <Field label={`Repaired → back in service (of ${eq.maintenance_quantity})`}>{(id) => <Input id={id} type="number" min={0} max={eq.maintenance_quantity} value={form.repaired} onChange={set('repaired')} />}</Field>
        <Field label={`Missing units found (of ${eq.missing_quantity})`}>{(id) => <Input id={id} type="number" min={0} max={eq.missing_quantity} value={form.found} onChange={set('found')} />}</Field>
        <div />
        <Field label="Write off units in maintenance">{(id) => <Input id={id} type="number" min={0} max={eq.maintenance_quantity} value={form.wo_m} onChange={set('wo_m')} />}</Field>
        <Field label="Write off missing units">{(id) => <Input id={id} type="number" min={0} max={eq.missing_quantity} value={form.wo_x} onChange={set('wo_x')} />}</Field>
        <Field label="Note" className="sm:col-span-2">{(id) => <Input id={id} value={form.note} onChange={set('note')} placeholder="e.g. Replaced probe cable" />}</Field>
      </div>
    </Modal>
  );
}

export default function EquipmentDetail() {
  const { id } = useParams();
  const { data: eq, error, loading, reload } = useAsync(() => api.get(`/equipment/${id}`), [id]);
  const [date, setDate] = useState(todayStr());
  const avail = useAsync(() => api.get(`/equipment/${id}/availability?date=${date}`), [id, date]);
  const [modal, setModal] = useState(null);
  useTitle(eq?.name || 'Equipment');

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !eq) return <Spinner />;

  return (
    <div>
      <Link to="/resources?tab=equipment" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Equipment
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">
            <span className="font-mono">{eq.code}</span> · {eq.category}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{eq.name}</h1>
            <MaintBadge status={eq.maintenance_status} />
            <Badge tone={eq.condition === 'poor' ? 'red' : eq.condition === 'fair' ? 'amber' : 'emerald'}>Condition: {CONDITION_LABELS[eq.condition]}</Badge>
          </div>
          {eq.description && <p className="mt-2 max-w-2xl text-sm text-slate-600">{eq.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {eq.can_manage && <Button variant="secondary" icon={Pencil} onClick={() => setModal('edit')}>Edit</Button>}
          {eq.can_maintain && <Button variant="secondary" icon={Wrench} onClick={() => setModal('maint')}>Maintenance</Button>}
          {eq.can_block && <Button variant="secondary" icon={Ban} onClick={() => setModal('block')}>Block</Button>}
          <Link to={`/book?equipment=${eq.id}&date=${date}`}>
            <Button icon={CalendarPlus}>Book</Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Stock right now" subtitle={`${eq.total_quantity} units in total · stored in ${eq.lab_name}`} icon={Package} />
            <div className="p-5">
              <StockBar eq={eq} />
              {eq.max_per_booking && <p className="mt-4 text-xs text-slate-500">Maximum {eq.max_per_booking} units per booking · {eq.approval_level === 'none' ? 'no approval needed' : `${eq.approval_level} approval`}</p>}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Units available through the day"
              subtitle="Free units per 30-minute slot"
              icon={CalendarDays}
              action={
                <div className="flex items-center gap-1">
                  <Button size="xs" variant="ghost" onClick={() => setDate((d) => addDays(d, -1))} aria-label="Previous day"><ChevronLeft className="size-4" /></Button>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value || todayStr())} className="rounded-md border border-slate-200 px-2 py-1 text-xs" aria-label="Date" />
                  <Button size="xs" variant="ghost" onClick={() => setDate((d) => addDays(d, 1))} aria-label="Next day"><ChevronRight className="size-4" /></Button>
                </div>
              }
            />
            <div className="h-56 p-4">
              {avail.data && (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={avail.data.slots} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap={2}>
                    <CartesianGrid vertical={false} stroke={VIZ.grid} />
                    <XAxis dataKey="time" tickFormatter={(t) => (t.endsWith(':00') ? fmtTime(t).replace(':00', '') : '')} tick={{ fontSize: 11, fill: VIZ.muted }} axisLine={{ stroke: VIZ.axis }} tickLine={false} interval={0} />
                    <YAxis allowDecimals={false} domain={[0, avail.data.total]} tick={{ fontSize: 11, fill: VIZ.muted }} axisLine={false} tickLine={false} />
                    <ReferenceLine y={avail.data.total} stroke={VIZ.axis} strokeDasharray="3 3" />
                    <Tooltip cursor={{ fill: 'rgba(42,120,214,0.08)' }} content={<ChartTooltip formatter={(v, row) => [`${v} of ${avail.data.total} free`, fmtTime(row.time)]} />} />
                    <Bar dataKey="available" fill={VIZ.series[0]} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Upcoming reservations (14 days)" icon={CalendarDays} />
            {eq.upcoming.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">No upcoming reservations.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {eq.upcoming.map((b) =>
                  b.redacted ? (
                    <li key={b.id} className="flex items-center justify-between px-5 py-3 text-sm">
                      <span>{fmtDate(b.booking_date)} · {fmtTime(b.start_time)}–{fmtTime(b.end_time)}</span>
                      <Badge tone="slate">{b.quantity} reserved</Badge>
                    </li>
                  ) : (
                    <li key={b.id}><BookingRow b={b} showUser /></li>
                  ),
                )}
              </ul>
            )}
          </Card>

          {eq.outstanding.length > 0 && (
            <Card>
              <CardHeader title="Currently issued" icon={Package} />
              <ul className="divide-y divide-slate-100">
                {eq.outstanding.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <Link to={`/bookings/${i.booking_id}`} className="hover:text-brand-700">
                      {i.quantity} × to {i.user_name} <span className="font-mono text-xs text-slate-500">{i.ref_code}</span>
                    </Link>
                    <span className={i.booking_status === 'overdue' ? 'text-xs font-medium text-red-600' : 'text-xs text-slate-500'}>due {fmtDateTime(i.due_at)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card className="p-5 text-center">
            <p className="text-sm font-semibold">Equipment QR label</p>
            <p className="text-xs text-slate-500">Scan at the desk to open this item</p>
            <div className="mx-auto mt-3 inline-block rounded-xl border border-slate-200 bg-white p-3">
              <QRCodeSVG value={eq.code} size={132} />
            </div>
            <p className="mt-2 font-mono text-sm font-semibold">{eq.code}</p>
            <Button size="sm" variant="ghost" icon={Printer} className="mt-2 no-print" onClick={() => window.print()}>Print label</Button>
          </Card>
          <Card className="space-y-2 p-5 text-sm">
            <p><span className="text-slate-500">Location:</span> <Link to={`/labs/${eq.lab_id}`} className="font-medium hover:text-brand-700">{eq.lab_name}</Link>, {eq.lab_location}</p>
            <p><span className="text-slate-500">Department:</span> {eq.department_code}</p>
            <p><span className="text-slate-500">Lifetime usage:</span> {eq.usage.bookings} bookings · {eq.usage.units} units issued</p>
            <p><span className="text-slate-500">Last serviced:</span> {eq.last_maintenance_at ? fmtDate(eq.last_maintenance_at, { year: true }) : 'No record'}</p>
          </Card>
          {eq.blocks.length > 0 && (
            <Card>
              <CardHeader title="Scheduled blocks" icon={Ban} />
              <ul className="divide-y divide-slate-100">
                {eq.blocks.map((k) => (
                  <li key={k.id} className="px-5 py-2.5 text-sm">
                    <p className="font-medium">{k.title}{k.quantity ? ` (${k.quantity} units)` : ''}</p>
                    <p className="text-xs text-slate-500">{fmtDateTime(k.start_at)} → {fmtDateTime(k.end_at)}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title="Damage & fault reports" icon={AlertTriangle} />
            {eq.damage_reports.length === 0 ? (
              <p className="px-5 py-5 text-sm text-slate-500">No reports. </p>
            ) : (
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                {eq.damage_reports.map((r) => (
                  <li key={r.id} className="px-5 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium capitalize">{r.kind} · {r.quantity} unit(s)</span>
                      <Badge tone={r.status === 'resolved' ? 'emerald' : r.status === 'written_off' ? 'slate' : 'amber'}>{r.status.replace('_', ' ')}</Badge>
                    </div>
                    <p className="text-xs text-slate-600">{r.description}</p>
                    <p className="text-[11px] text-slate-400">{timeAgo(r.created_at)}{r.responsible_name ? ` · borrower ${r.responsible_name}` : ''}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {eq.activity.length > 0 && (
            <Card>
              <CardHeader title="Resource activity" icon={Activity} />
              <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                {eq.activity.map((a) => (
                  <li key={a.id} className="px-5 py-2 text-xs">
                    <span className="font-medium text-slate-800">{a.action.replace(/_/g, ' ')}</span>
                    <span className="text-slate-500"> · {a.actor_name || 'System'} · {timeAgo(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {eq.maintenance_status === 'needs_inspection' && <Alert tone="amber">Flagged for inspection after recent fault or damage reports.</Alert>}
        </div>
      </div>

      <EquipmentFormModal open={modal === 'edit'} onClose={() => setModal(null)} equipment={eq} onSaved={() => reload(true)} />
      {modal === 'maint' && <MaintenanceModal eq={eq} open onClose={() => setModal(null)} onSaved={() => reload(true)} />}
      <BlockModal open={modal === 'block'} onClose={() => setModal(null)} resourceType="equipment" resourceId={eq.id} resourceName={eq.name} onSaved={() => reload(true)} />
    </div>
  );
}
