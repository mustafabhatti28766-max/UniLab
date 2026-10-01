import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { Alert, Button, Field, Input, Modal, Select, Textarea, Toggle } from './ui';
import { addDays, describeBooking, fmtRange, todayStr } from '../lib/format';

/** Temporarily block a resource or schedule maintenance (with affected-booking preview). */
export function BlockModal({ open, onClose, resourceType: fixedType, resourceId: fixedId, resourceName, onSaved }) {
  const toast = useToast();
  const [resources, setResources] = useState({ labs: [], equipment: [] });
  const [form, setForm] = useState({});
  const [affected, setAffected] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const d = addDays(todayStr(), 1);
    setForm({ resource_type: fixedType || 'lab', resource_id: fixedId || '', kind: 'maintenance', title: '', reason: '', start_at: `${d}T09:00`, end_at: `${d}T13:00`, quantity: '', cancel_affected: false });
    setAffected(null);
    if (!fixedId) Promise.all([api.get('/labs'), api.get('/equipment')]).then(([labs, equipment]) => setResources({ labs, equipment })).catch(() => {});
  }, [open, fixedType, fixedId]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  useEffect(() => {
    if (!open || !form.resource_id || !form.start_at || !form.end_at || form.end_at <= form.start_at) return setAffected(null);
    const t = setTimeout(() => {
      api.post('/blocks', { ...form, title: form.title || 'preview', preview: true }).then((r) => setAffected(r.affected)).catch(() => setAffected(null));
    }, 300);
    return () => clearTimeout(t);
  }, [open, form.resource_type, form.resource_id, form.start_at, form.end_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.post('/blocks', form);
      toast.success(`${form.kind === 'maintenance' ? 'Maintenance scheduled' : 'Resource blocked'}${r.affected ? ` — ${r.affected} booking(s) ${form.cancel_affected ? 'cancelled' : 'notified'}` : ''}`);
      onSaved?.(r.block);
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const list = form.resource_type === 'lab' ? resources.labs : resources.equipment;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={resourceName ? `Block or schedule maintenance — ${resourceName}` : 'Block a resource / schedule maintenance'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={busy} disabled={!form.resource_id || !form.title?.trim() || form.end_at <= form.start_at}>Save</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {!fixedId && (
          <>
            <Field label="Resource type">
              {(id) => (
                <Select id={id} value={form.resource_type} onChange={(e) => setForm((f) => ({ ...f, resource_type: e.target.value, resource_id: '' }))}>
                  <option value="lab">Lab</option>
                  <option value="equipment">Equipment</option>
                </Select>
              )}
            </Field>
            <Field label="Resource">
              {(id) => (
                <Select id={id} value={form.resource_id} onChange={set('resource_id')}>
                  <option value="">Select…</option>
                  {list.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.code})</option>)}
                </Select>
              )}
            </Field>
          </>
        )}
        <Field label="Type">
          {(id) => (
            <Select id={id} value={form.kind} onChange={set('kind')}>
              <option value="maintenance">Maintenance</option>
              <option value="block">Temporary block (event, exam, reserved)</option>
            </Select>
          )}
        </Field>
        <Field label="Title" required>{(id) => <Input id={id} value={form.title || ''} onChange={set('title')} placeholder="e.g. Annual calibration" />}</Field>
        <Field label="Starts">{(id) => <Input id={id} type="datetime-local" value={form.start_at || ''} onChange={set('start_at')} />}</Field>
        <Field label="Ends">{(id) => <Input id={id} type="datetime-local" value={form.end_at || ''} onChange={set('end_at')} />}</Field>
        {form.resource_type === 'equipment' && (
          <Field label="Units affected" hint="Leave empty to block all units">{(id) => <Input id={id} type="number" min={1} value={form.quantity} onChange={set('quantity')} />}</Field>
        )}
        <Field label="Reason / notes" className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} value={form.reason || ''} onChange={set('reason')} />}</Field>
        {affected && affected.length > 0 && (
          <div className="space-y-3 sm:col-span-2">
            <Alert tone="amber" title={`${affected.length} booking(s) overlap this window`}>
              <ul className="mt-1 space-y-0.5 text-xs">
                {affected.slice(0, 6).map((b) => (
                  <li key={b.id}>
                    {b.ref_code} · {b.user_name} · {describeBooking(b)} · {fmtRange(b)} ({b.status})
                  </li>
                ))}
              </ul>
            </Alert>
            <Toggle checked={form.cancel_affected} onChange={set('cancel_affected')} label="Cancel these bookings" description="Otherwise the users are notified that their booking is at risk" />
          </div>
        )}
        {affected && affected.length === 0 && <p className="text-sm text-emerald-700 sm:col-span-2">No existing bookings are affected.</p>}
      </div>
    </Modal>
  );
}
