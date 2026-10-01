import nodemailer from 'nodemailer';
import { all, get, insert } from '../db.js';
import { SMTP } from '../config.js';
import { sendPush } from './push.js';

let transport = null;
if (SMTP.host) {
  transport = nodemailer.createTransport({
    host: SMTP.host,
    port: SMTP.port,
    secure: SMTP.port === 465,
    auth: SMTP.user ? { user: SMTP.user, pass: SMTP.pass } : undefined,
  });
}

// Notification types that are important enough to also go out by email.
const EMAIL_TYPES = new Set([
  'booking_approved',
  'booking_rejected',
  'booking_reminder',
  'return_reminder',
  'overdue',
  'resource_available',
  'booking_cancelled',
  'restriction',
]);

function sendEmail(userId, title, message) {
  const user = get('SELECT email, name FROM users WHERE id = ?', userId);
  if (!user) return;
  if (!transport) {
    // No SMTP configured (development): show what would have been emailed.
    console.log(`[email:not-sent] to=${user.email} subject="[UniLab] ${title}" (set SMTP_HOST to deliver)`);
    return;
  }
  transport
    .sendMail({ from: SMTP.from, to: user.email, subject: `[UniLab] ${title}`, text: `Hi ${user.name},\n\n${message}\n\n— UniLab` })
    .catch((err) => console.warn('[email] failed:', err.message));
}

/** Create an in-app notification, send a web push to the user's devices, and email it when SMTP is configured. */
export function notify(userId, { type, title, message = '', link = null }) {
  if (!userId) return;
  const id = insert('INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?)', userId, type, title, message, link);
  sendPush(userId, { id, type, title, body: message, url: link || '/notifications' });
  if (EMAIL_TYPES.has(type)) sendEmail(userId, title, message);
}

/** Notify everyone holding one of `roles` in a department (admins are notified only when no one else is). */
export function notifyDepartment(departmentId, roles, payload, { excludeUserId } = {}) {
  const placeholders = roles.map(() => '?').join(',');
  let recipients = all(
    `SELECT id FROM users WHERE is_active = 1 AND department_id = ? AND role IN (${placeholders})`,
    departmentId,
    ...roles,
  );
  if (!recipients.length) recipients = all(`SELECT id FROM users WHERE is_active = 1 AND role = 'admin'`);
  for (const r of recipients) if (r.id !== excludeUserId) notify(r.id, payload);
}

export function logActivity(actorId, entityType, entityId, action, details = null) {
  insert(
    'INSERT INTO activity_log (actor_id, entity_type, entity_id, action, details) VALUES (?, ?, ?, ?, ?)',
    actorId,
    entityType,
    entityId,
    action,
    details == null ? null : typeof details === 'string' ? details : JSON.stringify(details),
  );
}
