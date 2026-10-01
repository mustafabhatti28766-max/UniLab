import { useState } from 'react';
import { Link } from 'react-router-dom';
import { History, Search } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAsync, useDebounced, useTitle } from '../lib/hooks';
import { Badge, Card, EmptyState, ErrorState, Input, PageHeader, Select, Skeleton } from '../components/ui';
import { ROLE_LABELS, fmtDateTime } from '../lib/format';

const LINKS = { booking: '/bookings/', lab: '/labs/', equipment: '/equipment/' };

function details(raw) {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    return Object.entries(obj)
      .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
      .join(' · ');
  } catch {
    return raw;
  }
}

export default function ActivityLog() {
  useTitle('Activity log');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const dq = useDebounced(q);
  const { data, error, loading, reload } = useAsync(() => api.get(`/activity${qs({ q: dq, entity_type: type, limit: 200 })}`), [dq, type]);

  return (
    <div>
      <PageHeader title="Activity log" subtitle="Audit trail of approvals, issues, returns, rule changes and administrative actions." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search actions, people or details" className="pl-9" aria-label="Search" />
        </div>
        <Select value={type} onChange={(e) => setType(e.target.value)} className="sm:w-48" aria-label="Entity type">
          <option value="">All entities</option>
          {['booking', 'equipment', 'lab', 'user', 'rules', 'department', 'category'].map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </div>
      <Card>
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <Skeleton className="m-4 h-64" />
        ) : data.length === 0 ? (
          <EmptyState icon={History} title="No activity found" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 px-5 py-2.5 sm:flex-row sm:items-center sm:gap-4">
                <span className="w-40 shrink-0 text-xs text-slate-500 tabular">{fmtDateTime(a.created_at)}</span>
                <div className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">{a.actor_name || 'System'}</span>
                  {a.actor_role && <span className="text-xs text-slate-400"> ({ROLE_LABELS[a.actor_role]})</span>}{' '}
                  <span className="text-slate-700">{a.action.replace(/_/g, ' ')}</span>{' '}
                  {LINKS[a.entity_type] && a.entity_id ? (
                    <Link to={`${LINKS[a.entity_type]}${a.entity_id}`} className="text-brand-700 hover:underline">{a.entity_type} #{a.entity_id}</Link>
                  ) : (
                    <Badge tone="slate">{a.entity_type}</Badge>
                  )}
                  {a.details && <p className="truncate text-xs text-slate-500">{details(a.details)}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
