import { useState } from 'react';
import { Building2, Tags, Plus, Pencil, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync, useTitle } from '../lib/hooks';
import { useToast } from '../context/ToastContext';
import { Button, Card, CardHeader, ErrorState, Field, Input, Modal, PageHeader, Skeleton, Textarea } from '../components/ui';

function EditModal({ open, onClose, kind, item, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setForm(item || { code: '', name: '', description: '' });
  }
  const path = kind === 'department' ? '/departments' : '/categories';
  const save = async () => {
    setBusy(true);
    try {
      if (item?.id) await api.put(`${path}/${item.id}`, form);
      else await api.post(path, form);
      toast.success('Saved');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title={`${item?.id ? 'Edit' : 'Add'} ${kind}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="space-y-4">
        {kind === 'department' && <Field label="Code" required>{(id) => <Input id={id} value={form.code || ''} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="CSE" />}</Field>}
        <Field label="Name" required>{(id) => <Input id={id} value={form.name || ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />}</Field>
        <Field label="Description">{(id) => <Textarea id={id} value={form.description || ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />}</Field>
      </div>
    </Modal>
  );
}

export default function Catalog() {
  useTitle('Departments & categories');
  const toast = useToast();
  const depts = useAsync(() => api.get('/departments'), []);
  const cats = useAsync(() => api.get('/categories'), []);
  const [modal, setModal] = useState(null);

  const remove = async (kind, item) => {
    if (!window.confirm(`Delete ${item.name}?`)) return;
    try {
      await api.del(`/${kind === 'department' ? 'departments' : 'categories'}/${item.id}`);
      toast.success('Deleted');
      (kind === 'department' ? depts : cats).reload(true);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div>
      <PageHeader title="Departments & equipment categories" subtitle="Organisation structure used for permissions, rules and analytics." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Departments" icon={Building2} action={<Button size="xs" variant="soft" icon={Plus} onClick={() => setModal({ kind: 'department' })}>Add</Button>} />
          {depts.error ? <ErrorState error={depts.error} onRetry={depts.reload} /> : !depts.data ? <Skeleton className="m-4 h-40" /> : (
            <ul className="divide-y divide-slate-100">
              {depts.data.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="w-12 font-mono text-xs font-semibold text-slate-500">{d.code}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{d.name}</p>
                    <p className="text-xs text-slate-500">{d.lab_count} labs · {d.equipment_count} equipment types · {d.user_count} users</p>
                  </div>
                  <Button size="xs" variant="ghost" icon={Pencil} onClick={() => setModal({ kind: 'department', item: d })} aria-label="Edit" />
                  <Button size="xs" variant="ghost" icon={Trash2} onClick={() => remove('department', d)} aria-label="Delete" />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Equipment categories" icon={Tags} action={<Button size="xs" variant="soft" icon={Plus} onClick={() => setModal({ kind: 'category' })}>Add</Button>} />
          {cats.error ? <ErrorState error={cats.error} onRetry={cats.reload} /> : !cats.data ? <Skeleton className="m-4 h-40" /> : (
            <ul className="divide-y divide-slate-100">
              {cats.data.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.equipment_count} equipment types</p>
                  </div>
                  <Button size="xs" variant="ghost" icon={Pencil} onClick={() => setModal({ kind: 'category', item: c })} aria-label="Edit" />
                  <Button size="xs" variant="ghost" icon={Trash2} onClick={() => remove('category', c)} aria-label="Delete" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <EditModal open={!!modal} kind={modal?.kind} item={modal?.item} onClose={() => setModal(null)} onSaved={() => (modal?.kind === 'department' ? depts : cats).reload(true)} />
    </div>
  );
}
