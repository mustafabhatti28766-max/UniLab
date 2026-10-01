import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { Alert, Button, Field, Input, Modal, Select, Textarea, Toggle } from './ui';
import { TIME_OPTIONS, fmtTime } from '../lib/format';

function useCatalog() {
  const [cat, setCat] = useState({ departments: [], categories: [], labs: [] });
  useEffect(() => {
    Promise.all([api.get('/departments'), api.get('/categories'), api.get('/labs')])
      .then(([departments, categories, labs]) => setCat({ departments, categories, labs }))
      .catch(() => {});
  }, []);
  return cat;
}

const APPROVAL_HELP = {
  none: 'Booked instantly (students still need approval if the global rule requires it)',
  staff: 'Lab staff approve student requests; faculty may be auto-approved',
  coordinator: 'Always reviewed by the department coordinator',
};

export function LabFormModal({ open, onClose, lab, onSaved }) {
  const { user } = useAuth();
  const toast = useToast();
  const { departments } = useCatalog();
  const blank = { code: '', name: '', department_id: user.role === 'admin' ? '' : user.department_id, capacity: 30, location: '', facilities: '', description: '', open_time: '08:00', close_time: '20:00', approval_level: 'staff', restricted_to_department: false, status: 'available' };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setError('');
      setForm(lab ? { ...blank, ...lab, facilities: (lab.facilities || []).join(', '), restricted_to_department: !!lab.restricted_to_department } : blank);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lab]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const payload = { ...form, facilities: form.facilities.split(',').map((s) => s.trim()).filter(Boolean) };
      const saved = lab ? await api.put(`/labs/${lab.id}`, payload) : await api.post('/labs', payload);
      toast.success(lab ? 'Lab updated' : 'Lab created');
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={lab ? `Edit ${lab.name}` : 'Add a lab'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={busy}>{lab ? 'Save changes' : 'Create lab'}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {error && <Alert tone="red" className="sm:col-span-2">{error}</Alert>}
        <Field label="Lab ID / code" required>{(id) => <Input id={id} value={form.code} onChange={set('code')} placeholder="CSE-L4" />}</Field>
        <Field label="Name" required>{(id) => <Input id={id} value={form.name} onChange={set('name')} />}</Field>
        <Field label="Department" required>
          {(id) => (
            <Select id={id} value={form.department_id || ''} onChange={set('department_id')} disabled={user.role !== 'admin'}>
              <option value="">Select…</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Capacity (seats)" required>{(id) => <Input id={id} type="number" min={1} value={form.capacity} onChange={set('capacity')} />}</Field>
        <Field label="Location" className="sm:col-span-2">{(id) => <Input id={id} value={form.location || ''} onChange={set('location')} placeholder="Block A, Room 301" />}</Field>
        <Field label="Facilities" hint="Comma-separated" className="sm:col-span-2">{(id) => <Input id={id} value={form.facilities} onChange={set('facilities')} placeholder="Projector, 30 workstations, Air conditioning" />}</Field>
        <Field label="Description" className="sm:col-span-2">{(id) => <Textarea id={id} value={form.description || ''} onChange={set('description')} />}</Field>
        <Field label="Opens">{(id) => <Select id={id} value={form.open_time} onChange={set('open_time')}>{TIME_OPTIONS.map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}</Select>}</Field>
        <Field label="Closes">{(id) => <Select id={id} value={form.close_time} onChange={set('close_time')}>{TIME_OPTIONS.map((t) => <option key={t} value={t}>{fmtTime(t)}</option>)}</Select>}</Field>
        <Field label="Approval required" hint={APPROVAL_HELP[form.approval_level]}>
          {(id) => (
            <Select id={id} value={form.approval_level} onChange={set('approval_level')}>
              <option value="none">No approval</option>
              <option value="staff">Lab staff</option>
              <option value="coordinator">Coordinator</option>
            </Select>
          )}
        </Field>
        <Field label="Status">
          {(id) => (
            <Select id={id} value={form.status} onChange={set('status')}>
              <option value="available">Available</option>
              <option value="maintenance">Maintenance</option>
              <option value="closed">Closed</option>
            </Select>
          )}
        </Field>
        <div className="sm:col-span-2">
          <Toggle checked={form.restricted_to_department} onChange={set('restricted_to_department')} label="Department-only access" description="Only students of this department can book it" />
        </div>
      </div>
    </Modal>
  );
}

export function EquipmentFormModal({ open, onClose, equipment, onSaved, defaultLabId }) {
  const toast = useToast();
  const { categories, labs } = useCatalog();
  const { user } = useAuth();
  const blank = { code: '', name: '', category_id: '', lab_id: defaultLabId || '', total_quantity: 1, condition: 'good', maintenance_status: 'operational', approval_level: 'staff', max_per_booking: '', description: '', restricted_to_department: false };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const myLabs = user.role === 'admin' ? labs : labs.filter((l) => l.department_id === user.department_id);

  useEffect(() => {
    if (open) {
      setError('');
      setForm(equipment ? { ...blank, ...equipment, max_per_booking: equipment.max_per_booking || '', restricted_to_department: !!equipment.restricted_to_department } : blank);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, equipment]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const fields = ['code', 'name', 'category_id', 'lab_id', 'total_quantity', 'condition', 'maintenance_status', 'approval_level', 'max_per_booking', 'description', 'restricted_to_department'];
      const payload = Object.fromEntries(fields.map((k) => [k, form[k]]));
      const saved = equipment ? await api.put(`/equipment/${equipment.id}`, payload) : await api.post('/equipment', payload);
      toast.success(equipment ? 'Equipment updated' : 'Equipment added');
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={equipment ? `Edit ${equipment.name}` : 'Add equipment'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={busy}>{equipment ? 'Save changes' : 'Add equipment'}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {error && <Alert tone="red" className="sm:col-span-2">{error}</Alert>}
        <Field label="Equipment ID / code" required hint="Printed on the QR label">{(id) => <Input id={id} value={form.code} onChange={set('code')} placeholder="EQ-ARD-UNO" />}</Field>
        <Field label="Name" required>{(id) => <Input id={id} value={form.name} onChange={set('name')} />}</Field>
        <Field label="Category" required>
          {(id) => (
            <Select id={id} value={form.category_id || ''} onChange={set('category_id')}>
              <option value="">Select…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Stored in lab" required>
          {(id) => (
            <Select id={id} value={form.lab_id || ''} onChange={set('lab_id')}>
              <option value="">Select…</option>
              {myLabs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Total quantity" required>{(id) => <Input id={id} type="number" min={0} value={form.total_quantity} onChange={set('total_quantity')} />}</Field>
        <Field label="Max units per booking" hint="Leave empty for the rule default">{(id) => <Input id={id} type="number" min={1} value={form.max_per_booking} onChange={set('max_per_booking')} />}</Field>
        <Field label="Condition">
          {(id) => (
            <Select id={id} value={form.condition} onChange={set('condition')}>
              {['new', 'good', 'fair', 'poor'].map((c) => <option key={c} value={c} className="capitalize">{c}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Maintenance status">
          {(id) => (
            <Select id={id} value={form.maintenance_status} onChange={set('maintenance_status')}>
              <option value="operational">Operational</option>
              <option value="needs_inspection">Needs inspection</option>
              <option value="under_maintenance">Under maintenance (unbookable)</option>
              <option value="retired">Retired</option>
            </Select>
          )}
        </Field>
        <Field label="Approval required" hint={APPROVAL_HELP[form.approval_level]} className="sm:col-span-2">
          {(id) => (
            <Select id={id} value={form.approval_level} onChange={set('approval_level')}>
              <option value="none">No approval</option>
              <option value="staff">Lab staff</option>
              <option value="coordinator">Coordinator</option>
            </Select>
          )}
        </Field>
        <Field label="Description" className="sm:col-span-2">{(id) => <Textarea id={id} value={form.description || ''} onChange={set('description')} />}</Field>
        <div className="sm:col-span-2">
          <Toggle checked={form.restricted_to_department} onChange={set('restricted_to_department')} label="Department-only access" description="Only students of the owning department can book it" />
        </div>
      </div>
    </Modal>
  );
}
