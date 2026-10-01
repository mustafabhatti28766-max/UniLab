import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Check, X, Clock, Package, FlaskConical, ChevronRight, Zap, AlertTriangle } from 'lucide-react';
import { Badge } from './ui';
import { LIVE_META, MAINT_META, STATUS_META, fmtRange, describeBooking } from '../lib/format';

export function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, tone: 'slate' };
  return (
    <Badge tone={m.tone} dot>
      {m.label}
    </Badge>
  );
}

export function LiveBadge({ status }) {
  const m = LIVE_META[status] || { label: status, tone: 'slate' };
  return (
    <Badge tone={m.tone} dot>
      {m.label}
    </Badge>
  );
}

export function MaintBadge({ status }) {
  const m = MAINT_META[status] || { label: status, tone: 'slate' };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function PriorityBadge({ level, score }) {
  const tone = level === 'urgent' ? 'red' : level === 'high' ? 'orange' : 'slate';
  return (
    <Badge tone={tone}>
      {level === 'urgent' && <Zap className="size-3" aria-hidden />}
      {level === 'urgent' ? 'Urgent' : level === 'high' ? 'High' : 'Normal'}
      {score !== undefined && <span className="tabular opacity-70">· {score}</span>}
    </Badge>
  );
}

const FLOW = ['draft', 'pending', 'approved', 'reserved', 'in_use', 'completed'];
const TERMINAL_BAD = { rejected: 'Rejected', cancelled: 'Cancelled' };

/** Draft → Pending → Approved → Reserved → In Use → Completed, with side exits. */
export function StatusStepper({ status, events = [] }) {
  const reached = new Set(events.map((e) => e.to_status).filter(Boolean));
  reached.add('draft');
  let current = status;
  if (['overdue'].includes(status)) current = 'in_use';
  if (['returned_late', 'damaged'].includes(status)) current = 'completed';
  const idx = FLOW.indexOf(current);
  const stoppedAt = TERMINAL_BAD[status] ? Math.max(...FLOW.map((s, i) => (reached.has(s) ? i : 0))) : null;

  return (
    <ol className="flex items-center gap-0 overflow-x-auto pb-1 scroll-thin" aria-label="Booking progress">
      {FLOW.map((step, i) => {
        const done = stoppedAt !== null ? i <= stoppedAt : i < idx || (i === idx && status === 'completed');
        const active = stoppedAt === null && i === idx && status !== 'completed';
        const failedHere = stoppedAt !== null && i === stoppedAt + 1;
        return (
          <li key={step} className="flex shrink-0 items-center">
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={clsx(
                  'flex size-7 items-center justify-center rounded-full border-2 text-xs font-semibold',
                  done && 'border-brand-600 bg-brand-600 text-white',
                  active && (status === 'overdue' ? 'border-red-500 bg-red-50 text-red-600' : 'border-brand-600 bg-white text-brand-700'),
                  failedHere && 'border-rose-500 bg-rose-50 text-rose-600',
                  !done && !active && !failedHere && 'border-slate-200 bg-white text-slate-400',
                )}
              >
                {done ? <Check className="size-3.5" /> : failedHere ? <X className="size-3.5" /> : i + 1}
              </span>
              <span className={clsx('text-[11px] font-medium whitespace-nowrap', done || active ? 'text-slate-800' : failedHere ? 'text-rose-600' : 'text-slate-400')}>
                {failedHere ? TERMINAL_BAD[status] : active && status === 'overdue' ? 'Overdue' : STATUS_META[step].label.replace(' approval', '')}
              </span>
            </div>
            {i < FLOW.length - 1 && <span className={clsx('mx-1 mb-5 h-0.5 w-6 sm:w-10', done && (stoppedAt === null || i < stoppedAt) ? 'bg-brand-600' : 'bg-slate-200')} />}
          </li>
        );
      })}
    </ol>
  );
}

/** Compact booking row used in lists. */
export function BookingRow({ b, showUser = false, actions, to }) {
  const Icon = b.lab_id ? FlaskConical : Package;
  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
      <Link to={to || `/bookings/${b.id}`} className="flex min-w-0 flex-1 items-start gap-3 rounded-lg hover:opacity-90">
        <span className={clsx('mt-0.5 rounded-lg p-2', b.lab_id ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-700')}>
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">{describeBooking(b)}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" aria-hidden />
              {fmtRange(b)}
            </span>
            {b.ref_code && <span className="font-mono">{b.ref_code}</span>}
            {showUser && b.user_name && (
              <span>
                {b.user_name}
                {b.user_role && <span className="text-slate-400"> · {b.user_role}</span>}
              </span>
            )}
          </p>
        </div>
      </Link>
      <div className="flex shrink-0 items-center gap-2 pl-11 sm:pl-0">
        <StatusBadge status={b.status} />
        {actions}
        {!actions && <ChevronRight className="hidden size-4 text-slate-300 sm:block" aria-hidden />}
      </div>
    </div>
  );
}

export function ProblemList({ problems }) {
  if (!problems?.length) return null;
  return (
    <ul className="space-y-1">
      {problems.map((p, i) => (
        <li key={i} className="flex gap-2 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>{p.message || p}</span>
        </li>
      ))}
    </ul>
  );
}
