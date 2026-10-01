import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, ClipboardList, Download, Search } from 'lucide-react';
import { api, downloadFile, qs } from '../lib/api';
import { useAsync, useDebounced, useTitle } from '../lib/hooks';
import { useToast } from '../context/ToastContext';
import { Button, Card, EmptyState, ErrorState, Input, PageHeader, Select, Skeleton, Tabs } from '../components/ui';
import { BookingRow } from '../components/booking-ui';
import { STATUS_META } from '../lib/format';

const TABS = [
  { value: 'upcoming', label: 'Upcoming', query: { status: 'approved,reserved,in_use,overdue', when: 'upcoming', sort: 'asc' } },
  { value: 'pending', label: 'Pending', query: { status: 'pending', sort: 'asc' } },
  { value: 'drafts', label: 'Drafts', query: { status: 'draft' } },
  { value: 'past', label: 'History', query: { status: 'completed,returned_late,damaged,cancelled,rejected,overdue' } },
  { value: 'all', label: 'All', query: {} },
];

export default function MyBookings() {
  useTitle('My bookings');
  const toast = useToast();
  const [tab, setTab] = useState('upcoming');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState('');
  const dq = useDebounced(q);
  const query = TABS.find((t) => t.value === tab).query;
  // A specific booking status overrides the tab's status group.
  const effective = status ? { ...query, status, when: undefined } : query;
  const { data, error, loading, reload } = useAsync(() => api.get(`/bookings${qs({ ...effective, q: dq, limit: 25, offset: page * 25 })}`), [tab, dq, page, status]);

  return (
    <div>
      <PageHeader
        title="My bookings"
        subtitle="Track approval status, show your QR at the lab, and review your booking history."
        actions={
          <>
            <Button variant="secondary" icon={Download} onClick={() => downloadFile('/calendar/my.ics', 'unilab-bookings.ics').catch(toast.error)}>
              Export calendar
            </Button>
            <Link to="/book">
              <Button icon={CalendarPlus}>New booking</Button>
            </Link>
          </>
        }
      />
      <Tabs
        tabs={TABS}
        value={tab}
        onChange={(v) => {
          setTab(v);
          setPage(0);
        }}
      />
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search by reference, lab or purpose" className="pl-9" aria-label="Search bookings" />
        </div>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className="sm:w-56" aria-label="Booking status">
          <option value="">Any booking status</option>
          {Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </Select>
      </div>
      <Card className="mt-4">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : data.data.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No bookings here"
            description={tab === 'upcoming' ? 'Book a lab or equipment to see it here.' : undefined}
            action={tab === 'upcoming' && <Link to="/book"><Button size="sm">New booking</Button></Link>}
          />
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {data.data.map((b) => (
                <li key={b.id}>
                  <BookingRow b={b} />
                </li>
              ))}
            </ul>
            {data.total > 25 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
                <span>
                  {page * 25 + 1}–{Math.min(data.total, (page + 1) * 25)} of {data.total}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <Button size="sm" variant="secondary" disabled={(page + 1) * 25 >= data.total} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
