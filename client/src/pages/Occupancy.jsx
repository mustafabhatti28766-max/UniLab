import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Activity, Users, Clock, Wrench, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync, useInterval, useTitle } from '../lib/hooks';
import { Button, Card, ErrorState, PageHeader, Skeleton } from '../components/ui';
import { LiveBadge } from '../components/booking-ui';
import { LIVE_META, fmtTime } from '../lib/format';
import { DOT_TONES } from '../components/ui';

const RING = { available: 'ring-emerald-200', reserved: 'ring-indigo-200', in_use: 'ring-violet-300', maintenance: 'ring-amber-200', closed: 'ring-slate-200' };

export default function Occupancy() {
  useTitle('Live occupancy');
  const { data, error, loading, reload } = useAsync(() => api.get('/occupancy'), []);
  useInterval(() => reload(true), 30000);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  return (
    <div>
      <PageHeader
        title="Live lab occupancy"
        subtitle={data ? `Updated ${fmtTime(data.updated_at.slice(11, 16))} · refreshes every 30 seconds` : 'Loading…'}
        actions={<Button variant="secondary" icon={RefreshCw} onClick={() => reload()}>Refresh</Button>}
      />
      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-44" />)}</div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-6">
            <Card className="col-span-2 flex items-center gap-4 p-4">
              <span className="rounded-xl bg-violet-50 p-2.5 text-violet-700"><Users className="size-5" /></span>
              <div>
                <p className="text-xs text-slate-500">People in labs right now</p>
                <p className="text-2xl font-semibold">{data.totals.people} <span className="text-sm font-normal text-slate-500">/ {data.totals.seats} seats</span></p>
              </div>
            </Card>
            {Object.entries(LIVE_META).map(([k, m]) => (
              <Card key={k} className="flex items-center gap-2 p-4">
                <span className={clsx('size-2.5 rounded-full', DOT_TONES[m.tone])} aria-hidden />
                <span className="text-sm text-slate-600">{m.label}</span>
                <span className="ml-auto text-lg font-semibold tabular">{data.totals[k] || 0}</span>
              </Card>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.labs.map((l) => (
              <Link key={l.id} to={`/labs/${l.id}`} className={clsx('card block p-5 ring-2 ring-inset transition hover:shadow-md', RING[l.live_status])}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500">{l.code} · {l.department_code}</p>
                    <p className="truncate font-semibold">{l.name}</p>
                  </div>
                  <LiveBadge status={l.live_status} />
                </div>
                {l.live_status === 'in_use' && l.current_booking ? (
                  <div className="mt-4">
                    <div className="mb-1 flex justify-between text-xs text-slate-500">
                      <span>Occupancy</span>
                      <span className="font-medium text-slate-800 tabular">{l.current_booking.attendees}/{l.capacity} · {l.occupancy}%</span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-slate-100">
                      <div className="h-2.5 rounded-full bg-violet-500" style={{ width: `${l.occupancy}%` }} />
                    </div>
                    <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                      <Clock className="size-3" /> Until {fmtTime(l.current_booking.end_at.slice(11, 16))}
                      {l.current_booking.user_name && <> · {l.current_booking.user_name}</>}
                    </p>
                  </div>
                ) : l.live_status === 'reserved' && l.current_booking ? (
                  <p className="mt-4 text-sm text-indigo-700">Reserved {fmtTime(l.current_booking.start_at.slice(11, 16))}–{fmtTime(l.current_booking.end_at.slice(11, 16))} · awaiting check-in</p>
                ) : l.live_status === 'maintenance' ? (
                  <p className="mt-4 flex items-center gap-1 text-sm text-amber-700"><Wrench className="size-3.5" />{l.current_block?.title || 'Under maintenance'}</p>
                ) : l.live_status === 'closed' ? (
                  <p className="mt-4 text-sm text-slate-500">Closed now · opens {fmtTime(l.open_time)}</p>
                ) : (
                  <p className="mt-4 flex items-center gap-1 text-sm text-emerald-700"><Activity className="size-3.5" />Free now · {l.capacity} seats</p>
                )}
                <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-500">
                  {l.next_booking_at ? `Next booking at ${fmtTime(l.next_booking_at.slice(11, 16))}` : 'No more bookings today'}
                </p>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
