import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarPlus, ChevronLeft, ChevronRight, MapPin, Users, Clock, ShieldCheck, Pencil, Ban, Package, CalendarDays, Wrench, Activity } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync, useTitle } from '../lib/hooks';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Meter, Select, Spinner } from '../components/ui';
import { BookingRow, LiveBadge, MaintBadge } from '../components/booking-ui';
import { DayTimeline, TimelineLegend } from '../components/DayTimeline';
import { LabFormModal, EquipmentFormModal } from '../components/ResourceForms';
import { BlockModal } from '../components/BlockModal';
import { addDays, fmtDate, fmtDateTime, fmtTime, todayStr, timeAgo } from '../lib/format';

export default function LabDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { data: lab, error, loading, reload } = useAsync(() => api.get(`/labs/${id}`), [id]);
  const [date, setDate] = useState(todayStr());
  const schedule = useAsync(() => api.get(`/labs/${id}/schedule?date=${date}`), [id, date]);
  const { can } = useAuth();
  const activity = useAsync(() => (can('activity.view') ? api.get(`/labs/${id}/activity`) : Promise.resolve([])), [id]);
  const [modal, setModal] = useState(null);
  useTitle(lab?.name || 'Lab');

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !lab) return <Spinner />;

  const setStatus = async (status) => {
    try {
      await api.put(`/labs/${lab.id}`, { status });
      toast.success(`Lab marked as ${status}`);
      reload(true);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div>
      <Link to="/resources" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Labs & equipment
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">
            {lab.code} · {lab.department_name}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{lab.name}</h1>
            <LiveBadge status={lab.live_status} />
          </div>
          {lab.description && <p className="mt-2 max-w-2xl text-sm text-slate-600">{lab.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {lab.can_manage && <Button variant="secondary" icon={Pencil} onClick={() => setModal('edit')}>Edit</Button>}
          {lab.can_manage_availability && <Button variant="secondary" icon={Ban} onClick={() => setModal('block')}>Block / maintenance</Button>}
          <Link to={`/book?lab=${lab.id}&date=${date}`}>
            <Button icon={CalendarPlus}>Book this lab</Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Availability"
              subtitle="Bookings and blocks for the selected day"
              icon={CalendarDays}
              action={
                <div className="flex items-center gap-1">
                  <Button size="xs" variant="ghost" onClick={() => setDate((d) => addDays(d, -1))} aria-label="Previous day"><ChevronLeft className="size-4" /></Button>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value || todayStr())} className="rounded-md border border-slate-200 px-2 py-1 text-xs" aria-label="Date" />
                  <Button size="xs" variant="ghost" onClick={() => setDate((d) => addDays(d, 1))} aria-label="Next day"><ChevronRight className="size-4" /></Button>
                </div>
              }
            />
            <div className="p-5">
              {schedule.data ? (
                <>
                  <DayTimeline open={schedule.data.open_time} close={schedule.data.close_time} bookings={schedule.data.bookings} blocks={schedule.data.blocks} />
                  <div className="mt-3"><TimelineLegend /></div>
                  {schedule.data.bookings.length > 0 && (
                    <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-100">
                      {schedule.data.bookings.map((b) => (
                        <li key={b.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                          <span className="w-32 shrink-0 text-xs text-slate-500 tabular">{fmtTime(b.start_time)} – {fmtTime(b.end_time)}</span>
                          {b.redacted ? <span className="flex-1 text-slate-500">Booked · {b.attendees} attendees</span> : (
                            <Link to={`/bookings/${b.id}`} className="min-w-0 flex-1 truncate hover:text-brand-700">{b.user_name} · {b.purpose}</Link>
                          )}
                          <Badge tone={b.status === 'pending' ? 'amber' : b.status === 'in_use' ? 'violet' : 'indigo'}>{b.status.replace('_', ' ')}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                  {schedule.data.bookings.length === 0 && schedule.data.blocks.length === 0 && (
                    <p className="mt-3 text-sm text-emerald-700">Free all day on {fmtDate(date)}.</p>
                  )}
                </>
              ) : (
                <Spinner />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Equipment stored here"
              icon={Package}
              action={lab.can_manage_equipment && <Button size="xs" variant="soft" onClick={() => setModal('equipment')}>Add equipment</Button>}
            />
            {lab.equipment.length === 0 ? (
              <EmptyState title="No equipment registered in this lab" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {lab.equipment.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <Link to={`/equipment/${e.id}`} className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium hover:text-brand-700">{e.name}</p>
                      <p className="text-xs text-slate-500">{e.category}</p>
                    </Link>
                    {e.maintenance_status !== 'operational' && <MaintBadge status={e.maintenance_status} />}
                    <span className="text-xs text-slate-500 tabular">
                      {e.total_quantity} total · {e.in_use} out · {e.reserved} reserved
                    </span>
                    <span className={`w-24 text-right text-sm font-semibold tabular ${e.available_quantity ? 'text-emerald-700' : 'text-red-600'}`}>{e.available_quantity} available</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Upcoming bookings (14 days)" icon={CalendarDays} />
            {lab.upcoming.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">No upcoming bookings.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {lab.upcoming.map((b) =>
                  b.redacted ? (
                    <li key={b.id} className="flex items-center justify-between px-5 py-3 text-sm">
                      <span>{fmtDate(b.booking_date)} · {fmtTime(b.start_time)}–{fmtTime(b.end_time)}</span>
                      <Badge tone="slate">Booked</Badge>
                    </li>
                  ) : (
                    <li key={b.id}><BookingRow b={b} showUser /></li>
                  ),
                )}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="space-y-4 p-5">
            <div className="flex gap-3 text-sm"><MapPin className="size-4 text-slate-400" />{lab.location}</div>
            <div className="flex gap-3 text-sm"><Users className="size-4 text-slate-400" />{lab.capacity} seats</div>
            <div className="flex gap-3 text-sm"><Clock className="size-4 text-slate-400" />Open {fmtTime(lab.open_time)} – {fmtTime(lab.close_time)} (closed Sundays)</div>
            <div className="flex gap-3 text-sm">
              <ShieldCheck className="size-4 text-slate-400" />
              {lab.approval_level === 'none' ? 'No approval needed' : lab.approval_level === 'coordinator' ? 'Coordinator approval required' : 'Lab staff approval for students'}
              {lab.restricted_to_department && ` · ${lab.department_code} students only`}
            </div>
            {lab.incharge_name && <div className="flex gap-3 text-sm"><Wrench className="size-4 text-slate-400" />Lab in-charge: {lab.incharge_name}</div>}
            <div>
              <div className="mb-1 flex justify-between text-xs text-slate-500"><span>Utilization (30 days)</span><span className="font-medium text-slate-700 tabular">{lab.utilization}%</span></div>
              <Meter value={lab.utilization} label="Utilization" />
            </div>
            {lab.current_booking && (
              <div className="rounded-lg bg-violet-50 p-3 text-sm text-violet-900">
                <p className="font-medium">In session until {fmtTime(lab.current_booking.end_at.slice(11, 16))}</p>
                <p className="text-xs">{lab.current_booking.attendees} attendees · {lab.occupancy}% occupancy</p>
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Facilities" />
            <div className="flex flex-wrap gap-1.5 p-5">
              {lab.facilities.map((f) => <span key={f} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">{f}</span>)}
            </div>
          </Card>
          {(lab.can_manage || lab.can_manage_availability) && (
            <Card>
              <CardHeader title="Lab status" subtitle="Overrides live availability" />
              <div className="p-5">
                <Select value={lab.status} onChange={(e) => setStatus(e.target.value)} aria-label="Lab status">
                  <option value="available">Available</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="closed">Closed</option>
                </Select>
              </div>
              {lab.blocks.length > 0 && (
                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                  {lab.blocks.map((k) => (
                    <li key={k.id} className="px-5 py-2.5 text-sm">
                      <p className="font-medium">{k.title}</p>
                      <p className="text-xs text-slate-500">{k.kind} · {fmtDateTime(k.start_at)} → {fmtDateTime(k.end_at)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {activity.data?.length > 0 && (
            <Card>
              <CardHeader title="Resource activity" icon={Activity} />
              <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                {activity.data.map((a) => (
                  <li key={a.id} className="px-5 py-2 text-xs">
                    <span className="font-medium text-slate-800">{a.action.replace(/_/g, ' ')}</span>
                    <span className="text-slate-500"> · {a.actor_name || 'System'} · {timeAgo(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <LabFormModal open={modal === 'edit'} onClose={() => setModal(null)} lab={lab} onSaved={() => reload(true)} />
      <EquipmentFormModal open={modal === 'equipment'} onClose={() => setModal(null)} defaultLabId={lab.id} onSaved={() => reload(true)} />
      <BlockModal open={modal === 'block'} onClose={() => setModal(null)} resourceType="lab" resourceId={lab.id} resourceName={lab.name} onSaved={() => { reload(true); schedule.reload(true); }} />
    </div>
  );
}
