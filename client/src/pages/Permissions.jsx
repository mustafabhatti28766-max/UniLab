import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { KeyRound, RotateCcw, Save, Lock, Check } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync, useTitle } from '../lib/hooks';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Alert, Button, Card, ErrorState, PageHeader, Skeleton } from '../components/ui';
import { ROLE_LABELS } from '../lib/format';

export default function Permissions() {
  useTitle('Roles & permissions');
  const toast = useToast();
  const { refresh } = useAuth();
  const { data, error, loading, reload, setData } = useAsync(() => api.get('/permissions'), []);
  const [matrix, setMatrix] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setMatrix(Object.fromEntries(data.roles.map((r) => [r.role, new Set(r.permissions)])));
  }, [data]);

  const dirty = useMemo(() => {
    if (!data) return false;
    return data.roles.some((r) => {
      const now = matrix[r.role];
      return now && (now.size !== r.permissions.length || r.permissions.some((p) => !now.has(p)));
    });
  }, [data, matrix]);

  const toggle = (role, perm) =>
    setMatrix((m) => {
      const next = new Set(m[role]);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return { ...m, [role]: next };
    });

  const save = async () => {
    setBusy(true);
    try {
      const payload = Object.fromEntries(Object.entries(matrix).filter(([r]) => r !== 'admin').map(([r, s]) => [r, [...s]]));
      setData(await api.put('/permissions', { matrix: payload }));
      await refresh();
      toast.success('Permissions saved — they apply immediately');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    if (!window.confirm('Reset every role to the default permissions?')) return;
    try {
      setData(await api.post('/permissions/reset'));
      await refresh();
      toast.success('Default permissions restored');
    } catch (err) {
      toast.error(err);
    }
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  const groups = data ? [...new Set(data.permissions.map((p) => p.group))] : [];

  return (
    <div>
      <PageHeader
        title="Roles & permissions"
        subtitle="Control what each role can do. Changes are enforced by the server on every request."
        actions={
          <>
            <Button variant="secondary" icon={RotateCcw} onClick={reset}>Reset to defaults</Button>
            <Button icon={Save} onClick={save} loading={busy} disabled={!dirty}>Save changes</Button>
          </>
        }
      />
      <Alert tone="blue" icon={KeyRound} className="mb-4">
        Staff, coordinators and administrators manage resources only inside their own department (administrators: all departments). The Administrator role always keeps every permission.
      </Alert>
      {loading || !data ? (
        <Skeleton className="h-96" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-5 py-3 text-left font-medium">Permission</th>
                {data.roles.map((r) => (
                  <th key={r.role} className="w-28 px-2 py-3 text-center font-medium">
                    <span className="inline-flex items-center gap-1">
                      {ROLE_LABELS[r.role]}
                      {r.locked && <Lock className="size-3" aria-label="Locked" />}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g} className="divide-y divide-slate-100">
                <tr className="bg-slate-50/60">
                  <td colSpan={data.roles.length + 1} className="px-5 py-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{g}</td>
                </tr>
                {data.permissions.filter((p) => p.group === g).map((p) => (
                  <tr key={p.key} className="hover:bg-slate-50/50">
                    <td className="px-5 py-2.5">
                      <p className="font-medium text-slate-800">{p.label}</p>
                      <p className="font-mono text-[11px] text-slate-400">{p.key}</p>
                    </td>
                    {data.roles.map((r) => {
                      const on = matrix[r.role]?.has(p.key);
                      const locked = r.locked || p.adminOnly;
                      const isDefault = data.defaults[r.role]?.includes(p.key);
                      return (
                        <td key={r.role} className="px-2 py-2.5 text-center">
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={!!on}
                            aria-label={`${p.label} for ${ROLE_LABELS[r.role]}`}
                            disabled={locked}
                            onClick={() => toggle(r.role, p.key)}
                            title={locked ? 'Fixed' : isDefault ? 'Granted by default' : 'Not granted by default'}
                            className={clsx(
                              'inline-flex size-6 items-center justify-center rounded-md border transition-colors',
                              on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-transparent hover:border-brand-400',
                              locked && 'cursor-not-allowed opacity-60',
                            )}
                          >
                            <Check className="size-4" />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </Card>
      )}
    </div>
  );
}
