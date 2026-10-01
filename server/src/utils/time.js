// All booking times are stored as local "YYYY-MM-DDTHH:MM" strings so they can be
// compared lexicographically in SQL and never shift across time zones.

export const pad = (n) => String(n).padStart(2, '0');

export function fmtLocal(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDate(d = new Date()) {
  return fmtLocal(d).slice(0, 10);
}

export const nowLocal = () => fmtLocal(new Date());
export const today = () => fmtDate(new Date());

export function parseLocal(s) {
  const [d, t = '00:00'] = String(s).split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, hh || 0, mm || 0);
}

export const addMinutes = (s, min) => fmtLocal(new Date(parseLocal(s).getTime() + min * 60000));
export const addDays = (dateStr, days) => fmtDate(new Date(parseLocal(`${dateStr}T12:00`).getTime() + days * 86400000));
export const diffMinutes = (a, b) => Math.round((parseLocal(b) - parseLocal(a)) / 60000);

export const toMinutes = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
};
export const fromMinutes = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

export const dateOf = (s) => String(s).slice(0, 10);
export const timeOf = (s) => String(s).slice(11, 16);
export const weekday = (dateStr) => parseLocal(`${dateStr}T12:00`).getDay();

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseLocal(s).getTime());
export const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function humanDateTime(s) {
  const d = parseLocal(s);
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
