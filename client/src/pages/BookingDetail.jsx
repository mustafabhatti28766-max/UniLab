import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft, Check, X, ArrowUpCircle, LogIn, PackageCheck, CheckCircle2, Ban, Download, Pencil, Send, Clock, Users,
  MapPin, Target, User, Package, FlaskConical, AlertTriangle, History, Printer, ShieldCheck, Wrench, ClipboardList, CalendarPlus,
} from 'lucide-react';
import { api, downloadFile, fileUrl } from '../lib/api';
import { useAsync, useTitle } from '../lib/hooks';
import { useToast } from '../context/ToastContext';
import { Alert, Badge, Button, Card, CardHeader, ErrorState, Field, Input, Modal, Select, Spinner, Textarea } from '../components/ui';
import { PriorityBadge, ProblemList, StatusBadge, StatusStepper } from '../components/booking-ui';
import { ApproveModal, CancelModal, RejectModal, ReturnModal } from '../components/BookingActions';
import { PURPOSE_LABELS, REJECTION_LABELS, ROLE_LABELS, STATUS_META, describeBooking, durationLabel, fmtDate, fmtDateTime, fmtTime, googleCalendarUrl, outlookCalendarUrl } from '../lib/format';

const EVENT_LABELS = {
  submitted: 'Request submitted',
  draft_saved: 'Draft saved',
  auto_approved: 'Approved automatically',
  approved: 'Approved',
  rejected: 'Rejected',
  escalated: 'Escalated to coordinator',
  reserved: 'Reserved — slot locked',
  cancelled: 'Cancelled',
  no_show: 'Marked as no-show',
  checked_in: 'Checked in / issued',
  returned: 'Equipment returned',
  completed: 'Completed',
  auto_completed: 'Session ended',
  overdue: 'Marked overdue',
  expired: 'Request expired',
};

function ReportFaultModal({ booking, open, onClose }) {
  const toast = useToast();
  const [form, setForm] = useState({ equipment_id: booking.items[0]?.equipment_id || '', description: '', severity: 'medium', quantity: 1 });
  const [image, setImage] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('data', JSON.stringify({ ...form, booking_id: booking.id }));
      if (image) fd.append('image', image);
      await api.form('/damage-reports', fd);
      toast.success('Problem reported to lab staff');
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
      title="Report a problem with equipment"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!form.description.trim()}>Send report</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Equipment">
          {(id) => (
            <Select id={id} value={form.equipment_id} onChange={(e) => setForm((f) => ({ ...f, equipment_id: e.target.value }))}>
              {booking.items.map((i) => <option key={i.equipment_id} value={i.equipment_id}>{i.name}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Units affected">{(id) => <Input id={id} type="number" min={1} value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />}</Field>
          <Field label="Severity">
            {(id) => (
              <Select id={id} value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="What's wrong?" required>{(id) => <Textarea id={id} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="e.g. Board not detected over USB" />}</Field>
        <Field label="Photo (optional)">{(id) => <input id={id} type="file" accept="image/*" capture="environment" onChange={(e) => setImage(e.target.files?.[0] || null)} className="text-sm" />}</Field>
      </div>
    </Modal>
  );
}

function Detail({ icon: Icon, label, children }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <div className="text-sm text-slate-900">{children}</div>
      </div>
    </div>
  );
}

export default function BookingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: b, error, loading, reload } = useAsync(() => api.get(`/bookings/${id}`), [id]);
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(null);
  useTitle(b ? b.ref_code : 'Booking');

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !b) return <Spinner />;
  const p = b.permissions;
  const showQr = p.is_owner && ['approved', 'reserved', 'in_use', 'overdue'].includes(b.status);

  const act = async (name, path, body) => {
    setBusy(name);
    try {
      await api.post(`/bookings/${b.id}/${path}`, body);
      toast.success(
        {
          submit: 'Request submitted',
          escalate: 'Escalated to the department coordinator',
          checkin: 'Checked in — equipment issued / access granted',
          complete: 'Booking completed',
        }[name],
      );
      reload(true);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };
  const afterModal = () => reload(true);

  return (
    <div>
      <button onClick={() => navigate(-1)} className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Back
      </button>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-semibold tracking-tight">{b.ref_code}</h1>
            <StatusBadge status={b.status} />
            {b.status === 'pending' && <PriorityBadge level={b.priority} score={b.priority_score} />}
            {b.escalated ? <Badge tone="amber">Escalated</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-slate-600">{describeBooking(b)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={googleCalendarUrl(b)} target="_blank" rel="noreferrer">
            <Button variant="secondary" size="sm" icon={CalendarPlus}>Google Calendar</Button>
          </a>
          <a href={outlookCalendarUrl(b)} target="_blank" rel="noreferrer">
            <Button variant="secondary" size="sm" icon={CalendarPlus}>Outlook</Button>
          </a>
          <Button variant="secondary" size="sm" icon={Download} onClick={() => downloadFile(`/bookings/${b.id}/ics`, `${b.ref_code}.ics`).catch(toast.error)}>
            .ics
          </Button>
          {showQr && (
            <Button variant="secondary" size="sm" icon={Printer} onClick={() => window.print()}>
              Print
            </Button>
          )}
        </div>
      </div>

      <Card className="mb-6 p-5">
        <StatusStepper status={b.status} events={b.events} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {b.status === 'rejected' && (
            <Alert tone="red" title={`Rejected — ${REJECTION_LABELS[b.rejection_category] || 'Other'}`}>
              {b.rejection_reason}{' '}
              <Link to="/finder" className="font-medium underline">Find an alternative</Link>
            </Alert>
          )}
          {b.status === 'cancelled' && b.cancel_reason && <Alert tone="slate" title="Cancelled">{b.cancel_reason}</Alert>}
          {b.status === 'overdue' && <Alert tone="red" title="Equipment overdue">Due {fmtDateTime(b.end_at)}. Return it to {b.lab_location || 'the lab'} immediately — late returns can restrict future bookings.</Alert>}
          {b.conflict && !b.conflict.available && (
            <Alert tone="red" title="Cannot be approved as-is">
              <ProblemList problems={b.conflict.problems} />
            </Alert>
          )}
          {b.conflict && b.conflict.available && b.conflict.competing.length > 0 && (
            <Alert tone="amber" title={`Competes with ${b.conflict.competing.length} other pending request(s) for this lab`}>
              Approving this one will block the others. <Link to="/conflicts" className="font-medium underline">Open conflict center</Link>
            </Alert>
          )}

          <Card>
            <CardHeader title="Booking details" icon={ClipboardList} />
            <div className="grid gap-5 p-5 sm:grid-cols-2">
              <Detail icon={Clock} label="When">
                {fmtDate(b.booking_date, { full: true, year: true })}
                <br />
                {fmtTime(b.start_time)} – {fmtTime(b.end_time)} <span className="text-slate-500">({durationLabel(b.start_time, b.end_time)})</span>
              </Detail>
              {b.lab_id && (
                <Detail icon={FlaskConical} label="Laboratory">
                  <Link to={`/labs/${b.lab_id}`} className="font-medium hover:text-brand-700">{b.lab_name}</Link>
                  <span className="block text-xs text-slate-500">{b.lab_code} · capacity {b.lab_capacity}</span>
                </Detail>
              )}
              {b.lab_location && <Detail icon={MapPin} label="Location">{b.lab_location}</Detail>}
              <Detail icon={Users} label="Attendees">{b.attendees}</Detail>
              <Detail icon={Target} label="Purpose">
                <span className="font-medium">{PURPOSE_LABELS[b.purpose_type]}</span>
                {b.purpose && <span className="block text-slate-600">{b.purpose}</span>}
              </Detail>
              <Detail icon={User} label="Requested by">
                {b.user_name} <span className="text-slate-500">· {ROLE_LABELS[b.user_role]}{b.user_department_code ? `, ${b.user_department_code}` : ''}</span>
                {p.is_manager && (
                  <span className="block text-xs text-slate-500">
                    {b.user_email}
                    {b.user_student_id && ` · ID ${b.user_student_id}`}
                    {b.user_late_returns > 0 && <span className="text-amber-700"> · {b.user_late_returns} late return(s)</span>}
                  </span>
                )}
              </Detail>
              <Detail icon={ShieldCheck} label="Approval">
                {b.approval_status === 'auto' ? 'Approved automatically' : b.approval_status === 'approved' ? `Approved by ${b.approved_by_name || 'staff'}` : b.approval_status === 'rejected' ? `Rejected by ${b.approved_by_name || 'staff'}` : b.status === 'draft' ? 'Not submitted' : `Awaiting ${b.required_approval} approval`}
                {b.approved_at && <span className="block text-xs text-slate-500">{fmtDateTime(b.approved_at)}</span>}
              </Detail>
            </div>
          </Card>

          {b.items.length > 0 && (
            <Card>
              <CardHeader title="Equipment" subtitle="Issue and return record" icon={Package} />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-5 py-2 font-medium">Item</th>
                      <th className="px-3 py-2 font-medium">Qty</th>
                      <th className="px-3 py-2 font-medium">Issued</th>
                      <th className="px-3 py-2 font-medium">Due</th>
                      <th className="px-3 py-2 font-medium">Returned</th>
                      <th className="px-3 py-2 font-medium">Condition</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {b.items.map((it) => {
                      const iss = b.issues.find((x) => x.equipment_id === it.equipment_id);
                      return (
                        <tr key={it.id}>
                          <td className="px-5 py-2.5">
                            <Link to={`/equipment/${it.equipment_id}`} className="font-medium hover:text-brand-700">{it.name}</Link>
                            <span className="block font-mono text-xs text-slate-400">{it.code}</span>
                          </td>
                          <td className="px-3 py-2.5 tabular">{it.quantity}</td>
                          <td className="px-3 py-2.5 text-xs text-slate-600">{iss ? <>{fmtDateTime(iss.issued_at)}<br /><span className="text-slate-400">by {iss.issued_by_name}</span></> : '—'}</td>
                          <td className="px-3 py-2.5 text-xs text-slate-600">{iss ? fmtDateTime(iss.due_at) : '—'}</td>
                          <td className="px-3 py-2.5 text-xs text-slate-600">
                            {iss?.returned_at ? (
                              <>
                                {fmtDateTime(iss.returned_at)}
                                {iss.is_late ? <Badge tone="orange" className="ml-1">Late</Badge> : null}
                              </>
                            ) : iss ? (
                              <Badge tone={b.status === 'overdue' ? 'red' : 'violet'}>Out</Badge>
                            ) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-xs">
                            {iss?.returned_at ? (
                              <span>
                                {iss.returned_good} good
                                {iss.returned_damaged ? <span className="text-red-600">, {iss.returned_damaged} damaged</span> : null}
                                {iss.returned_missing ? <span className="text-red-600">, {iss.returned_missing} missing</span> : null}
                                {iss.remarks && <span className="block text-slate-500">{iss.remarks}</span>}
                                {iss.damage_image && <a href={fileUrl(iss.damage_image)} target="_blank" rel="noreferrer" className="text-brand-700 underline">Photo</a>}
                              </span>
                            ) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Approval & activity history" icon={History} />
            <ol className="relative space-y-4 p-5">
              {b.events.map((e, i) => (
                <li key={e.id} className="relative flex gap-3">
                  {i < b.events.length - 1 && <span className="absolute top-6 left-[11px] h-[calc(100%+4px)] w-px bg-slate-200" aria-hidden />}
                  <span className={`z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${['rejected', 'cancelled', 'no_show', 'overdue', 'expired'].includes(e.action) ? 'bg-red-100 text-red-600' : 'bg-brand-100 text-brand-700'}`}>
                    {['rejected', 'cancelled', 'no_show', 'expired'].includes(e.action) ? <X className="size-3" /> : <Check className="size-3" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {EVENT_LABELS[e.action] || e.action}
                      {e.to_status && STATUS_META[e.to_status] && e.from_status !== e.to_status && <span className="font-normal text-slate-500"> → {STATUS_META[e.to_status].label}</span>}
                    </p>
                    <p className="text-xs text-slate-500">
                      {fmtDateTime(e.created_at)} · {e.actor_name ? `${e.actor_name} (${ROLE_LABELS[e.actor_role] || e.actor_role})` : 'System'}
                    </p>
                    {e.note && <p className="mt-0.5 text-sm text-slate-600">{e.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="space-y-6">
          {showQr && (
            <Card className="p-5 text-center">
              <p className="text-sm font-semibold">Booking pass</p>
              <p className="text-xs text-slate-500">Show this QR code to lab staff to check in and return</p>
              <div className="mx-auto mt-4 inline-block rounded-xl border border-slate-200 bg-white p-3">
                <QRCodeSVG value={b.qr_token} size={176} level="M" />
              </div>
              <p className="mt-2 font-mono text-sm font-semibold">{b.ref_code}</p>
            </Card>
          )}

          <Card>
            <CardHeader title="Actions" />
            <div className="space-y-2 p-5">
              {p.can_edit && (
                <Link to={`/book?draft=${b.id}`} className="block">
                  <Button variant="secondary" icon={Pencil} className="w-full">Edit draft</Button>
                </Link>
              )}
              {p.can_submit && <Button icon={Send} className="w-full" loading={busy === 'submit'} onClick={() => act('submit', 'submit')}>Submit for approval</Button>}
              {p.can_approve && <Button variant="success" icon={Check} className="w-full" onClick={() => setModal('approve')} disabled={b.conflict && !b.conflict.available}>Approve</Button>}
              {p.can_reject && <Button variant="secondary" icon={X} className="w-full" onClick={() => setModal('reject')}>Reject</Button>}
              {p.can_escalate && <Button variant="secondary" icon={ArrowUpCircle} className="w-full" loading={busy === 'escalate'} onClick={() => act('escalate', 'escalate')}>Escalate to coordinator</Button>}
              {p.is_manager && b.status === 'pending' && b.required_approval === 'coordinator' && !p.can_approve && <Alert tone="blue">This request needs coordinator approval.</Alert>}
              {p.can_check_in && (
                <Button icon={b.items.length ? PackageCheck : LogIn} className="w-full" loading={busy === 'checkin'} onClick={() => act('checkin', 'check-in')}>
                  {b.items.length ? 'Issue equipment' : 'Grant lab access'}
                </Button>
              )}
              {p.can_return && <Button icon={PackageCheck} className="w-full" onClick={() => setModal('return')}>Confirm return</Button>}
              {p.can_complete && <Button variant="success" icon={CheckCircle2} className="w-full" loading={busy === 'complete'} onClick={() => act('complete', 'complete')}>Check out & complete</Button>}
              {p.is_owner && ['in_use', 'overdue'].includes(b.status) && b.items.length > 0 && (
                <Button variant="secondary" icon={Wrench} className="w-full" onClick={() => setModal('fault')}>Report a problem</Button>
              )}
              {p.can_cancel && <Button variant="ghost" icon={Ban} className="w-full text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setModal('cancel')}>Cancel booking</Button>}
              {!Object.entries(p).some(([k, v]) => k.startsWith('can_') && v) && !(p.is_owner && ['in_use', 'overdue'].includes(b.status)) && (
                <p className="text-sm text-slate-500">No actions available for this booking.</p>
              )}
            </div>
          </Card>

          {b.damage_reports.length > 0 && (
            <Card>
              <CardHeader title="Damage reports" icon={AlertTriangle} />
              <ul className="divide-y divide-slate-100">
                {b.damage_reports.map((r) => (
                  <li key={r.id} className="px-5 py-3 text-sm">
                    <p className="font-medium">{r.quantity} × {r.equipment_name} — {r.kind}</p>
                    <p className="text-xs text-slate-500">{r.description}</p>
                    <Badge tone={r.status === 'resolved' ? 'emerald' : 'amber'} className="mt-1">{r.status.replace('_', ' ')}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <ApproveModal booking={b} open={modal === 'approve'} onClose={() => setModal(null)} onDone={afterModal} />
      <RejectModal booking={b} open={modal === 'reject'} onClose={() => setModal(null)} onDone={afterModal} />
      <CancelModal booking={b} open={modal === 'cancel'} onClose={() => setModal(null)} onDone={afterModal} />
      <ReturnModal booking={b} issues={b.issues} open={modal === 'return'} onClose={() => setModal(null)} onDone={afterModal} />
      {modal === 'fault' && <ReportFaultModal booking={b} open onClose={() => setModal(null)} />}
    </div>
  );
}
