import { all, get, run, tx } from '../db.js';
import { getRules } from './rules.js';
import { dateOf, timeOf, toMinutes, weekday, nowLocal, today, WEEKDAYS } from '../utils/time.js';

/** Booking statuses that hold a time slot / equipment units. */
export const HOLDING_STATUSES = ['approved', 'reserved', 'in_use'];
const HOLDING_SQL = HOLDING_STATUSES.map((s) => `'${s}'`).join(',');
const LAB_HOLDING_SQL = `${HOLDING_SQL},'overdue'`;

export const DEFAULT_HOURS = { open_time: '08:00', close_time: '20:00' };

// ---------------------------------------------------------------------------
// Labs
// ---------------------------------------------------------------------------
export function labConflicts(labId, startAt, endAt, excludeId = 0) {
  return all(
    `SELECT b.booking_id AS id, b.ref_code, b.start_at, b.end_at, b.booking_status AS status, b.purpose, u.name AS user_name
       FROM bookings b JOIN users u ON u.id = b.user_id
      WHERE b.lab_id = ? AND b.booking_id != ? AND b.booking_status IN (${LAB_HOLDING_SQL})
        AND b.start_at < ? AND b.end_at > ?
      ORDER BY b.start_at`,
    labId,
    excludeId,
    endAt,
    startAt,
  );
}

export function activeBlocks(resourceType, resourceId, startAt, endAt) {
  return all(
    `SELECT * FROM resource_blocks
      WHERE resource_type = ? AND resource_id = ? AND status IN ('scheduled','in_progress')
        AND start_at < ? AND end_at > ?
      ORDER BY start_at`,
    resourceType,
    resourceId,
    endAt,
    startAt,
  );
}

/** Operating-hour / closed-day check shared by labs and equipment. */
export function hoursProblems(hours, startAt, endAt, rules) {
  const problems = [];
  const open = hours.open_time || DEFAULT_HOURS.open_time;
  const close = hours.close_time || DEFAULT_HOURS.close_time;
  if (dateOf(startAt) !== dateOf(endAt)) problems.push({ code: 'multi_day', message: 'Bookings must start and end on the same day.' });
  if (toMinutes(timeOf(startAt)) < toMinutes(open) || toMinutes(timeOf(endAt)) > toMinutes(close)) {
    problems.push({ code: 'outside_hours', message: `${hours.name || 'This resource'} is open ${open}–${close}.` });
  }
  const wd = weekday(dateOf(startAt));
  if (rules.closed_weekdays_list.includes(wd)) {
    problems.push({ code: 'closed_day', message: `Labs are closed on ${WEEKDAYS[wd]}s.` });
  }
  return problems;
}

/** Full availability check for a lab (row with id/name aliases) over [startAt, endAt). */
export function checkLab(lab, startAt, endAt, { excludeId = 0, rules } = {}) {
  rules = rules || getRules(lab.department_id);
  const problems = [];
  if (lab.status === 'maintenance') problems.push({ code: 'lab_unavailable', message: `${lab.name} is under maintenance.` });
  if (lab.status === 'closed') problems.push({ code: 'lab_unavailable', message: `${lab.name} is currently closed.` });
  problems.push(...hoursProblems(lab, startAt, endAt, rules));

  const conflicts = labConflicts(lab.id, startAt, endAt, excludeId);
  if (conflicts.length) {
    const c = conflicts[0];
    problems.push({
      code: 'lab_conflict',
      message: `Booking conflict: ${lab.name} is already booked ${timeOf(c.start_at)}–${timeOf(c.end_at)}${conflicts.length > 1 ? ` (+${conflicts.length - 1} more)` : ''}.`,
    });
  }
  const blocks = activeBlocks('lab', lab.id, startAt, endAt);
  if (blocks.length) {
    const b = blocks[0];
    problems.push({ code: 'lab_blocked', message: `${lab.name} is blocked (${b.kind}: ${b.title}) ${timeOf(b.start_at)}–${timeOf(b.end_at)}.` });
  }
  return { available: problems.length === 0, problems, conflicts, blocks };
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

/** Maximum number of units held at the same time inside the window. */
function peakConcurrent(rows, startAt, endAt) {
  const events = [];
  for (const r of rows) {
    events.push([r.start_at < startAt ? startAt : r.start_at, r.quantity]);
    events.push([r.end_at > endAt ? endAt : r.end_at, -r.quantity]);
  }
  // Releases sort before acquisitions at the same instant (back-to-back bookings are fine).
  events.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  let cur = 0;
  let peak = 0;
  for (const [, q] of events) {
    cur += q;
    if (cur > peak) peak = cur;
  }
  return peak;
}

export function equipmentBase(eq) {
  return Math.max(0, eq.total_quantity - eq.maintenance_quantity - eq.missing_quantity);
}

/** Units of `eq` that can still be booked for [startAt, endAt). */
export function equipmentAvailability(eq, startAt, endAt, excludeId = 0) {
  const base = equipmentBase(eq);
  if (eq.maintenance_status === 'retired' || eq.maintenance_status === 'under_maintenance') {
    return { total: eq.total_quantity, base, booked: 0, overdue: 0, blocked: base, available: 0 };
  }
  const blocks = activeBlocks('equipment', eq.id, startAt, endAt);
  const blocked = Math.min(base, blocks.reduce((s, b) => s + (b.quantity ?? base), 0));

  const rows = all(
    `SELECT b.start_at, b.end_at, bi.quantity
       FROM booking_items bi JOIN bookings b ON b.booking_id = bi.booking_id
      WHERE bi.equipment_id = ? AND b.booking_id != ? AND b.booking_status IN (${HOLDING_SQL})
        AND b.start_at < ? AND b.end_at > ?`,
    eq.id,
    excludeId,
    endAt,
    startAt,
  );
  const booked = peakConcurrent(rows, startAt, endAt);

  // Units from overdue bookings are still out — they stay unavailable until returned.
  const overdue = get(
    `SELECT COALESCE(SUM(i.quantity), 0) AS q FROM issues i JOIN bookings b ON b.booking_id = i.booking_id
      WHERE i.equipment_id = ? AND i.returned_at IS NULL AND b.booking_status = 'overdue' AND b.booking_id != ?`,
    eq.id,
    excludeId,
  ).q;

  return { total: eq.total_quantity, base, booked, overdue, blocked, available: Math.max(0, base - blocked - booked - overdue) };
}

/**
 * Stock snapshot: Total / Reserved (rest of today) / In use / Maintenance / Available.
 * Matches e.g. "Arduino kits — Total 20, Reserved 8, In use 5, Available 7".
 */
export function equipmentSnapshots() {
  const now = nowLocal();
  const endOfDay = `${today()}T23:59`;
  const inUse = new Map(
    all(`SELECT equipment_id, SUM(quantity) AS q FROM issues WHERE returned_at IS NULL GROUP BY equipment_id`).map((r) => [r.equipment_id, r.q]),
  );
  // Peak number of units reserved at the same time during the rest of today.
  const reservedRows = new Map();
  for (const r of all(
    `SELECT bi.equipment_id, bi.quantity, b.start_at, b.end_at FROM booking_items bi JOIN bookings b ON b.booking_id = bi.booking_id
      WHERE b.booking_status IN ('approved','reserved') AND b.start_at < ? AND b.end_at > ?`,
    endOfDay,
    now,
  )) {
    if (!reservedRows.has(r.equipment_id)) reservedRows.set(r.equipment_id, []);
    reservedRows.get(r.equipment_id).push(r);
  }
  const reserved = new Map([...reservedRows].map(([id, rows]) => [id, peakConcurrent(rows, now, endOfDay)]));
  const blocked = new Map(
    all(
      `SELECT resource_id, quantity FROM resource_blocks WHERE resource_type = 'equipment'
         AND status IN ('scheduled','in_progress') AND start_at <= ? AND end_at > ?`,
      now,
      now,
    ).map((r) => [r.resource_id, r.quantity]),
  );
  return (eq) => {
    const id = eq.equipment_id ?? eq.id;
    const base = equipmentBase(eq);
    const iu = inUse.get(id) || 0;
    const rs = reserved.get(id) || 0;
    const bl = blocked.has(id) ? (blocked.get(id) ?? base) : 0;
    const unavailable = ['retired', 'under_maintenance'].includes(eq.maintenance_status);
    return {
      in_use: iu,
      reserved: rs,
      maintenance: eq.maintenance_quantity + Math.min(bl, base),
      missing: eq.missing_quantity,
      available_quantity: unavailable ? 0 : Math.max(0, base - iu - rs - bl),
    };
  };
}

/**
 * Keep equipment.available_quantity (data-model column) in sync with the live
 * snapshot. Called after every booking/issue/return/maintenance change and by the scheduler.
 */
export function syncAvailableQuantities() {
  const snap = equipmentSnapshots();
  tx(() => {
    for (const eq of all('SELECT * FROM equipment')) {
      const a = snap(eq).available_quantity;
      if (a !== eq.available_quantity) run('UPDATE equipment SET available_quantity = ? WHERE equipment_id = ?', a, eq.equipment_id);
    }
  });
}

// ---------------------------------------------------------------------------
// Live lab status (Available / Reserved / In Use / Maintenance / Closed)
// ---------------------------------------------------------------------------
export function liveLabStatuses() {
  const now = nowLocal();
  const current = all(
    `SELECT b.booking_id AS id, b.lab_id, b.booking_status AS status, b.start_at, b.end_at, b.attendees, b.purpose, b.ref_code, u.name AS user_name
       FROM bookings b JOIN users u ON u.id = b.user_id
      WHERE b.lab_id IS NOT NULL AND b.booking_status IN ('approved','reserved','in_use','overdue')
        AND b.start_at <= ? AND b.end_at > ?`,
    now,
    now,
  );
  const next = all(
    `SELECT b.lab_id, MIN(b.start_at) AS start_at FROM bookings b
      WHERE b.lab_id IS NOT NULL AND b.booking_status IN ('approved','reserved') AND b.start_at > ? AND b.start_at < ?
      GROUP BY b.lab_id`,
    now,
    `${today()}T23:59`,
  );
  const blocks = all(
    `SELECT resource_id, title, kind, end_at FROM resource_blocks WHERE resource_type = 'lab'
       AND status IN ('scheduled','in_progress') AND start_at <= ? AND end_at > ?`,
    now,
    now,
  );
  const byLab = new Map(current.map((b) => [b.lab_id, b]));
  const nextByLab = new Map(next.map((n) => [n.lab_id, n.start_at]));
  const blockByLab = new Map(blocks.map((b) => [b.resource_id, b]));
  const nowMin = toMinutes(timeOf(now));
  const rules = getRules(0);
  const closedToday = rules.closed_weekdays_list.includes(weekday(today()));

  return (lab) => {
    const id = lab.lab_id ?? lab.id;
    const booking = byLab.get(id) || null;
    const block = blockByLab.get(id) || null;
    let live = 'available';
    if (lab.status === 'closed' || closedToday || nowMin < toMinutes(lab.open_time) || nowMin >= toMinutes(lab.close_time)) live = 'closed';
    if (lab.status === 'maintenance' || block) live = 'maintenance';
    else if (booking) live = booking.status === 'in_use' || booking.status === 'overdue' ? 'in_use' : 'reserved';
    return {
      live_status: live,
      current_booking: booking,
      current_block: block,
      next_booking_at: nextByLab.get(id) || null,
      occupancy: booking && booking.status === 'in_use' ? Math.min(100, Math.round((booking.attendees / lab.capacity) * 100)) : 0,
    };
  };
}
