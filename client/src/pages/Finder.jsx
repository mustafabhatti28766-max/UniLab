import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Sparkles, Plus, Trash2, Search, CheckCircle2, XCircle, CalendarPlus, Users, MapPin, Package, Lightbulb } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync, useTitle } from '../lib/hooks';
import { useToast } from '../context/ToastContext';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, Meter, PageHeader, Select, Textarea } from '../components/ui';
import { PURPOSE_LABELS, TIME_OPTIONS, addDays, fmtDate, fmtTime, todayStr } from '../lib/format';

export default function Finder() {
  useTitle('Smart finder');
  const toast = useToast();
  const catalog = useAsync(() => Promise.all([api.get('/categories'), api.get('/departments')]), []);
  const [categories, departments] = catalog.data || [[], []];
  const [form, setForm] = useState({
    date: addDays(todayStr(), 1),
    start_time: '14:00',
    end_time: '16:00',
    attendees: 5,
    purpose_type: 'project',
    purpose: 'Embedded systems project session with Arduino kits',
    department_id: '',
  });
  const [needs, setNeeds] = useState([{ category_id: '', quantity: 5 }]);
  const [results, setResults] = useState(null);
  const [eqResults, setEqResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Default the first need to Microcontroller Kits once categories load (matches the example scenario).
  useEffect(() => {
    const mc = categories.find((c) => /microcontroller/i.test(c.name));
    if (mc) setNeeds((xs) => (xs.length === 1 && xs[0].category_id === '' ? [{ category_id: String(mc.id), quantity: 5 }] : xs));
  }, [categories]);

  const run = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const validNeeds = needs.filter((n) => n.category_id);
      const body = { ...form, attendees: Number(form.attendees), needs: validNeeds };
      const [labs, eq] = await Promise.all([api.post('/recommendations/labs', body), validNeeds.length ? api.post('/recommendations/equipment', body) : Promise.resolve([])]);
      setResults(labs);
      setEqResults(eq);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const bookLink = (r, slot) => {
    const p = new URLSearchParams({
      lab: r.lab_id,
      date: slot?.date || form.date,
      start: slot?.start_time || form.start_time,
      end: slot?.end_time || form.end_time,
      attendees: form.attendees,
      purpose: form.purpose,
      purpose_type: form.purpose_type,
    });
    if (r.equipment.length) p.set('items', JSON.stringify(r.equipment.map((e) => ({ equipment_id: e.equipment_id, quantity: e.quantity }))));
    return `/book?${p}`;
  };
  const catName = (id) => categories.find((c) => String(c.id) === String(id))?.name;

  return (
    <div>
      <PageHeader title="Smart resource finder" subtitle="Describe what you need — we rank every lab by equipment, capacity, purpose, department and availability." />
      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="lg:sticky lg:top-20 lg:self-start">
          <CardHeader title="Your requirements" icon={Sparkles} />
          <form onSubmit={run} className="space-y-4 p-5">
            <Field label="Date">{(id) => <Input id={id} type="date" min={todayStr()} value={form.date} onChange={set('date')} />}</Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From">{(id) => <Select id={id} value={form.start_time} onChange={set('start_time')}>{TIME_OPTIONS.map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}</Select>}</Field>
              <Field label="To">{(id) => <Select id={id} value={form.end_time} onChange={set('end_time')}>{TIME_OPTIONS.filter((t) => t > form.start_time).map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}</Select>}</Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Attendees">{(id) => <Input id={id} type="number" min={1} value={form.attendees} onChange={set('attendees')} />}</Field>
              <Field label="Purpose type">{(id) => <Select id={id} value={form.purpose_type} onChange={set('purpose_type')}>{Object.entries(PURPOSE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>}</Field>
            </div>
            <Field label="What will you do?" hint="Keywords like “Arduino”, “GPU training”, “video shoot” improve matching">
              {(id) => <Textarea id={id} rows={2} value={form.purpose} onChange={set('purpose')} />}
            </Field>
            <Field label="Preferred department">
              {(id) => (
                <Select id={id} value={form.department_id} onChange={set('department_id')}>
                  <option value="">My department</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              )}
            </Field>
            <div>
              <p className="label">Equipment needed</p>
              <div className="space-y-2">
                {needs.map((n, i) => (
                  <div key={i} className="flex gap-2">
                    <Select value={n.category_id} onChange={(e) => setNeeds((xs) => xs.map((x, j) => (j === i ? { ...x, category_id: e.target.value } : x)))} aria-label="Equipment category">
                      <option value="">Category…</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                    <Input type="number" min={1} className="w-20" value={n.quantity} onChange={(e) => setNeeds((xs) => xs.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} aria-label="Quantity" />
                    <button type="button" onClick={() => setNeeds((xs) => xs.filter((_, j) => j !== i))} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
              <Button type="button" size="xs" variant="ghost" icon={Plus} className="mt-2" onClick={() => setNeeds((xs) => [...xs, { category_id: '', quantity: 1 }])}>
                Add equipment need
              </Button>
            </div>
            <Button type="submit" className="w-full" icon={Search} loading={busy}>
              Find best matches
            </Button>
          </form>
        </Card>

        <div className="space-y-6">
          {!results ? (
            <Card>
              <EmptyState icon={Lightbulb} title="Get ranked recommendations" description="Instead of only exact matches, the finder suggests suitable alternatives — including labs that are busy, with their next free slot." />
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader title="Recommended labs" subtitle={`${fmtDate(form.date)} · ${fmtTime(form.start_time)}–${fmtTime(form.end_time)} · ${form.attendees} attendees`} icon={Sparkles} />
                <div className="hidden grid-cols-[minmax(0,2fr)_110px_80px_minmax(0,1.3fr)_110px] gap-4 border-b border-slate-100 px-5 py-2 text-xs font-medium text-slate-500 md:grid">
                  <span>Lab</span>
                  <span>Available</span>
                  <span>Capacity</span>
                  <span>Match</span>
                  <span />
                </div>
                <ul className="divide-y divide-slate-100">
                  {results.map((r, idx) => (
                    <li key={r.lab_id} className={clsx('grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,2fr)_110px_80px_minmax(0,1.3fr)_110px] md:items-center md:gap-4', !r.available && 'bg-slate-50/60')}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          {idx === 0 && r.available && <Badge tone="emerald">Best match</Badge>}
                          <Link to={`/labs/${r.lab_id}`} className="truncate font-medium text-slate-900 hover:text-brand-700">
                            {r.name}
                          </Link>
                        </div>
                        <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                          <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{r.location}</span>
                          <span>{r.department_code}</span>
                          <span>{r.utilization}% utilized</span>
                        </p>
                        <ul className="mt-1.5 space-y-0.5 text-xs">
                          {r.reasons.slice(0, 3).map((x) => (
                            <li key={x} className="text-emerald-700">✓ {x}</li>
                          ))}
                          {r.warnings.slice(0, 2).map((x) => (
                            <li key={x} className="text-amber-700">! {x}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        {r.available ? (
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700"><CheckCircle2 className="size-4" /> Yes</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-red-600"><XCircle className="size-4" /> No</span>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1 text-sm text-slate-700 tabular"><Users className="size-3.5 text-slate-400" />{r.capacity}</span>
                      <div className="flex items-center gap-2">
                        {r.available || r.eligible ? (
                          <>
                            <Meter value={r.match} label={`${r.name} match`} tone={r.available ? 'blue' : 'slate'} />
                            <span className="w-10 text-right text-sm font-semibold tabular">{r.match}%</span>
                          </>
                        ) : (
                          <span className="text-sm text-slate-500">Not eligible</span>
                        )}
                      </div>
                      <div className="md:text-right">
                        {r.available ? (
                          <Link to={bookLink(r)}>
                            <Button size="sm" icon={CalendarPlus}>Book</Button>
                          </Link>
                        ) : r.next_slot ? (
                          <Link to={bookLink(r, r.next_slot)} title="Book the next free slot today">
                            <Button size="sm" variant="secondary">
                              {fmtTime(r.next_slot.start_time)}–{fmtTime(r.next_slot.end_time)}
                            </Button>
                          </Link>
                        ) : (
                          <span className="text-xs text-slate-400">No free slot that day</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>

              {eqResults?.length > 0 && (
                <Card>
                  <CardHeader title="Equipment options" subtitle="Ranked by availability for your slot, condition and department" icon={Package} />
                  <div className="divide-y divide-slate-100">
                    {eqResults.map((n) => (
                      <div key={n.category_id} className="px-5 py-4">
                        <p className="mb-2 text-sm font-semibold">
                          {catName(n.category_id)} <span className="font-normal text-slate-500">· need {n.quantity}</span>
                        </p>
                        {n.options.length === 0 && <Alert tone="amber">No equipment of this type exists.</Alert>}
                        <ul className="space-y-1.5">
                          {n.options.slice(0, 5).map((o) => (
                            <li key={o.equipment_id} className="flex flex-wrap items-center gap-3 text-sm">
                              <span className="min-w-0 flex-1 truncate">
                                {o.name} <span className="text-xs text-slate-500">· {o.lab_name}</span>
                              </span>
                              <Badge tone={o.sufficient ? 'emerald' : o.available ? 'amber' : 'red'}>
                                {o.available} free{!o.sufficient && o.available > 0 ? ` (only ${o.available} of ${n.quantity})` : ''}
                              </Badge>
                              <Link to={`/book?equipment=${o.equipment_id}&qty=${Math.min(n.quantity, Math.max(1, o.available))}&date=${form.date}&start=${form.start_time}&end=${form.end_time}`}>
                                <Button size="xs" variant="soft" disabled={!o.available}>Book</Button>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
