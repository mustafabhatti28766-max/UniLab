import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Scale, RotateCcw, Save } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync, useTitle } from '../lib/hooks';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Alert, Badge, Button, Card, CardHeader, ErrorState, Input, PageHeader, Select, Skeleton, Toggle } from '../components/ui';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Rules() {
  useTitle('Booking rules');
  const { user } = useAuth();
  const toast = useToast();
  const [dept, setDept] = useState(user.role === 'admin' ? 0 : user.department_id);
  const departments = useAsync(() => api.get('/departments'), []);
  const { data, error, loading, reload } = useAsync(() => api.get(`/rules?department_id=${dept}`), [dept]);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setValues(Object.fromEntries(data.rules.map((r) => [r.key, r.value])));
  }, [data]);

  const changed = data ? data.rules.filter((r) => String(values[r.key]) !== String(r.value)) : [];
  const save = async () => {
    setBusy(true);
    try {
      await api.put('/rules', { department_id: dept, values: Object.fromEntries(changed.map((r) => [r.key, values[r.key]])) });
      toast.success('Rules saved — they apply to new requests immediately');
      reload(true);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const resetOverride = async (key) => {
    try {
      await api.put('/rules', { department_id: dept, values: { [key]: null } });
      toast.success('Override removed — global value applies');
      reload(true);
    } catch (err) {
      toast.error(err);
    }
  };

  const groups = data ? [...new Set(data.rules.map((r) => r.group))] : [];
  return (
    <div>
      <PageHeader
        title="Booking rules"
        subtitle="Limits, approval requirements, penalties and priority weights. Department rules override the university-wide defaults."
        actions={
          <>
            <Select value={dept} onChange={(e) => setDept(Number(e.target.value))} disabled={user.role !== 'admin'} className="w-auto" aria-label="Scope">
              {user.role === 'admin' && <option value={0}>University-wide (global)</option>}
              {(departments.data || []).filter((d) => user.role === 'admin' || d.id === user.department_id).map((d) => (
                <option key={d.id} value={d.id}>{d.name} overrides</option>
              ))}
            </Select>
            <Button icon={Save} onClick={save} loading={busy} disabled={!changed.length}>Save {changed.length ? `(${changed.length})` : ''}</Button>
          </>
        }
      />
      {dept !== 0 && <Alert tone="blue" className="mb-4" icon={Scale}>Editing department overrides. Values marked “inherited” follow the global setting until you change them.</Alert>}
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading || !data ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <Card key={g}>
              <CardHeader title={g} />
              <ul className="divide-y divide-slate-100">
                {data.rules.filter((r) => r.group === g).map((r) => {
                  const dirty = String(values[r.key]) !== String(r.value);
                  return (
                    <li key={r.key} className={clsx('flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center', dirty && 'bg-amber-50/50')}>
                      <div className="min-w-0 flex-1">
                        {r.type === 'boolean' ? (
                          <Toggle checked={!!values[r.key]} onChange={(v) => setValues((s) => ({ ...s, [r.key]: v }))} label={r.label} />
                        ) : (
                          <p className="text-sm font-medium text-slate-800">{r.label}</p>
                        )}
                        {dept !== 0 && (
                          <p className="mt-0.5 text-xs text-slate-500">
                            {r.overridden ? <Badge tone="indigo">Department override</Badge> : <span>Inherited from global</span>}
                            {r.overridden && <span className="ml-2">Global: {String(r.global_value)}</span>}
                          </p>
                        )}
                      </div>
                      {r.type === 'number' && (
                        <div className="flex items-center gap-2">
                          <Input type="number" min={r.min} max={r.max} step={r.unit === 'hours' ? 0.5 : 1} value={values[r.key] ?? ''} onChange={(e) => setValues((s) => ({ ...s, [r.key]: e.target.value }))} className="w-24 text-right" aria-label={r.label} />
                          <span className="w-16 text-xs text-slate-500">{r.unit}</span>
                        </div>
                      )}
                      {r.type === 'weekdays' && (
                        <div className="flex gap-1" role="group" aria-label={r.label}>
                          {DAYS.map((d, i) => {
                            const list = String(values[r.key] ?? '').split(',').filter(Boolean);
                            const on = list.includes(String(i));
                            return (
                              <button
                                key={d}
                                type="button"
                                aria-pressed={on}
                                onClick={() => setValues((s) => ({ ...s, [r.key]: (on ? list.filter((x) => x !== String(i)) : [...list, String(i)]).sort().join(',') }))}
                                className={clsx('rounded-md px-2 py-1 text-xs font-medium', on ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}
                              >
                                {d}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {dept !== 0 && r.overridden && (
                        <Button size="xs" variant="ghost" icon={RotateCcw} onClick={() => resetOverride(r.key)}>Use global</Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
