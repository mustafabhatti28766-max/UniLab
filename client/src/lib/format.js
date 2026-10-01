const pad = (n) => String(n).padStart(2, '0');

export const toDateStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => toDateStr(new Date());
export const nowLocal = () => {
  const d = new Date();
  return `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function parseLocal(s) {
  if (!s) return null;
  const [d, t = '00:00'] = String(s).replace(' ', 'T').split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, hh || 0, mm || 0);
}

export const addDays = (dateStr, n) => {
  const d = parseLocal(`${dateStr}T12:00`);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
};

export const toMinutes = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
};
export const fromMinutes = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return m ? `${hh}:${pad(m)} ${suffix}` : `${hh} ${suffix}`;
}

export function fmtDate(dateStr, opts = {}) {
  const d = parseLocal(String(dateStr).slice(0, 10));
  if (!d) return '';
  const t = todayStr();
  if (!opts.full) {
    if (dateStr.slice(0, 10) === t) return 'Today';
    if (dateStr.slice(0, 10) === addDays(t, 1)) return 'Tomorrow';
    if (dateStr.slice(0, 10) === addDays(t, -1)) return 'Yesterday';
  }
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(opts.year ? { year: 'numeric' } : {}) });
}

export const fmtDateTime = (s) => (s ? `${fmtDate(s)}, ${fmtTime(String(s).replace(' ', 'T').slice(11, 16))}` : '—');
export const fmtRange = (b) => `${fmtDate(b.booking_date || b.start_at)} · ${fmtTime((b.start_time || b.start_at.slice(11, 16)))}–${fmtTime(b.end_time || b.end_at.slice(11, 16))}`;

export function timeAgo(s) {
  const d = parseLocal(s);
  if (!d) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  const future = diff < 0;
  const a = Math.abs(diff);
  let out;
  if (a < 60) out = 'just now';
  else if (a < 3600) out = `${Math.round(a / 60)} min`;
  else if (a < 86400) out = `${Math.round(a / 3600)} h`;
  else if (a < 86400 * 30) out = `${Math.round(a / 86400)} d`;
  else return fmtDate(s, { year: true });
  if (out === 'just now') return out;
  return future ? `in ${out}` : `${out} ago`;
}

/** 30-minute time options for selects. */
export const TIME_OPTIONS = Array.from({ length: 31 }, (_, i) => fromMinutes(7 * 60 + i * 30));

export const STATUS_META = {
  draft: { label: 'Draft', tone: 'slate' },
  pending: { label: 'Pending approval', tone: 'amber' },
  approved: { label: 'Approved', tone: 'blue' },
  reserved: { label: 'Reserved', tone: 'indigo' },
  in_use: { label: 'In use', tone: 'violet' },
  completed: { label: 'Completed', tone: 'emerald' },
  rejected: { label: 'Rejected', tone: 'rose' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
  overdue: { label: 'Overdue', tone: 'red' },
  returned_late: { label: 'Returned late', tone: 'orange' },
  damaged: { label: 'Damaged', tone: 'red' },
};

export const LIVE_META = {
  available: { label: 'Available', tone: 'emerald' },
  reserved: { label: 'Reserved', tone: 'indigo' },
  in_use: { label: 'In use', tone: 'violet' },
  maintenance: { label: 'Maintenance', tone: 'amber' },
  closed: { label: 'Closed', tone: 'slate' },
};

export const ROLE_LABELS = { student: 'Student', faculty: 'Faculty', staff: 'Lab Staff', coordinator: 'Coordinator', admin: 'Administrator' };

export const PURPOSE_LABELS = {
  class: 'Scheduled class / lab session',
  exam: 'Exam / assessment',
  research: 'Research',
  thesis: 'Thesis / final-year project',
  project: 'Course project',
  workshop: 'Workshop / seminar',
  club: 'Club / society activity',
  other: 'Other',
};

export const REJECTION_LABELS = {
  conflict: 'Scheduling conflict',
  unavailable: 'Resource unavailable',
  rules: 'Violates booking rules',
  maintenance: 'Maintenance',
  insufficient_justification: 'Insufficient justification',
  priority: 'Higher-priority request',
  other: 'Other',
};

export const CONDITION_LABELS = { new: 'New', good: 'Good', fair: 'Fair', poor: 'Poor' };
export const MAINT_META = {
  operational: { label: 'Operational', tone: 'emerald' },
  needs_inspection: { label: 'Needs inspection', tone: 'amber' },
  under_maintenance: { label: 'Under maintenance', tone: 'orange' },
  retired: { label: 'Retired', tone: 'slate' },
};

export const isManagerRole = (role) => ['staff', 'coordinator', 'admin'].includes(role);

export function describeBooking(b) {
  const parts = [];
  if (b.lab_name) parts.push(b.lab_name);
  for (const i of b.items || []) parts.push(`${i.quantity} × ${i.name}`);
  return parts.join(' + ') || 'Booking';
}

/** "Add to Google Calendar" template link for a booking. */
export function googleCalendarUrl(b) {
  const dt = (s) => `${s.replace(/[-:]/g, '').slice(0, 13)}00`;
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${describeBooking(b)} (${b.ref_code})`,
    dates: `${dt(b.start_at)}/${dt(b.end_at)}`,
    details: `UniLab booking ${b.ref_code}\nStatus: ${b.status}\nPurpose: ${b.purpose || '-'}`,
    location: b.lab_location || '',
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}

/** Outlook.com calendar link. */
export function outlookCalendarUrl(b) {
  const p = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: `${describeBooking(b)} (${b.ref_code})`,
    startdt: `${b.start_at}:00`,
    enddt: `${b.end_at}:00`,
    body: `UniLab booking ${b.ref_code} — ${b.purpose || ''}`,
    location: b.lab_location || '',
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${p}`;
}

export const durationLabel = (start, end) => {
  const m = toMinutes(end) - toMinutes(start);
  if (m <= 0) return '';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h ? `${h}h` : ''}${mm ? ` ${mm}m` : ''}`.trim();
};
