import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAsync, useTitle } from '../lib/hooks';
import { Button, Card, ErrorState, PageHeader, Select, Skeleton } from '../components/ui';
import { TimelineLegend } from '../components/DayTimeline';
import { addDays, fmtDate, fmtTime, fromMinutes, nowLocal, todayStr, toMinutes } from '../lib/format';

const START = 7 * 60;
const END = 21 * 60;
const SPAN = END - START;
const COLORS = {
  pending: 'bg-amber-100 border-amber-300 text-amber-900',
  approved: 'bg-blue-100 border-blue-300 text-blue-900',
  reserved: 'bg-indigo-100 border-indigo-300 text-indigo-900',
  in_use: 'bg-violet-100 border-violet-300 text-violet-900',
  overdue: 'bg-red-100 border-red-300 text-red-900',
};
const pct = (t) => `${((toMinutes(t) - START) / SPAN) * 100}%`;
const w = (a, b) => `${((toMinutes(b) - toMinutes(a)) / SPAN) * 100}%`;

export default function Schedule() {
  useTitle('Schedule');
  const navigate = useNavigate();
  const [date, setDate] = useState(todayStr());
  const [dept, setDept] = useState('');
  const departments = useAsync(() => api.get('/departments'), []);
  const { data, error, loading, reload } = useAsync(() => api.get(`/schedule${qs({ date, department_id: dept })}`), [date, dept]);
  const hours = useMemo(() => Array.from({ length: (END - START) / 60 + 1 }, (_, i) => START + i * 60), []);
  const now = nowLocal();
  const showNow = date === todayStr() && toMinutes(now.slice(11, 16)) >= START && toMinutes(now.slice(11, 16)) <= END;

  return (
    <div>
      <PageHeader
        title="Lab schedule"
        subtitle="All labs on one timeline. Click an empty slot to book it."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={dept} onChange={(e) => setDept(e.target.value)} className="w-auto" aria-label="Department">
              <option value="">All departments</option>
              {(departments.data || []).map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}
            </Select>
            <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white p-0.5">
              <Button size="xs" variant="ghost" onClick={() => setDate((d) => addDays(d, -1))} aria-label="Previous day"><ChevronLeft className="size-4" /></Button>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value || todayStr())} className="border-0 px-1 py-1 text-sm focus:outline-none" aria-label="Date" />
              <Button size="xs" variant="ghost" onClick={() => setDate((d) => addDays(d, 1))} aria-label="Next day"><ChevronRight className="size-4" /></Button>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setDate(todayStr())}>Today</Button>
          </div>
        }
      />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-slate-700"><CalendarDays className="size-4" /> {fmtDate(date, { full: true, year: true })}</p>
        <TimelineLegend />
      </div>
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Skeleton className="h-96" />
      ) : (
        <Card className="overflow-x-auto scroll-thin">
          <div className="min-w-[900px]">
            <div className="sticky top-0 z-10 flex border-b border-slate-200 bg-white">
              <div className="w-52 shrink-0 px-4 py-2 text-xs font-medium text-slate-500">Lab</div>
              <div className="relative h-8 flex-1">
                {hours.slice(0, -1).map((m) => (
                  <span key={m} className="absolute top-2 -translate-x-1/2 text-[11px] text-slate-400 tabular" style={{ left: pct(fromMinutes(m)) }}>
                    {fmtTime(fromMinutes(m)).replace(':00', '')}
                  </span>
                ))}
              </div>
            </div>
            {data.labs.map((lab) => (
              <div key={lab.id} className="flex border-b border-slate-100 last:border-0">
                <Link to={`/labs/${lab.id}`} className="w-52 shrink-0 px-4 py-3 hover:bg-slate-50">
                  <p className="truncate text-sm font-medium text-slate-900">{lab.name}</p>
                  <p className="text-xs text-slate-500">{lab.code} · {lab.capacity} seats</p>
                </Link>
                <div className="relative h-16 flex-1">
                  {/* closed hours */}
                  <div className="absolute inset-y-0 left-0 bg-slate-100/80" style={{ width: w(fromMinutes(START), lab.open_time) }} />
                  <div className="absolute inset-y-0 right-0 bg-slate-100/80" style={{ left: pct(lab.close_time) }} />
                  {hours.slice(1, -1).map((m) => <span key={m} className="absolute inset-y-0 w-px bg-slate-100" style={{ left: pct(fromMinutes(m)) }} />)}
                  {lab.status === 'available' &&
                    hours.slice(0, -1).map((m) => {
                      const t = fromMinutes(m);
                      if (m < toMinutes(lab.open_time) || m + 60 > toMinutes(lab.close_time)) return null;
                      return (
                        <button
                          key={m}
                          className="absolute inset-y-0 hover:bg-brand-50"
                          style={{ left: pct(t), width: w(t, fromMinutes(m + 60)) }}
                          onClick={() => navigate(`/book?lab=${lab.id}&date=${date}&start=${t}&end=${fromMinutes(m + 60)}`)}
                          aria-label={`Book ${lab.name} at ${fmtTime(t)}`}
                        />
                      );
                    })}
                  {lab.status !== 'available' && (
                    <div className="absolute inset-1 flex items-center justify-center rounded-md bg-[repeating-linear-gradient(135deg,#fef3c7,#fef3c7_6px,#fde68a_6px,#fde68a_12px)] text-xs font-medium text-amber-900">
                      Lab {lab.status}
                    </div>
                  )}
                  {lab.blocks.map((k) => {
                    const s = k.start_at.slice(0, 10) < date ? fromMinutes(START) : k.start_at.slice(11, 16);
                    const e = k.end_at.slice(0, 10) > date ? fromMinutes(END) : k.end_at.slice(11, 16);
                    return (
                      <div key={`k${k.id}`} title={k.title} className="pointer-events-none absolute inset-y-1.5 overflow-hidden rounded-md border border-amber-300 bg-[repeating-linear-gradient(135deg,#fef3c7,#fef3c7_6px,#fde68a_6px,#fde68a_12px)] px-2 py-1 text-[11px] font-medium text-amber-900" style={{ left: pct(s), width: w(s, e) }}>
                        <span className="line-clamp-2">{k.kind === 'maintenance' ? '🔧 ' : ''}{k.title}</span>
                      </div>
                    );
                  })}
                  {lab.bookings.filter((b) => COLORS[b.status] || ['completed', 'returned_late', 'damaged'].includes(b.status)).map((b) => {
                    const cls = COLORS[b.status] || 'bg-slate-100 border-slate-300 text-slate-500';
                    const body = (
                      <>
                        <span className="block truncate font-semibold tabular">{fmtTime(b.start_time)}–{fmtTime(b.end_time)}</span>
                        <span className="block truncate">{b.redacted ? `${b.attendees} attendees` : b.user_name}</span>
                      </>
                    );
                    const style = { left: pct(b.start_time), width: w(b.start_time, b.end_time) };
                    return b.redacted ? (
                      <div key={b.id} className={clsx('absolute inset-y-1.5 overflow-hidden rounded-md border px-2 py-1 text-[11px]', cls)} style={style}>{body}</div>
                    ) : (
                      <Link key={b.id} to={`/bookings/${b.id}`} title={`${b.ref_code} · ${b.purpose || ''}`} className={clsx('absolute inset-y-1.5 overflow-hidden rounded-md border px-2 py-1 text-[11px] hover:shadow', cls)} style={style}>{body}</Link>
                    );
                  })}
                  {showNow && <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-red-500" style={{ left: pct(now.slice(11, 16)) }} aria-label="Current time" />}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
