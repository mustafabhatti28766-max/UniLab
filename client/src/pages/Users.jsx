import { useEffect, useState } from 'react';
import { Plus, Search, Pencil, ShieldOff, UserX, UserCheck } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAsync, useDebounced, useTitle } from '../lib/hooks';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Select, Skeleton, Toggle } from '../components/ui';
import { ROLE_LABELS, fmtDate, nowLocal, timeAgo } from '../lib/format';

function UserModal({ open, onClose, target, departments, roles, onSaved }) {
  const toast = useToast();
  const blank = { name: '', email: '', role: 'student', department_id: '', student_id: '', phone: '', password: '', is_active: true };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setError('');
      setForm(target ? { ...blank, ...target, department_id: target.department_id || '', student_id: target.student_id || '', phone: target.phone || '', password: '', is_active: !!target.is_active } : blank);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const payload = { ...form };
      if (target && !payload.password) delete payload.password;
      if (target) await api.put(`/users/${target.id}`, payload);
      else await api.post('/users', payload);
      toast.success(target ? 'User updated' : 'User created');
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={target ? `Edit ${target.name}` : 'Add user'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {error && <Alert tone="red" className="sm:col-span-2">{error}</Alert>}
        <Field label="Full name" required>{(id) => <Input id={id} value={form.name} onChange={set('name')} />}</Field>
        <Field label="Email" required>{(id) => <Input id={id} type="email" value={form.email} onChange={set('email')} />}</Field>
        <Field label="Role">
          {(id) => (
            <Select id={id} value={form.role} onChange={set('role')}>
              {roles.map((k) => <option key={k} value={k}>{ROLE_LABELS[k]}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Department">
          {(id) => (
            <Select id={id} value={form.department_id} onChange={set('department_id')}>
              <option value="">—</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="University ID">{(id) => <Input id={id} value={form.student_id} onChange={set('student_id')} />}</Field>
        <Field label="Phone">{(id) => <Input id={id} value={form.phone} onChange={set('phone')} />}</Field>
        <Field label={target ? 'Reset password' : 'Password'} hint={target ? 'Leave empty to keep the current password' : 'At least 8 characters'} className="sm:col-span-2">
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />}
        </Field>
        {target && <div className="sm:col-span-2"><Toggle checked={form.is_active} onChange={set('is_active')} label="Account active" description="Inactive users cannot sign in" /></div>}
      </div>
    </Modal>
  );
}

export default function Users() {
  useTitle('Users');
  const { user } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [dept, setDept] = useState('');
  const [modal, setModal] = useState(null);
  const dq = useDebounced(q);
  const departments = useAsync(() => api.get('/departments'), []);
  const { data, error, loading, reload } = useAsync(() => api.get(`/users${qs({ q: dq, role, department_id: dept })}`), [dq, role, dept]);
  const isAdmin = user.role === 'admin';
  const now = nowLocal();

  const clearRestriction = async (u) => {
    try {
      await api.post(`/users/${u.id}/clear-restriction`);
      toast.success(`Restriction lifted for ${u.name}`);
      reload(true);
    } catch (err) {
      toast.error(err);
    }
  };
  const toggleActive = async (u) => {
    try {
      await api.put(`/users/${u.id}`, { is_active: !u.is_active });
      toast.success(u.is_active ? 'User deactivated' : 'User reactivated');
      reload(true);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={isAdmin ? 'Manage accounts and roles. Permissions per role are set under Roles & permissions.' : `Manage students and faculty in ${user.department_name}.`}
        actions={<Button icon={Plus} onClick={() => setModal({})}>Add user</Button>}
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or ID" className="pl-9" aria-label="Search users" />
        </div>
        <Select value={role} onChange={(e) => setRole(e.target.value)} className="sm:w-44" aria-label="Role">
          <option value="">All roles</option>
          {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        {isAdmin && (
          <Select value={dept} onChange={(e) => setDept(e.target.value)} className="sm:w-56" aria-label="Department">
            <option value="">All departments</option>
            {(departments.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        )}
      </div>
      <Card className="overflow-x-auto">
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <Skeleton className="m-4 h-64" />
        ) : data.length === 0 ? (
          <EmptyState title="No users found" />
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-5 py-2.5 font-medium">User</th>
                <th className="px-3 py-2.5 font-medium">Role</th>
                <th className="px-3 py-2.5 font-medium">Department</th>
                <th className="px-3 py-2.5 font-medium">Bookings</th>
                <th className="px-3 py-2.5 font-medium">Standing</th>
                <th className="px-3 py-2.5 font-medium">Last login</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((u) => {
                const restricted = u.restricted_until && u.restricted_until > now;
                return (
                  <tr key={u.id} className={u.is_active ? '' : 'opacity-60'}>
                    <td className="px-5 py-2.5">
                      <p className="font-medium">{u.name}</p>
                      <p className="text-xs text-slate-500">{u.email}{u.student_id && ` · ${u.student_id}`}</p>
                    </td>
                    <td className="px-3 py-2.5"><Badge tone={u.role === 'admin' ? 'violet' : u.role === 'coordinator' ? 'indigo' : u.role === 'staff' ? 'blue' : 'slate'}>{ROLE_LABELS[u.role]}</Badge></td>
                    <td className="px-3 py-2.5 text-slate-600">{u.department_code || '—'}</td>
                    <td className="px-3 py-2.5 tabular">{u.booking_count} <span className="text-xs text-slate-400">({u.active_count} active)</span></td>
                    <td className="px-3 py-2.5">
                      {!u.is_active ? <Badge tone="slate">Inactive</Badge> : restricted ? <Badge tone="red">Restricted to {fmtDate(u.restricted_until)}</Badge> : u.late_return_count ? <Badge tone="amber">{u.late_return_count} late</Badge> : <Badge tone="emerald">Good</Badge>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">{u.last_login_at ? timeAgo(u.last_login_at) : 'Never'}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        {(restricted || u.late_return_count > 0) && <Button size="xs" variant="ghost" icon={ShieldOff} onClick={() => clearRestriction(u)} title="Clear restriction">Clear</Button>}
                        {(isAdmin || ['student', 'faculty'].includes(u.role)) && <Button size="xs" variant="ghost" icon={Pencil} onClick={() => setModal(u)} aria-label="Edit" />}
                        {(isAdmin || ['student', 'faculty'].includes(u.role)) && u.id !== user.id && <Button size="xs" variant="ghost" icon={u.is_active ? UserX : UserCheck} onClick={() => toggleActive(u)} aria-label={u.is_active ? 'Deactivate' : 'Activate'} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <UserModal
        open={!!modal}
        onClose={() => setModal(null)}
        target={modal?.id ? modal : null}
        departments={isAdmin ? departments.data || [] : (departments.data || []).filter((d) => d.id === user.department_id)}
        roles={isAdmin ? Object.keys(ROLE_LABELS) : ['student', 'faculty']}
        onSaved={() => reload(true)}
      />
    </div>
  );
}
