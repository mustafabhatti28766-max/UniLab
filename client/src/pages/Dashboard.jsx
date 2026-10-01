import { Link, useNavigate } from 'react-router-dom';
import {
  CalendarPlus, Sparkles, CalendarClock, Hourglass, PackageOpen, CheckCircle2, AlertTriangle, CheckSquare, PackageCheck,
  Activity, ShieldAlert, TrendingUp, Wrench, ArrowRight, Zap, CalendarDays,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { useAsync, useTitle } from '../lib/hooks';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Meter, Skeleton, StatCard, Alert } from '../components/ui';
import { BookingRow, PriorityBadge } from '../components/booking-ui';
import { fmtDateTime, fmtTime, describeBooking, nowLocal } from '../lib/format';

function Greeting({ user }) {
  const h = new Date().getHours();
  const part = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Good {part}, {user.name.split(' ').filter((p) => !/^(Dr|Prof)\.?$/.test(p))[0]}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          {user.department_name && <> · {user.department_name}</>}
        </p>
      </div>
      <div className="flex gap-2">
        <Link to="/finder">
          <Button variant="secondary" icon={Sparkles}>
            Smart finder
          </Button>
        </Link>
        <Link to="/book">
          <Button variant="cta" icon={CalendarPlus}>New booking</Button>
        </Link>
      </div>
    </div>
  );
}

function ManagerPanel({ data }) {
  const navigate = useNavigate();
  const m = data.manage;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Pending approvals" value={m.pending} icon={CheckSquare} tone="amber" hint={m.urgent ? `${m.urgent} urgent` : `${m.pending_coordinator || 0} need coordinator`} onClick={() => navigate('/approvals')} />
        <StatCard label="To issue today" value={m.to_issue_today} icon={PackageCheck} tone="blue" hint={`${m.today_total} bookings today`} onClick={() => navigate('/desk')} />
        <StatCard label="In use now" value={m.in_use} icon={Activity} tone="violet" onClick={() => navigate('/occupancy')} />
        <StatCard label="Overdue returns" value={m.overdue} icon={AlertTriangle} tone={m.overdue ? 'red' : 'slate'} hint={`${m.open_damage} open damage reports`} onClick={() => navigate('/desk')} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Approval queue"
            subtitle="Sorted by recommended priority"
            icon={CheckSquare}
            action={
              <Link to="/approvals" className="text-sm font-medium text-brand-700 hover:underline">
                Review all
              </Link>
            }
          />
          {data.queue.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No pending requests" description="New requests will appear here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.queue.map((b) => (
                <li key={b.id}>
                  <BookingRow b={b} showUser actions={<PriorityBadge level={b.priority} score={b.priority_score} />} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Today in your labs" icon={CalendarDays} action={<Link to="/schedule" className="text-sm font-medium text-brand-700 hover:underline">Schedule</Link>} />
            {data.today.length === 0 ? (
              <p className="px-5 py-6 text-sm text-slate-500">Nothing scheduled for the rest of today.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.today.map((b) => (
                  <li key={b.id}>
                    <Link to={`/bookings/${b.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50">
                      <span className="w-20 shrink-0 text-xs font-medium text-slate-500 tabular">
                        {fmtTime(b.start_time)}–{fmtTime(b.end_time)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{describeBooking(b)}</span>
                      <Badge tone={b.status === 'in_use' ? 'violet' : b.status === 'overdue' ? 'red' : 'indigo'}>{b.status.replace('_', ' ')}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {data.overdue.length > 0 && (
            <Card className="border-red-200">
              <CardHeader title="Overdue equipment" icon={AlertTriangle} />
              <ul className="divide-y divide-slate-100">
                {data.overdue.map((b) => (
                  <li key={b.id}>
                    <Link to={`/bookings/${b.id}`} className="block px-5 py-2.5 hover:bg-red-50/50">
                      <p className="truncate text-sm font-medium">{describeBooking(b)}</p>
                      <p className="text-xs text-red-600">
                        {b.user_name} · due {fmtDateTime(b.end_at)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Forecast() {
  const { data } = useAsync(() => api.get('/analytics/predictions'), []);
  const maint = useAsync(() => api.get('/maintenance/recommendations'), []);
  if (!data) return null;
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Predicted demand — next 7 days" subtitle="Trend of the last 8 weeks + confirmed bookings" icon={TrendingUp} action={<Link to="/analytics" className="text-sm font-medium text-brand-700 hover:underline">Analytics</Link>} />
        <ul className="divide-y divide-slate-100">
          {data.labs.slice(0, 5).map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-5 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm">{l.name}</span>
              <Meter value={l.predicted_utilization} className="w-24 sm:w-32" label={`${l.name} predicted utilization`} tone={l.demand === 'high' ? 'red' : l.demand === 'medium' ? 'amber' : 'blue'} />
              <span className="w-10 text-right text-sm font-medium tabular">{l.predicted_utilization}%</span>
              <Badge tone={l.demand === 'high' ? 'red' : l.demand === 'medium' ? 'amber' : 'slate'}>{l.demand}</Badge>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <CardHeader title="Maintenance recommendations" subtitle="Equipment frequently reported as faulty" icon={Wrench} action={<Link to="/maintenance" className="text-sm font-medium text-brand-700 hover:underline">Open</Link>} />
        <ul className="divide-y divide-slate-100">
          {(maint.data || []).slice(0, 4).map((m) => (
            <li key={m.id} className="px-5 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-medium">{m.name}</span>
                <Badge tone={m.level === 'critical' ? 'red' : m.level === 'high' ? 'orange' : 'amber'}>Risk {m.risk}</Badge>
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500">{m.action} · {m.reasons[0]}</p>
            </li>
          ))}
          {maint.data?.length === 0 && <li className="px-5 py-6 text-sm text-slate-500">No equipment needs attention.</li>}
        </ul>
      </Card>
    </div>
  );
}

export default function Dashboard() {
  useTitle('Dashboard');
  const { user, can } = useAuth();
  const isManager = can('bookings.view_all');
  const { data, error, loading, reload } = useAsync(() => api.get('/dashboard'), []);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  const restricted = user.restricted_until && user.restricted_until > nowLocal();

  return (
    <div>
      <Greeting user={user} />
      {restricted && (
        <Alert tone="red" icon={ShieldAlert} title="Your booking privileges are restricted" className="mb-6">
          Due to repeated late returns you cannot make new bookings until {fmtDateTime(user.restricted_until)}.
        </Alert>
      )}
      {loading || !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[84px]" />
          ))}
        </div>
      ) : (
        <>
          {isManager && <ManagerPanel data={data} />}
          {can('analytics.view') && can('maintenance.manage') && <Forecast />}

          <div className={isManager ? 'mt-8' : ''}>
            {isManager && <h2 className="mb-3 text-sm font-semibold text-slate-700">My own bookings</h2>}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Upcoming" value={data.mine.upcoming || 0} icon={CalendarClock} tone="indigo" />
              <StatCard label="Awaiting approval" value={data.mine.pending || 0} icon={Hourglass} tone="amber" hint={data.mine.drafts ? `${data.mine.drafts} draft(s)` : undefined} />
              <StatCard label="Items with me" value={data.mine.outstanding_items || 0} icon={PackageOpen} tone={data.outstanding.some((i) => i.booking_status === 'overdue') ? 'red' : 'violet'} />
              <StatCard label="Completed" value={data.mine.completed || 0} icon={CheckCircle2} tone="emerald" />
            </div>
            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader title="Upcoming & active bookings" icon={CalendarClock} action={<Link to="/bookings" className="text-sm font-medium text-brand-700 hover:underline">All bookings</Link>} />
                {data.upcoming.length === 0 ? (
                  <EmptyState
                    icon={CalendarPlus}
                    title="No upcoming bookings"
                    description="Find a lab or equipment and book it in under a minute."
                    action={
                      <Link to="/book">
                        <Button size="sm">Book now</Button>
                      </Link>
                    }
                  />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {data.upcoming.map((b) => (
                      <li key={b.id}>
                        <BookingRow b={b} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <div className="space-y-6">
                <Card>
                  <CardHeader title="Equipment with me" icon={PackageOpen} />
                  {data.outstanding.length === 0 ? (
                    <p className="px-5 py-6 text-sm text-slate-500">You have no borrowed equipment.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {data.outstanding.map((i) => (
                        <li key={i.id} className="px-5 py-2.5">
                          <p className="text-sm font-medium">
                            {i.quantity} × {i.equipment_name}
                          </p>
                          <p className={`text-xs ${i.booking_status === 'overdue' ? 'font-medium text-red-600' : 'text-slate-500'}`}>
                            {i.booking_status === 'overdue' ? 'Overdue — was due ' : 'Return by '}
                            {fmtDateTime(i.due_at)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card className="bg-gradient-to-br from-brand-700 to-brand-900 p-5 text-white">
                  <Zap className="size-5 text-brand-200" />
                  <p className="mt-2 font-semibold">Not sure which lab fits?</p>
                  <p className="mt-1 text-sm text-brand-100">Describe what you need and the Smart Finder ranks labs by equipment, capacity and purpose match.</p>
                  <Link to="/finder" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-white hover:underline">
                    Try the Smart Finder <ArrowRight className="size-4" />
                  </Link>
                </Card>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
