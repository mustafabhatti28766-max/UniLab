import clsx from 'clsx';
import { fmtTime, toMinutes, fromMinutes, STATUS_META } from '../lib/format';

const BLOCK_COLORS = {
  pending: 'bg-amber-100 border-amber-300 text-amber-900',
  approved: 'bg-blue-100 border-blue-300 text-blue-900',
  reserved: 'bg-indigo-100 border-indigo-300 text-indigo-900',
  in_use: 'bg-violet-100 border-violet-300 text-violet-900',
  overdue: 'bg-red-100 border-red-300 text-red-900',
  completed: 'bg-slate-100 border-slate-300 text-slate-600',
  returned_late: 'bg-slate-100 border-slate-300 text-slate-600',
  damaged: 'bg-slate-100 border-slate-300 text-slate-600',
};

/**
 * One resource's day as a horizontal bar: bookings, blocks and (optionally) the
 * requested slot. Used on the booking form and lab pages.
 */
export function DayTimeline({ open = '08:00', close = '20:00', bookings = [], blocks = [], selection, onPick, compact = false }) {
  const start = Math.floor(toMinutes(open) / 60) * 60;
  const end = Math.ceil(toMinutes(close) / 60) * 60;
  const span = end - start;
  const pos = (t) => `${((toMinutes(t) - start) / span) * 100}%`;
  const width = (a, b) => `${((toMinutes(b) - toMinutes(a)) / span) * 100}%`;
  const hours = [];
  for (let m = start; m <= end; m += 60) hours.push(m);
  const clampTime = (t, date) => (t.slice(0, 10) < date ? open : t.slice(0, 10) > date ? close : t.slice(11, 16));

  return (
    <div className="select-none">
      <div className={clsx('relative w-full overflow-hidden rounded-lg border border-slate-200 bg-white', compact ? 'h-9' : 'h-12')}>
        {hours.slice(1, -1).map((m) => (
          <span key={`g${m}`} className="pointer-events-none absolute inset-y-0 w-px bg-slate-100" style={{ left: pos(fromMinutes(m)) }} aria-hidden />
        ))}
        {onPick &&
          hours.slice(0, -1).map((m) => (
            <button
              key={m}
              type="button"
              className="absolute inset-y-0 hover:bg-brand-50"
              style={{ left: pos(fromMinutes(m)), width: width(fromMinutes(m), fromMinutes(m + 60)) }}
              onClick={() => onPick(fromMinutes(m))}
              aria-label={`Pick ${fmtTime(fromMinutes(m))}`}
            />
          ))}
        {blocks.map((k) => {
          const date = (k.start_at || '').slice(0, 10);
          const s = clampTime(k.start_at, date);
          const e = k.end_at.slice(0, 10) > date ? close : k.end_at.slice(11, 16);
          return (
            <div
              key={`k${k.id}`}
              title={`${k.kind === 'maintenance' ? 'Maintenance' : 'Blocked'}: ${k.title} (${fmtTime(s)}–${fmtTime(e)})`}
              className="pointer-events-none absolute inset-y-1 overflow-hidden rounded-md border border-amber-300 bg-[repeating-linear-gradient(135deg,#fef3c7,#fef3c7_6px,#fde68a_6px,#fde68a_12px)] px-1.5 text-[10px] font-medium leading-tight text-amber-900"
              style={{ left: pos(s), width: width(s, e) }}
            >
              {!compact && <span className="line-clamp-2 pt-0.5">{k.title}</span>}
            </div>
          );
        })}
        {bookings.map((b) => (
          <div
            key={b.id}
            title={`${STATUS_META[b.status]?.label || b.status}: ${fmtTime(b.start_time)}–${fmtTime(b.end_time)}${b.user_name ? ` · ${b.user_name}` : ''}`}
            className={clsx('pointer-events-none absolute inset-y-1 overflow-hidden rounded-md border px-1.5 text-[10px] font-medium leading-tight', BLOCK_COLORS[b.status] || BLOCK_COLORS.approved)}
            style={{ left: pos(b.start_time), width: width(b.start_time, b.end_time) }}
          >
            {!compact && (
              <span className="block truncate pt-0.5">
                {fmtTime(b.start_time)}–{fmtTime(b.end_time)}
              </span>
            )}
          </div>
        ))}
        {selection && toMinutes(selection.end) > toMinutes(selection.start) && (
          <div
            className={clsx('pointer-events-none absolute -inset-y-0.5 rounded-md border-2', selection.ok === false ? 'border-red-500 bg-red-500/10' : 'border-brand-600 bg-brand-600/10')}
            style={{ left: pos(selection.start), width: width(selection.start, selection.end) }}
            aria-label="Requested slot"
          />
        )}
      </div>
      <div className="relative mt-1 h-4 text-[10px] text-slate-400 tabular">
        {hours.map((m, i) =>
          i % (compact ? 3 : 2) === 0 ? (
            <span key={m} className="absolute -translate-x-1/2" style={{ left: pos(fromMinutes(m)) }}>
              {fmtTime(fromMinutes(m)).replace(':00', '')}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

export function TimelineLegend() {
  const items = [
    ['Pending', 'bg-amber-100 border-amber-300'],
    ['Approved / reserved', 'bg-indigo-100 border-indigo-300'],
    ['In use', 'bg-violet-100 border-violet-300'],
    ['Maintenance / blocked', 'bg-[repeating-linear-gradient(135deg,#fef3c7,#fef3c7_3px,#fde68a_3px,#fde68a_6px)] border-amber-300'],
    ['Your request', 'border-2 border-brand-600 bg-brand-600/10'],
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
      {items.map(([label, cls]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className={clsx('inline-block h-3 w-4 rounded border', cls)} aria-hidden />
          {label}
        </span>
      ))}
    </div>
  );
}
