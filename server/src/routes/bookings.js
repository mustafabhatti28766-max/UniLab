import { Router } from 'express';
import { all, get, tx } from '../db.js';
import { authenticate, canManage, hasPerm, requirePerm, scopeDept } from '../middleware/auth.js';
import { imageUpload, parseMultipartData, uploadedPath } from '../middleware/upload.js';
import { badRequest, forbidden, notFound, toInt } from '../utils/http.js';
import { BOOKING_SELECT, canSeeBooking, withItems } from '../services/serialize.js';
import {
  REJECTION_CATEGORIES, approveBooking, cancelBooking, checkInBooking, completeBooking, createBooking, escalateBooking,
  evaluateBooking, getBookingRow, inputFromBooking, normalizeInput, pendingConflictInfo, rejectBooking, returnBooking,
  submitDraft, updateDraft,
} from '../services/bookings.js';
import { bookingToEvent, calendar } from '../utils/ics.js';
import { isDate, isTime, nowLocal } from '../utils/time.js';

const router = Router();
router.use(authenticate);

export const STATUSES = ['draft', 'pending', 'approved', 'reserved', 'in_use', 'completed', 'rejected', 'cancelled', 'overdue', 'returned_late', 'damaged'];

/** WHERE fragment limiting staff/coordinators to their department (admins: optional filter). */
function deptScope(user, query, where, params) {
  const dept = scopeDept(user, query.department_id);
  if (dept) {
    where.push('b.department_id = ?');
    params.push(dept);
  }
}

function loadDetailed(id) {
  const b = get(`${BOOKING_SELECT} WHERE b.booking_id = ?`, id);
  if (!b) throw notFound('Booking');
  return withItems([b])[0];
}

function permissions(user, b) {
  const owner = b.user_id === user.id;
  const can = (perm) => canManage(user, b.department_id, perm);
  const now = nowLocal();
  return {
    can_edit: owner && b.status === 'draft',
    can_submit: owner && b.status === 'draft',
    can_cancel: (owner || can('bookings.approve')) && ['draft', 'pending', 'approved', 'reserved'].includes(b.status),
    can_approve: can('bookings.approve') && b.status === 'pending' && (b.required_approval !== 'coordinator' || hasPerm(user, 'bookings.approve_coordinator')),
    can_reject: can('bookings.approve') && b.status === 'pending',
    can_escalate: can('bookings.approve') && b.status === 'pending' && b.required_approval !== 'coordinator' && !hasPerm(user, 'bookings.approve_coordinator'),
    can_check_in: can('bookings.issue') && ['approved', 'reserved'].includes(b.status) && now < b.end_at,
    can_return: can('bookings.issue') && ['in_use', 'overdue'].includes(b.status) && (b.items?.length || 0) > 0,
    can_complete: can('bookings.issue') && b.status === 'in_use' && !(b.items?.length > 0),
    is_owner: owner,
    is_manager: can('bookings.view_all') || can('bookings.approve') || can('bookings.issue'),
  };
}

// ---- Availability & rules check (live, used by the booking form) ----
router.post('/check', requirePerm('bookings.create'), (req, res) => {
  const input = normalizeInput(req.body);
  res.json(evaluateBooking(req.user, input, { excludeId: toInt(req.body.exclude_id, 0) }));
});

// ---- Lists: search & filter by lab, equipment, department, category, date, time, status ----
router.get('/', (req, res) => {
  const where = ["(b.booking_status != 'draft' OR b.user_id = ?)"];
  const params = [req.user.id];
  const scope = req.query.scope === 'all' || req.query.scope === 'manage' ? 'all' : 'mine';
  if (scope === 'mine') {
    where.push('b.user_id = ?');
    params.push(req.user.id);
  } else {
    if (!hasPerm(req.user, 'bookings.view_all')) throw forbidden();
    deptScope(req.user, req.query, where, params);
    if (req.query.user_id) {
      where.push('b.user_id = ?');
      params.push(req.query.user_id);
    }
  }
  if (req.query.status) {
    const list = String(req.query.status).split(',').filter((s) => STATUSES.includes(s));
    if (list.length) where.push(`b.booking_status IN (${list.map((s) => `'${s}'`).join(',')})`);
  }
  if (req.query.approval_status) {
    where.push('b.approval_status = ?');
    params.push(req.query.approval_status);
  }
  if (req.query.when === 'upcoming') {
    where.push('b.end_at > ?');
    params.push(nowLocal());
  } else if (req.query.when === 'past') {
    where.push('b.end_at <= ?');
    params.push(nowLocal());
  }
  if (isDate(req.query.from)) {
    where.push('b.booking_date >= ?');
    params.push(req.query.from);
  }
  if (isDate(req.query.to)) {
    where.push('b.booking_date <= ?');
    params.push(req.query.to);
  }
  // Time filter: bookings that overlap the given time-of-day window.
  if (isTime(req.query.start_time)) {
    where.push('b.end_time > ?');
    params.push(req.query.start_time);
  }
  if (isTime(req.query.end_time)) {
    where.push('b.start_time < ?');
    params.push(req.query.end_time);
  }
  if (req.query.lab_id) {
    where.push('b.lab_id = ?');
    params.push(req.query.lab_id);
  }
  if (req.query.resource_type) {
    where.push('b.resource_type = ?');
    params.push(req.query.resource_type);
  }
  if (req.query.equipment_id) {
    where.push('b.booking_id IN (SELECT booking_id FROM booking_items WHERE equipment_id = ?)');
    params.push(req.query.equipment_id);
  }
  if (req.query.category_id) {
    where.push('b.booking_id IN (SELECT bi.booking_id FROM booking_items bi JOIN equipment e ON e.equipment_id = bi.equipment_id WHERE e.category_id = ?)');
    params.push(req.query.category_id);
  }
  if (req.query.q) {
    where.push('(b.ref_code LIKE ? OR u.name LIKE ? OR l.lab_name LIKE ? OR b.purpose LIKE ? OR u.student_id LIKE ?)');
    const q = `%${req.query.q}%`;
    params.push(q, q, q, q, q);
  }
  const limit = Math.min(200, toInt(req.query.limit, 50));
  const offset = Math.max(0, toInt(req.query.offset, 0));
  const order = req.query.sort === 'asc' ? 'b.start_at ASC' : req.query.sort === 'created' ? 'b.created_at DESC' : 'b.start_at DESC';
  const whereSql = where.join(' AND ');
  const base = `FROM bookings b JOIN users u ON u.id = b.user_id LEFT JOIN labs l ON l.lab_id = b.lab_id WHERE ${whereSql}`;
  const total = get(`SELECT COUNT(*) AS n ${base}`, ...params).n;
  const counts = Object.fromEntries(all(`SELECT b.booking_status AS status, COUNT(*) AS n ${base} GROUP BY b.booking_status`, ...params).map((r) => [r.status, r.n]));
  const rows = withItems(all(`${BOOKING_SELECT} WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, limit, offset));
  res.json({ total, limit, offset, counts, data: rows });
});

/** Live booking activity feed (approval history across all bookings in scope). */
router.get('/activity', requirePerm('bookings.view_all'), (req, res) => {
  const dept = scopeDept(req.user, req.query.department_id);
  res.json(
    all(
      `SELECT ev.*, u.name AS actor_name, u.role AS actor_role, b.ref_code, b.booking_status AS status, bu.name AS user_name, l.lab_name AS lab_name
         FROM booking_events ev JOIN bookings b ON b.booking_id = ev.booking_id JOIN users bu ON bu.id = b.user_id
         LEFT JOIN users u ON u.id = ev.actor_id LEFT JOIN labs l ON l.lab_id = b.lab_id
        ${dept ? 'WHERE b.department_id = ?' : ''}
        ORDER BY ev.id DESC LIMIT ?`,
      ...(dept ? [dept] : []),
      Math.min(100, toInt(req.query.limit, 30)),
    ),
  );
});

/** Approval queue with priority recommendation and live conflict status. */
router.get('/approvals', requirePerm('bookings.approve'), (req, res) => {
  const where = [`b.booking_status = 'pending'`];
  const params = [];
  deptScope(req.user, req.query, where, params);
  if (req.query.level) {
    where.push('b.required_approval = ?');
    params.push(req.query.level);
  }
  const rows = withItems(all(`${BOOKING_SELECT} WHERE ${where.join(' AND ')} ORDER BY b.priority_score DESC, b.start_at ASC`, ...params));
  const coord = hasPerm(req.user, 'bookings.approve_coordinator');
  res.json(rows.map((b) => ({ ...b, conflict: pendingConflictInfo(b), can_approve: b.required_approval !== 'coordinator' || coord, can_escalate: !coord })));
});

/** Conflict center: overlapping pending requests grouped per lab, plus requests that can no longer be satisfied. */
router.get('/conflicts', requirePerm('conflicts.resolve'), (req, res) => {
  const where = [`b.booking_status = 'pending'`];
  const params = [];
  deptScope(req.user, req.query, where, params);
  const pending = withItems(all(`${BOOKING_SELECT} WHERE ${where.join(' AND ')} ORDER BY b.lab_id, b.start_at`, ...params));

  const groups = [];
  const byLab = new Map();
  for (const b of pending.filter((x) => x.lab_id)) {
    if (!byLab.has(b.lab_id)) byLab.set(b.lab_id, []);
    byLab.get(b.lab_id).push(b);
  }
  for (const list of byLab.values()) {
    let current = [];
    let currentEnd = '';
    for (const b of list) {
      if (current.length && b.start_at < currentEnd) {
        current.push(b);
        if (b.end_at > currentEnd) currentEnd = b.end_at;
      } else {
        if (current.length > 1) groups.push(current);
        current = [b];
        currentEnd = b.end_at;
      }
    }
    if (current.length > 1) groups.push(current);
  }
  const blocked = pending.map((b) => ({ ...b, conflict: pendingConflictInfo(b) })).filter((b) => !b.conflict.available);

  res.json({
    groups: groups.map((g) => ({
      lab_id: g[0].lab_id,
      lab_name: g[0].lab_name,
      date: g[0].booking_date,
      bookings: [...g].sort((a, b) => b.priority_score - a.priority_score),
      recommended_id: [...g].sort((a, b) => b.priority_score - a.priority_score || (a.created_at < b.created_at ? -1 : 1))[0].id,
    })),
    blocked,
  });
});

router.post('/conflicts/resolve', requirePerm('conflicts.resolve'), (req, res) => {
  const winner = getBookingRow(toInt(req.body.winner_id));
  const losers = (req.body.loser_ids || []).map((id) => getBookingRow(toInt(id)));
  const result = tx(() => ({
    approved: approveBooking(req.user, winner, req.body.note || 'Selected during conflict resolution'),
    rejected: losers.map((l) =>
      rejectBooking(req.user, l, req.body.reason || `Time slot allocated to a higher-priority request (${winner.ref_code}).`, 'priority'),
    ),
  }));
  res.json(result);
});

// ---- Lookup by QR token / reference ----
router.get('/qr/:token', requirePerm('bookings.issue'), (req, res) => {
  const row = get('SELECT booking_id FROM bookings WHERE qr_token = ? OR ref_code = ?', req.params.token, String(req.params.token).toUpperCase());
  if (!row) throw notFound('Booking');
  const b = loadDetailed(row.booking_id);
  res.json({ ...b, permissions: permissions(req.user, b) });
});

// ---- Create ----
router.post('/', requirePerm('bookings.create'), (req, res) => {
  const { booking, evaluation } = createBooking(req.user, req.body);
  res.status(201).json({ booking: loadDetailed(booking.id), evaluation });
});

// ---- Detail ----
router.get('/:id', (req, res) => {
  const b = loadDetailed(req.params.id);
  const perms = permissions(req.user, b);
  if (!canSeeBooking(req.user, b) && !perms.is_manager) throw forbidden();
  const issues = all(
    `SELECT i.*, i.issue_id AS id, e.equipment_name AS equipment_name, e.code AS equipment_code, ib.name AS issued_by_name, rb.name AS received_by_name
       FROM issues i JOIN equipment e ON e.equipment_id = i.equipment_id
       LEFT JOIN users ib ON ib.id = i.issued_by LEFT JOIN users rb ON rb.id = i.received_by
      WHERE i.booking_id = ? ORDER BY i.issue_id`,
    b.id,
  );
  const events = all(
    `SELECT ev.*, u.name AS actor_name, u.role AS actor_role FROM booking_events ev LEFT JOIN users u ON u.id = ev.actor_id
      WHERE ev.booking_id = ? ORDER BY ev.id`,
    b.id,
  );
  const damage = all(
    `SELECT r.*, e.equipment_name AS equipment_name FROM damage_reports r JOIN equipment e ON e.equipment_id = r.equipment_id WHERE r.booking_id = ?`,
    b.id,
  );
  let conflict = null;
  if (b.status === 'pending' && perms.is_manager) conflict = pendingConflictInfo(b);
  res.json({ ...b, issues, events, damage_reports: damage, conflict, permissions: perms, rejection_categories: REJECTION_CATEGORIES });
});

router.get('/:id/ics', (req, res) => {
  const b = loadDetailed(req.params.id);
  if (!canSeeBooking(req.user, b)) throw forbidden();
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${b.ref_code}.ics"`);
  res.send(calendar([bookingToEvent(b)], `UniLab ${b.ref_code}`));
});

router.put('/:id', (req, res) => {
  const b = getBookingRow(req.params.id);
  updateDraft(req.user, b, req.body);
  res.json(loadDetailed(b.id));
});

router.get('/:id/evaluate', (req, res) => {
  const b = getBookingRow(req.params.id);
  if (b.user_id !== req.user.id) throw forbidden();
  res.json(evaluateBooking(req.user, inputFromBooking(b), { excludeId: b.id }));
});

const action = (fn) => (req, res) => {
  const b = getBookingRow(req.params.id);
  fn(req, b);
  res.json(loadDetailed(b.id));
};

router.post('/:id/submit', action((req, b) => submitDraft(req.user, b)));
router.post('/:id/approve', action((req, b) => approveBooking(req.user, b, req.body?.note)));
router.post('/:id/reject', action((req, b) => rejectBooking(req.user, b, req.body?.reason, req.body?.category)));
router.post('/:id/escalate', action((req, b) => escalateBooking(req.user, b, req.body?.note)));
router.post('/:id/cancel', action((req, b) => cancelBooking(req.user, b, req.body?.reason)));
router.post('/:id/check-in', action((req, b) => checkInBooking(req.user, b)));
router.post('/:id/complete', action((req, b) => completeBooking(req.user, b)));
router.post(
  '/:id/return',
  imageUpload.single('image'),
  action((req, b) => {
    const payload = parseMultipartData(req);
    if (!Array.isArray(payload.items)) throw badRequest('Return items are required');
    returnBooking(req.user, b, payload, uploadedPath(req));
  }),
);

export default router;
