import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  FlaskConical, Package, Plus, Minus, Trash2, CalendarClock, Target, CheckCircle2, XCircle, ShieldCheck, Sparkles,
  Clock, ArrowRightLeft, ListPlus, Save, Send, Loader2, CalendarCheck, Download, AlertTriangle, Info,
} from 'lucide-react';
import { api, downloadFile } from '../lib/api';
import { useAsync, useDebounced, useTitle } from '../lib/hooks';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Textarea, Spinner } from '../components/ui';
import { PriorityBadge } from '../components/booking-ui';
import { DayTimeline, TimelineLegend } from '../components/DayTimeline';
import { PURPOSE_LABELS, TIME_OPTIONS, addDays, durationLabel, fmtDate, fmtTime, todayStr, toMinutes, fromMinutes } from '../lib/format';

function defaultDate() {
  const d = new Date();
  if (d.getHours() >= 17) return addDays(todayStr(), 1);
  return todayStr();
}
function defaultStart() {
  const d = new Date();
  if (d.getHours() >= 17 || d.getHours() < 8) return '10:00';
  return fromMinutes(Math.min(18 * 60, Math.ceil((d.getHours() * 60 + d.getMinutes() + 90) / 30) * 30));
}

function QtyStepper({ value, onChange, max }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-slate-300 bg-white">
      <button type="button" className="px-2 py-1.5 text-slate-500 hover:text-slate-900 disabled:opacity-30" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} aria-label="Decrease quantity">
        <Minus className="size-3.5" />
      </button>
      <input
        type="number"
        min={1}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
        className="w-12 border-x border-slate-200 py-1 text-center text-sm tabular focus:outline-none"
        aria-label="Quantity"
      />
      <button type="button" className="px-2 py-1.5 text-slate-500 hover:text-slate-900" onClick={() => onChange(value + 1)} aria-label="Increase quantity">
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

/** Units free per 30-minute slot for one equipment item on the chosen date. */
function EquipmentStrip({ equipmentId, date, quantity, start, end }) {
  const { data } = useAsync(() => api.get(`/equipment/${equipmentId}/availability?date=${date}`), [equipmentId, date]);
  if (!data) return <div className="h-5" />;
  return (
    <div className="mt-2">
      <div className="flex h-5 gap-px overflow-hidden rounded" role="img" aria-label="Availability by half hour">
        {data.slots.map((s) => {
          const inSel = s.time >= start && s.time < end;
          const ok = s.available >= quantity;
          return (
            <span
              key={s.time}
              title={`${fmtTime(s.time)} — ${s.available} of ${data.total} free`}
              className={clsx('flex-1', ok ? (inSel ? 'bg-emerald-500' : 'bg-emerald-200') : inSel ? 'bg-red-500' : 'bg-red-200', inSel && 'ring-1 ring-slate-900/20')}
            />
          );
        })}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-slate-400 tabular">
        <span>{fmtTime(data.slots[0]?.time)}</span>
        <span>green = enough units for your quantity</span>
        <span>{fmtTime(fromMinutes(toMinutes(data.slots.at(-1)?.time || '20:00') + 30))}</span>
      </div>
    </div>
  );
}

function CheckPanel({ evaluation, checking, onApplySlot, onSwitchLab, onFixItem, onWaitlist, waitlisting, canCheck }) {
  if (!canCheck) {
    return (
      <div className="flex items-start gap-3 p-5 text-sm text-slate-500">
        <Info className="mt-0.5 size-4 shrink-0" />
        Select a lab or equipment and a time to run the availability, conflict and rules check.
      </div>
    );
  }
  if (!evaluation) return <Spinner label="Checking availability…" />;
  const { ok, errors, warnings, approval, priority, alternatives, items, lab } = evaluation;
  return (
    <div className={clsx('space-y-4 p-5 transition-opacity', checking && 'opacity-60')}>
      <div className={clsx('flex items-center gap-3 rounded-xl p-3', ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900')}>
        {ok ? <CheckCircle2 className="size-6 shrink-0 text-emerald-600" /> : <XCircle className="size-6 shrink-0 text-red-600" />}
        <div>
          <p className="font-semibold">{ok ? 'Available — ready to submit' : 'This request cannot be submitted yet'}</p>
          <p className="text-xs opacity-80">{ok ? 'No conflicts, all booking rules satisfied.' : `${errors.length} issue${errors.length > 1 ? 's' : ''} found`}</p>
        </div>
        {checking && <Loader2 className="ml-auto size-4 animate-spin" />}
      </div>

      {errors.length > 0 && (
        <ul className="space-y-1.5">
          {errors.map((e, i) => (
            <li key={i} className="flex gap-2 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>{e.message}</span>
            </li>
          ))}
        </ul>
      )}
      {warnings?.length > 0 && warnings.map((w) => <Alert key={w} tone="amber">{w}</Alert>)}

      {(lab || items?.length > 0) && (
        <div className="space-y-1.5 text-sm">
          {lab && (
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-slate-600">{lab.name}</span>
              {lab.available ? <Badge tone="emerald">Free</Badge> : <Badge tone="red">Unavailable</Badge>}
            </div>
          )}
          {items?.map((i) => (
            <div key={i.equipment_id} className="flex items-center justify-between gap-2">
              <span className="truncate text-slate-600">
                {i.requested} × {i.name}
              </span>
              <Badge tone={i.ok ? 'emerald' : 'red'}>
                {i.available}/{i.total} free
              </Badge>
            </div>
          ))}
        </div>
      )}

      {alternatives && (
        <div className="space-y-4 rounded-xl border border-brand-100 bg-brand-50/40 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-brand-900">
            <Sparkles className="size-4" /> Suggestions
          </p>
          {alternatives.equipment?.map((x) => (
            <div key={x.equipment_id} className="space-y-1.5">
              {x.available > 0 && (
                <button type="button" onClick={() => onFixItem(x.equipment_id, { quantity: x.available })} className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:border-brand-300">
                  <span>
                    Book the <b>{x.available}</b> units currently available
                  </span>
                  <span className="text-xs font-medium text-brand-700">Apply</span>
                </button>
              )}
              {x.alternatives.map((a) => (
                <button key={a.equipment_id} type="button" onClick={() => onFixItem(x.equipment_id, { equipment_id: a.equipment_id, quantity: Math.min(x.requested, a.available) })} className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:border-brand-300">
                  <span className="min-w-0">
                    <span className="block truncate">Use {a.name}</span>
                    <span className="block text-xs text-slate-500">{a.available} free · {a.lab_name}</span>
                  </span>
                  <ArrowRightLeft className="size-4 shrink-0 text-brand-700" />
                </button>
              ))}
            </div>
          ))}
          {alternatives.slots?.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-600">Other available times</p>
              <div className="flex flex-wrap gap-1.5">
                {alternatives.slots.map((s) => (
                  <button key={`${s.date}${s.start_time}`} type="button" onClick={() => onApplySlot(s)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs hover:border-brand-400 hover:bg-brand-50">
                    <span className="font-medium">{fmtTime(s.start_time)}–{fmtTime(s.end_time)}</span>
                    <span className="block text-[10px] text-slate-500">{s.label === 'Same day' ? 'Same day' : fmtDate(s.date)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {alternatives.labs?.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-600">Alternative labs at this time</p>
              <div className="space-y-1.5">
                {alternatives.labs.map((l) => (
                  <button key={l.lab_id} type="button" onClick={() => onSwitchLab(l.lab_id)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:border-brand-300">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{l.name}</span>
                      <span className="block text-xs text-slate-500">Capacity {l.capacity} · {l.department_code}</span>
                    </span>
                    <Badge tone="blue">{l.match}% match</Badge>
                  </button>
                ))}
              </div>
            </div>
          )}
          {evaluation.can_waitlist && (
            <Button size="sm" variant="secondary" icon={ListPlus} className="w-full" onClick={onWaitlist} loading={waitlisting}>
              Join the waitlist for this slot
            </Button>
          )}
        </div>
      )}

      {approval && (
        <div className="space-y-2 border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
              <ShieldCheck className="size-4" /> Approval
            </span>
            <Badge tone={approval.level === 'none' ? 'emerald' : approval.level === 'coordinator' ? 'amber' : 'blue'}>
              {approval.level === 'none' ? 'Instant confirmation' : approval.level === 'coordinator' ? 'Coordinator review' : 'Lab staff review'}
            </Badge>
          </div>
          <ul className="space-y-0.5 text-xs text-slate-500">
            {approval.reasons.map((r) => <li key={r}>• {r}</li>)}
          </ul>
        </div>
      )}
      {priority && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
              <Target className="size-4" /> Review priority
            </span>
            <PriorityBadge level={priority.level} score={priority.score} />
          </div>
          <p className="text-xs text-slate-500">{priority.reasons.join(' · ')}</p>
        </div>
      )}
    </div>
  );
}

function Success({ booking }) {
  const toast = useToast();
  const instant = booking.status === 'approved' || booking.status === 'reserved';
  return (
    <div className="mx-auto max-w-xl">
      <Card className="p-8 text-center">
        <span className={clsx('mx-auto flex size-14 items-center justify-center rounded-full', instant ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600')}>
          {instant ? <CalendarCheck className="size-7" /> : <Clock className="size-7" />}
        </span>
        <h1 className="mt-4 text-xl font-semibold">{instant ? 'Booking confirmed!' : 'Request submitted'}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {instant
            ? 'Your resources are reserved. Show the booking QR code at the lab to check in.'
            : `It's now with ${booking.required_approval === 'coordinator' ? 'the department coordinator' : 'lab staff'} for approval. We'll notify you as soon as it's reviewed.`}
        </p>
        <p className="mt-4 font-mono text-lg font-semibold tracking-wide text-slate-900">{booking.ref_code}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link to={`/bookings/${booking.id}`}>
            <Button>View booking</Button>
          </Link>
          <Button variant="secondary" icon={Download} onClick={() => downloadFile(`/bookings/${booking.id}/ics`, `${booking.ref_code}.ics`).catch(toast.error)}>
            Add to calendar
          </Button>
          <Link to="/book" reloadDocument>
            <Button variant="ghost">Book something else</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}

export default function BookingNew() {
  useTitle('New booking');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const draftId = params.get('draft');

  const [labId, setLabId] = useState(params.get('lab') || '');
  const [items, setItems] = useState(() => {
    if (params.get('items')) {
      try {
        return JSON.parse(params.get('items'));
      } catch {
        /* ignore */
      }
    }
    return params.get('equipment') ? [{ equipment_id: Number(params.get('equipment')), quantity: Number(params.get('qty')) || 1 }] : [];
  });
  const [date, setDate] = useState(params.get('date') || defaultDate());
  const [start, setStart] = useState(params.get('start') || defaultStart());
  const [end, setEnd] = useState(params.get('end') || fromMinutes(Math.min(21 * 60, toMinutes(params.get('start') || defaultStart()) + 120)));
  const [attendees, setAttendees] = useState(Number(params.get('attendees')) || 1);
  const [purposeType, setPurposeType] = useState(params.get('purpose_type') || (user.role === 'faculty' ? 'class' : 'project'));
  const [purpose, setPurpose] = useState(params.get('purpose') || '');
  const [addEq, setAddEq] = useState('');
  const [evaluation, setEvaluation] = useState(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(null);
  const [waitlisting, setWaitlisting] = useState(false);
  const [created, setCreated] = useState(null);
  const [submitError, setSubmitError] = useState('');

  const catalog = useAsync(() => Promise.all([api.get('/labs'), api.get('/equipment')]), []);
  const [labs, equipment] = catalog.data || [[], []];
  const lab = labs.find((l) => String(l.id) === String(labId));
  const eqById = useMemo(() => new Map(equipment.map((e) => [e.id, e])), [equipment]);

  // Load an existing draft for editing.
  useEffect(() => {
    if (!draftId) return;
    api.get(`/bookings/${draftId}`).then((b) => {
      setLabId(b.lab_id || '');
      setItems(b.items.map((i) => ({ equipment_id: i.equipment_id, quantity: i.quantity })));
      setDate(b.booking_date);
      setStart(b.start_time);
      setEnd(b.end_time);
      setAttendees(b.attendees);
      setPurposeType(b.purpose_type);
      setPurpose(b.purpose || '');
    }).catch(toast.error);
  }, [draftId, toast]);

  const schedule = useAsync(() => (labId ? api.get(`/labs/${labId}/schedule?date=${date}`) : Promise.resolve(null)), [labId, date]);

  const payload = useMemo(
    () => ({ lab_id: labId || null, items, booking_date: date, start_time: start, end_time: end, attendees, purpose_type: purposeType, purpose, exclude_id: draftId || undefined }),
    [labId, items, date, start, end, attendees, purposeType, purpose, draftId],
  );
  const canCheck = (labId || items.length > 0) && date && start && end && end > start;
  const debounced = useDebounced(payload, 400);

  useEffect(() => {
    if (!canCheck) {
      setEvaluation(null);
      return undefined;
    }
    const ctl = new AbortController();
    setChecking(true);
    api('/bookings/check', { method: 'POST', body: debounced, signal: ctl.signal })
      .then(setEvaluation)
      .catch((err) => err.name !== 'AbortError' && setEvaluation(null))
      .finally(() => setChecking(false));
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const updateItem = (eid, patch) => setItems((xs) => xs.map((x) => (x.equipment_id === eid ? { ...x, ...patch } : x)));
  const addItem = (eid) => {
    const id = Number(eid);
    if (!id) return;
    setItems((xs) => (xs.some((x) => x.equipment_id === id) ? xs : [...xs, { equipment_id: id, quantity: 1 }]));
    setAddEq('');
  };
  const applySlot = (s) => {
    setDate(s.date);
    setStart(s.start_time);
    setEnd(s.end_time);
  };
  const onStartChange = (v) => {
    const dur = toMinutes(end) - toMinutes(start);
    setStart(v);
    setEnd(fromMinutes(Math.min(toMinutes('22:00'), toMinutes(v) + (dur > 0 ? dur : 60))));
  };

  const save = async (asDraft) => {
    setSubmitError('');
    setSubmitting(asDraft ? 'draft' : 'submit');
    try {
      if (draftId) {
        await api.put(`/bookings/${draftId}`, payload);
        if (asDraft) {
          toast.success('Draft saved');
          navigate(`/bookings/${draftId}`);
        } else {
          const b = await api.post(`/bookings/${draftId}/submit`);
          setCreated(b);
        }
      } else {
        const r = await api.post('/bookings', { ...payload, draft: asDraft });
        if (asDraft) {
          toast.success('Draft saved — you can submit it later from My bookings');
          navigate(`/bookings/${r.booking.id}`);
        } else setCreated(r.booking);
      }
    } catch (err) {
      setSubmitError(err.message);
      if (err.details?.evaluation) setEvaluation(err.details.evaluation);
    } finally {
      setSubmitting(null);
    }
  };

  const joinWaitlist = async () => {
    setWaitlisting(true);
    try {
      const codes = new Set(evaluation.errors.map((e) => e.code));
      const reqs = [];
      if (labId && (codes.has('lab_conflict') || codes.has('lab_blocked'))) reqs.push({ resource_type: 'lab', resource_id: labId });
      for (const e of evaluation.errors.filter((x) => x.code === 'insufficient_quantity')) {
        reqs.push({ resource_type: 'equipment', resource_id: e.equipment_id, quantity: items.find((i) => i.equipment_id === e.equipment_id)?.quantity });
      }
      for (const r of reqs) await api.post('/waitlist', { ...r, booking_date: date, start_time: start, end_time: end, note: purpose });
      toast.success("You're on the waitlist — we'll notify you if it frees up");
    } catch (err) {
      toast.error(err);
    } finally {
      setWaitlisting(false);
    }
  };

  if (created) return <Success booking={created} />;

  const labEquipment = lab ? equipment.filter((e) => e.lab_id === lab.id && !items.some((i) => i.equipment_id === e.id)) : [];
  const evalItem = (eid) => evaluation?.items?.find((i) => i.equipment_id === eid);

  return (
    <div>
      <PageHeader
        title={draftId ? 'Edit draft booking' : 'New booking'}
        subtitle="Choose resources and a time. Availability, conflicts and booking rules are checked as you go."
        actions={
          <Link to="/finder">
            <Button variant="secondary" icon={Sparkles}>Not sure? Use Smart finder</Button>
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="1. What do you need?" subtitle="A lab, equipment, or both" icon={FlaskConical} />
            <div className="space-y-5 p-5">
              <Field label="Laboratory">
                {(id) => (
                  <Select id={id} value={labId} onChange={(e) => setLabId(e.target.value)}>
                    <option value="">No lab — equipment only</option>
                    {labs.map((l) => (
                      <option key={l.id} value={l.id} disabled={l.status === 'closed'}>
                        {l.name} ({l.code}) · {l.capacity} seats{l.status !== 'available' ? ` · ${l.status}` : ''}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {lab && (
                <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                  <p>
                    <b className="text-slate-800">{lab.location}</b> · Open {fmtTime(lab.open_time)}–{fmtTime(lab.close_time)} · {lab.department_name}
                  </p>
                  <p className="mt-1">{lab.facilities.join(' · ')}</p>
                </div>
              )}

              <div>
                <p className="label">Equipment</p>
                {items.length === 0 && <p className="mb-2 text-sm text-slate-500">No equipment added.</p>}
                <ul className="space-y-3">
                  {items.map((it) => {
                    const e = eqById.get(it.equipment_id);
                    const ev = evalItem(it.equipment_id);
                    return (
                      <li key={it.equipment_id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <Package className="size-4 shrink-0 text-amber-600" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{e?.name || `Equipment #${it.equipment_id}`}</p>
                            <p className="text-xs text-slate-500">
                              {e?.lab_name}
                              {e?.max_per_booking ? ` · max ${e.max_per_booking} per booking` : ''}
                              {ev && (
                                <span className={clsx('ml-1 font-medium', ev.ok ? 'text-emerald-700' : 'text-red-600')}>
                                  · {ev.available} of {ev.total} free for this slot
                                </span>
                              )}
                            </p>
                          </div>
                          <QtyStepper value={it.quantity} onChange={(q) => updateItem(it.equipment_id, { quantity: q })} />
                          <button type="button" onClick={() => setItems((xs) => xs.filter((x) => x.equipment_id !== it.equipment_id))} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove">
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                        {date && <EquipmentStrip equipmentId={it.equipment_id} date={date} quantity={it.quantity} start={start} end={end} />}
                      </li>
                    );
                  })}
                </ul>
                {labEquipment.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1.5 text-xs text-slate-500">Available in {lab.name}:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {labEquipment.map((e) => (
                        <button key={e.id} type="button" onClick={() => addItem(e.id)} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs hover:border-brand-300 hover:bg-brand-50">
                          <Plus className="size-3" /> {e.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <Select value={addEq} onChange={(e) => addItem(e.target.value)} aria-label="Add equipment">
                    <option value="">+ Add equipment from any lab…</option>
                    {Object.entries(
                      equipment.reduce((acc, e) => {
                        (acc[e.category] ||= []).push(e);
                        return acc;
                      }, {}),
                    ).map(([cat, list]) => (
                      <optgroup key={cat} label={cat}>
                        {list.map((e) => (
                          <option key={e.id} value={e.id} disabled={items.some((i) => i.equipment_id === e.id) || e.maintenance_status === 'retired'}>
                            {e.name} — {e.lab_code}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="2. When?" subtitle={end > start ? `Duration ${durationLabel(start, end)}` : 'Pick a start and end time'} icon={CalendarClock} />
            <div className="space-y-5 p-5">
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="Date" className="sm:col-span-2">{(id) => <Input id={id} type="date" min={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
                <Field label="Start">
                  {(id) => (
                    <Select id={id} value={start} onChange={(e) => onStartChange(e.target.value)}>
                      {TIME_OPTIONS.map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label="End">
                  {(id) => (
                    <Select id={id} value={end} onChange={(e) => setEnd(e.target.value)}>
                      {TIME_OPTIONS.filter((t) => t > start).map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}
                    </Select>
                  )}
                </Field>
              </div>
              {lab && schedule.data && (
                <div>
                  <p className="mb-2 text-xs font-medium text-slate-600">
                    {lab.name} on {fmtDate(date)} — click an hour to move your slot
                  </p>
                  <DayTimeline
                    open={schedule.data.open_time}
                    close={schedule.data.close_time}
                    bookings={schedule.data.bookings.filter((b) => String(b.id) !== String(draftId))}
                    blocks={schedule.data.blocks}
                    selection={{ start, end, ok: evaluation ? evaluation.lab?.available !== false : undefined }}
                    onPick={onStartChange}
                  />
                  <div className="mt-2">
                    <TimelineLegend />
                  </div>
                </div>
              )}
              <Field label="Number of attendees" hint={lab ? `${lab.name} seats ${lab.capacity}` : 'People who will use the resources'} className="sm:w-48">
                {(id) => <Input id={id} type="number" min={1} value={attendees} onChange={(e) => setAttendees(Math.max(1, Number.parseInt(e.target.value, 10) || 1))} />}
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="3. Purpose" subtitle="Helps staff prioritise and approve your request" icon={Target} />
            <div className="grid gap-4 p-5 sm:grid-cols-3">
              <Field label="Type">
                {(id) => (
                  <Select id={id} value={purposeType} onChange={(e) => setPurposeType(e.target.value)}>
                    {Object.entries(PURPOSE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Describe your session" className="sm:col-span-2" hint="e.g. course code, project title, what you'll do">
                {(id) => <Textarea id={id} rows={2} value={purpose} maxLength={1000} onChange={(e) => setPurpose(e.target.value)} placeholder="Project session — IoT smart irrigation prototype" />}
              </Field>
            </div>
          </Card>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader title="Availability & rules check" subtitle="Live — updates as you edit" icon={ShieldCheck} />
            <CheckPanel
              evaluation={evaluation}
              checking={checking}
              canCheck={canCheck}
              onApplySlot={applySlot}
              onSwitchLab={(id) => setLabId(String(id))}
              onFixItem={(eid, patch) => {
                if (patch.equipment_id && patch.equipment_id !== eid) setItems((xs) => xs.filter((x) => x.equipment_id !== patch.equipment_id).map((x) => (x.equipment_id === eid ? { ...x, ...patch } : x)));
                else updateItem(eid, patch);
              }}
              onWaitlist={joinWaitlist}
              waitlisting={waitlisting}
            />
            <div className="space-y-2 border-t border-slate-100 p-5">
              {submitError && <Alert tone="red">{submitError}</Alert>}
              <Button className="w-full" size="lg" icon={Send} onClick={() => save(false)} loading={submitting === 'submit'} disabled={!evaluation?.ok || checking || !!submitting}>
                {evaluation?.approval?.level === 'none' ? 'Confirm booking' : 'Submit request'}
              </Button>
              <Button className="w-full" variant="secondary" icon={Save} onClick={() => save(true)} loading={submitting === 'draft'} disabled={!canCheck || !!submitting}>
                Save as draft
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
