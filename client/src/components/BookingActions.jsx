import { useEffect, useState } from 'react';
import { Camera, ImagePlus, X } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { Alert, Button, Field, Input, Modal, Select, Textarea } from './ui';
import { REJECTION_LABELS, describeBooking, fmtRange } from '../lib/format';

const QUICK_REASONS = {
  conflict: 'Overlaps with a scheduled class in this lab.',
  unavailable: 'The requested equipment is reserved for a department event.',
  rules: 'This request exceeds the booking limits for your role.',
  maintenance: 'The lab is scheduled for maintenance at this time.',
  insufficient_justification: 'Please resubmit with more detail about the purpose (course code / project).',
  priority: 'The slot was allocated to a higher-priority academic request.',
  other: '',
};

export function RejectModal({ booking, open, onClose, onDone }) {
  const toast = useToast();
  const [category, setCategory] = useState('conflict');
  const [reason, setReason] = useState(QUICK_REASONS.conflict);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setCategory('conflict');
      setReason(QUICK_REASONS.conflict);
    }
  }, [open]);
  const submit = async () => {
    setBusy(true);
    try {
      const b = await api.post(`/bookings/${booking.id}/reject`, { reason, category });
      toast.success(`${booking.ref_code} rejected — the requester has been notified`);
      onDone?.(b);
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Reject ${booking?.ref_code || ''}`}
      description={booking && `${describeBooking(booking)} · ${fmtRange(booking)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={submit} loading={busy} disabled={!reason.trim()}>Reject request</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Reason category">
          {(id) => (
            <Select
              id={id}
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setReason(QUICK_REASONS[e.target.value] || '');
              }}
            >
              {Object.entries(REJECTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Message to the requester" required hint="Used for rejection-reason analytics">
          {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />}
        </Field>
      </div>
    </Modal>
  );
}

export function CancelModal({ booking, open, onClose, onDone }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const b = await api.post(`/bookings/${booking.id}/cancel`, { reason });
      toast.success('Booking cancelled');
      onDone?.(b);
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Cancel this booking?"
      description="The time slot and equipment will be released to others (and the waitlist will be notified)."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Keep booking</Button>
          <Button variant="danger" onClick={submit} loading={busy}>Cancel booking</Button>
        </>
      }
    >
      <Field label="Reason (optional)">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Session rescheduled" />}</Field>
    </Modal>
  );
}

export function ApproveModal({ booking, open, onClose, onDone }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const b = await api.post(`/bookings/${booking.id}/approve`, { note });
      toast.success(`${booking.ref_code} approved`);
      onDone?.(b);
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={`Approve ${booking?.ref_code || ''}`}
      description={booking && `${describeBooking(booking)} · ${fmtRange(booking)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="success" onClick={submit} loading={busy}>Approve</Button>
        </>
      }
    >
      <Field label="Note to requester (optional)">{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Please collect kits from the lab counter" />}</Field>
    </Modal>
  );
}

/** Record a return: per-item good / damaged / missing counts, remarks and an optional damage photo. */
export function ReturnModal({ booking, issues, open, onClose, onDone }) {
  const toast = useToast();
  const outstanding = (issues || []).filter((i) => !i.returned_at);
  const [rows, setRows] = useState({});
  const [remarks, setRemarks] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setRows(Object.fromEntries(outstanding.map((i) => [i.id, { good: i.quantity, damaged: 0, missing: 0, remarks: '' }])));
      setRemarks('');
      setImage(null);
      setPreview(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, issues]);

  useEffect(() => {
    if (!image) return undefined;
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  const setRow = (id, k, v, qty) =>
    setRows((r) => {
      const row = { ...r[id], [k]: Math.max(0, Math.min(qty, Number.parseInt(v, 10) || 0)) };
      if (k !== 'good') row.good = Math.max(0, qty - row.damaged - row.missing);
      return { ...r, [id]: row };
    });
  const anyDamage = Object.values(rows).some((r) => r.damaged || r.missing);
  const invalid = outstanding.some((i) => {
    const r = rows[i.id];
    return !r || r.good + r.damaged + r.missing !== i.quantity;
  });
  const submit = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('data', JSON.stringify({ items: outstanding.map((i) => ({ issue_id: i.id, ...rows[i.id] })), remarks, severity }));
      if (image) fd.append('image', image);
      const b = await api.form(`/bookings/${booking.id}/return`, fd);
      toast.success(`Return recorded — status: ${b.status.replace('_', ' ')}`);
      onDone?.(b);
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Confirm return — ${booking?.ref_code || ''}`}
      description={booking && `${booking.user_name} · due ${fmtRange(booking)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={invalid}>Confirm return</Button>
        </>
      }
    >
      <div className="space-y-4">
        {booking?.status === 'overdue' && <Alert tone="red" title="This return is late">It will count toward the borrower's late-return limit.</Alert>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-2 pr-2 font-medium">Item</th>
                <th className="px-2 py-2 font-medium">Issued</th>
                <th className="px-2 py-2 font-medium">Good</th>
                <th className="px-2 py-2 font-medium">Damaged</th>
                <th className="px-2 py-2 font-medium">Missing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {outstanding.map((i) => {
                const r = rows[i.id] || { good: 0, damaged: 0, missing: 0 };
                return (
                  <tr key={i.id}>
                    <td className="py-2 pr-2 font-medium">{i.equipment_name}</td>
                    <td className="px-2 py-2 tabular">{i.quantity}</td>
                    <td className="px-2 py-2"><Input type="number" min={0} max={i.quantity} value={r.good} onChange={(e) => setRow(i.id, 'good', e.target.value, i.quantity)} className="w-20" aria-label="Good" /></td>
                    <td className="px-2 py-2"><Input type="number" min={0} max={i.quantity} value={r.damaged} onChange={(e) => setRow(i.id, 'damaged', e.target.value, i.quantity)} className="w-20" aria-label="Damaged" /></td>
                    <td className="px-2 py-2"><Input type="number" min={0} max={i.quantity} value={r.missing} onChange={(e) => setRow(i.id, 'missing', e.target.value, i.quantity)} className="w-20" aria-label="Missing" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {invalid && <p className="text-xs text-red-600">Good + damaged + missing must equal the issued quantity for every item.</p>}
        <Field label="Remarks / damage description">{(id) => <Textarea id={id} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={anyDamage ? 'Describe the damage (e.g. cracked screen, missing probe)' : 'Optional'} />}</Field>
        {anyDamage && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Severity">
              {(id) => (
                <Select id={id} value={severity} onChange={(e) => setSeverity(e.target.value)}>
                  <option value="low">Low — cosmetic</option>
                  <option value="medium">Medium — partially working</option>
                  <option value="high">High — unusable</option>
                </Select>
              )}
            </Field>
            <div>
              <p className="label">Damage photo</p>
              {preview ? (
                <div className="relative inline-block">
                  <img src={preview} alt="Damage preview" className="h-24 rounded-lg border border-slate-200 object-cover" />
                  <button onClick={() => setImage(null)} className="absolute -top-2 -right-2 rounded-full bg-white p-1 shadow" aria-label="Remove photo">
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : (
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-600 hover:border-brand-400 hover:bg-brand-50/40">
                  <ImagePlus className="size-4" /> Upload or take a photo
                  <Camera className="ml-auto size-4 text-slate-400" />
                  <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setImage(e.target.files?.[0] || null)} />
                </label>
              )}
            </div>
          </div>
        )}
        {anyDamage && <Alert tone="amber">Damaged units move to maintenance and missing units are flagged. Both are logged as damage reports linked to the borrower.</Alert>}
      </div>
    </Modal>
  );
}
