import { all, run, tx, updateRow, BOOKING_COLS } from '../db.js';
import { addEvent, promoteIfImminent, releaseResources } from './bookings.js';
import { syncAvailableQuantities } from './availability.js';
import { notify, notifyDepartment } from './notify.js';
import { addMinutes, humanDateTime, nowLocal, timeOf } from '../utils/time.js';
import { LATE_GRACE_MINUTES, RESERVE_LEAD_HOURS } from '../config.js';

const SELECT = `SELECT ${BOOKING_COLS()} FROM bookings b`;
const HAS_OPEN_ISSUES = `EXISTS (SELECT 1 FROM issues i WHERE i.booking_id = b.booking_id AND i.returned_at IS NULL)`;

function transition(b, to, action, note, extra = {}) {
  updateRow('bookings', b.id, { booking_status: to, updated_at: nowLocal(), ...extra });
  addEvent(b.id, null, action, b.status, to, note);
}

/** Time-based workflow automation. Runs every minute. */
export function tick() {
  const now = nowLocal();
  tx(() => {
    // 1. Pending requests nobody reviewed before the start time expire.
    for (const b of all(`${SELECT} WHERE b.booking_status = 'pending' AND b.start_at <= ?`, now)) {
      transition(b, 'rejected', 'expired', 'Not reviewed before the start time', {
        approval_status: 'rejected',
        rejection_reason: 'Request expired — it was not reviewed before the start time.',
        rejection_category: 'other',
      });
      notify(b.user_id, { type: 'booking_rejected', title: `Request expired — ${b.ref_code}`, message: 'Your request was not reviewed in time. Please book another slot.', link: `/bookings/${b.id}` });
    }

    // 2. Approved → Reserved when within the lead time (booking confirmation).
    for (const b of all(`${SELECT} WHERE b.booking_status = 'approved' AND b.start_at <= ?`, addMinutes(now, RESERVE_LEAD_HOURS * 60))) {
      promoteIfImminent(b);
    }

    // 3. "Booking time is approaching" reminders (1 hour before).
    for (const b of all(
      `${SELECT} WHERE b.booking_status IN ('approved','reserved') AND b.reminder_sent = 0 AND b.start_at <= ? AND b.start_at > ?`,
      addMinutes(now, 60),
      now,
    )) {
      run('UPDATE bookings SET reminder_sent = 1 WHERE booking_id = ?', b.id);
      notify(b.user_id, { type: 'booking_reminder', title: `Starting soon — ${b.ref_code}`, message: `Your booking starts at ${timeOf(b.start_at)}. Bring your booking QR code.`, link: `/bookings/${b.id}` });
    }

    // 4. No-shows: reserved bookings that ended without check-in.
    for (const b of all(`${SELECT} WHERE b.booking_status IN ('approved','reserved') AND b.end_at <= ?`, now)) {
      transition(b, 'cancelled', 'no_show', 'Automatically cancelled — no check-in', { cancel_reason: 'No-show (not checked in)' });
      notify(b.user_id, { type: 'booking_cancelled', title: `Missed booking — ${b.ref_code}`, message: 'You did not check in, so the booking was marked as a no-show.', link: `/bookings/${b.id}` });
    }
    // Warn lab staff once when a reserved booking is 30 minutes past start without check-in.
    for (const b of all(
      `${SELECT} WHERE b.booking_status = 'reserved' AND b.checked_in_at IS NULL AND b.start_at <= ? AND b.end_at > ? AND b.reminder_sent < 2`,
      addMinutes(now, -30),
      now,
    )) {
      run('UPDATE bookings SET reminder_sent = 2 WHERE booking_id = ?', b.id);
      notifyDepartment(b.department_id, ['staff'], { type: 'no_show_warning', title: `Possible no-show — ${b.ref_code}`, message: 'Booking started 30 minutes ago without check-in.', link: `/bookings/${b.id}` });
    }

    // 5. Lab-only bookings in use auto-complete at the end time.
    for (const b of all(`${SELECT} WHERE b.booking_status = 'in_use' AND b.end_at <= ? AND NOT ${HAS_OPEN_ISSUES}`, now)) {
      transition(b, 'completed', 'auto_completed', 'Session ended', { completed_at: now });
      releaseResources(b);
    }

    // 6. Equipment not returned past due (+ grace) → Overdue.
    for (const b of all(`${SELECT} WHERE b.booking_status = 'in_use' AND b.end_at <= ? AND ${HAS_OPEN_ISSUES}`, addMinutes(now, -LATE_GRACE_MINUTES))) {
      transition(b, 'overdue', 'overdue', 'Equipment not returned by the due time');
      notify(b.user_id, { type: 'overdue', title: `Equipment overdue — ${b.ref_code}`, message: `Your equipment was due at ${humanDateTime(b.end_at)}. Return it immediately to avoid restrictions.`, link: `/bookings/${b.id}` });
      notifyDepartment(b.department_id, ['staff'], { type: 'overdue', title: `Overdue return — ${b.ref_code}`, message: `Equipment from ${b.ref_code} has not been returned.`, link: `/bookings/${b.id}` });
    }

    // 7. "Return date approaching" reminders (1 hour before due).
    for (const b of all(
      `${SELECT} WHERE b.booking_status = 'in_use' AND b.return_reminder_sent = 0 AND b.end_at <= ? AND b.end_at > ? AND ${HAS_OPEN_ISSUES}`,
      addMinutes(now, 60),
      now,
    )) {
      run('UPDATE bookings SET return_reminder_sent = 1 WHERE booking_id = ?', b.id);
      notify(b.user_id, { type: 'return_reminder', title: `Return due soon — ${b.ref_code}`, message: `Please return your equipment by ${timeOf(b.end_at)}.`, link: `/bookings/${b.id}` });
    }

    // 8. Maintenance windows and temporary blocks.
    run(`UPDATE resource_blocks SET status = 'in_progress' WHERE status = 'scheduled' AND start_at <= ? AND end_at > ?`, now, now);
    for (const blk of all(`SELECT * FROM resource_blocks WHERE status IN ('scheduled','in_progress') AND end_at <= ?`, now)) {
      updateRow('resource_blocks', blk.id, { status: 'completed' });
      if (blk.kind === 'maintenance' && blk.resource_type === 'equipment') {
        run('UPDATE equipment SET last_maintenance_at = ? WHERE equipment_id = ?', now, blk.resource_id);
      }
    }

    // 9. Waitlist entries whose time has passed.
    run(`UPDATE waitlist SET status = 'expired' WHERE status IN ('waiting','notified') AND start_at <= ?`, now);

    // 10. Restrictions that have run out.
    for (const u of all(`SELECT id FROM users WHERE restricted_until IS NOT NULL AND restricted_until <= ?`, now)) {
      updateRow('users', u.id, { restricted_until: null, late_return_count: 0 });
      notify(u.id, { type: 'restriction_lifted', title: 'Booking privileges restored', message: 'Your restriction has ended. You can book resources again.', link: '/book' });
    }
  });
  // Reservations start/end as time passes, so the stored available_quantity is refreshed each tick.
  syncAvailableQuantities();
}

export function startScheduler() {
  const safeTick = () => {
    try {
      tick();
    } catch (err) {
      console.error('[scheduler]', err);
    }
  };
  safeTick();
  return setInterval(safeTick, 60 * 1000);
}
