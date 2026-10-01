import { Router } from 'express';
import { all, get, insert, run, tx, updateRow, getLab, getEquipmentRow } from '../db.js';
import { authenticate, assertCanManage, canManage, requirePerm, scopeDept } from '../middleware/auth.js';
import { imageUpload, parseMultipartData, uploadedPath } from '../middleware/upload.js';
import { badRequest, notFound, oneOf, requireFields, toInt } from '../utils/http.js';
import { BOOKING_SELECT, withItems } from '../services/serialize.js';
import { cancelBooking, getBookingRow } from '../services/bookings.js';
import { maintenanceRecommendations } from '../services/analytics.js';
import { logActivity, notify, notifyDepartment } from '../services/notify.js';
import { HOLDING_STATUSES, syncAvailableQuantities } from '../services/availability.js';
import { addDays, nowLocal, parseLocal, today } from '../utils/time.js';

const router = Router();
router.use(authenticate);

const deptWhere = (user, col = 'b.department_id') => {
  const dept = scopeDept(user);
  return dept ? ` AND ${col} = ${Number(dept)}` : '';
};

// ---------------------------------------------------------------------------
// Issue & return desk
// ---------------------------------------------------------------------------
router.get('/desk', requirePerm('bookings.issue'), (req, res) => {
  const now = nowLocal();
  const scope = deptWhere(req.user);
  const toIssue = withItems(
    all(`${BOOKING_SELECT} WHERE b.booking_status IN ('approved','reserved') AND b.booking_date = ? AND b.end_at > ?${scope} ORDER BY b.start_at`, today(), now),
  );
  const upcoming = withItems(
    all(
      `${BOOKING_SELECT} WHERE b.booking_status IN ('approved','reserved') AND b.booking_date > ? AND b.booking_date <= ?${scope} ORDER BY b.start_at LIMIT 25`,
      today(),
      addDays(today(), 3),
    ),
  );
  const inUse = withItems(all(`${BOOKING_SELECT} WHERE b.booking_status = 'in_use'${scope} ORDER BY b.end_at`));
  const overdue = withItems(all(`${BOOKING_SELECT} WHERE b.booking_status = 'overdue'${scope} ORDER BY b.end_at`));
  const returned = withItems(
    all(`${BOOKING_SELECT} WHERE b.booking_status IN ('completed','returned_late','damaged') AND b.completed_at IS NOT NULL${scope} ORDER BY b.completed_at DESC LIMIT 20`),
  );
  const issuesFor = (ids) =>
    ids.length
      ? all(
          `SELECT i.*, i.issue_id AS id, e.equipment_name AS equipment_name FROM issues i JOIN equipment e ON e.equipment_id = i.equipment_id
            WHERE i.booking_id IN (${ids.map(() => '?').join(',')})`,
          ...ids,
        )
      : [];
  const open = issuesFor([...inUse, ...overdue].map((b) => b.id));
  const attach = (list) => list.map((b) => ({ ...b, issues: open.filter((i) => i.booking_id === b.id) }));
  res.json({ to_issue: toIssue, upcoming, in_use: attach(inUse), overdue: attach(overdue), returned });
});

/** Unified lookup for the QR / ID-card scanner. */
router.get('/scan/:code', requirePerm('bookings.issue'), (req, res) => {
  const code = String(req.params.code).trim();
  const booking = get('SELECT booking_id FROM bookings WHERE qr_token = ? OR ref_code = ?', code, code.toUpperCase());
  if (booking) return res.json({ type: 'booking', id: booking.booking_id });
  const eq = get('SELECT equipment_id FROM equipment WHERE code = ?', code.toUpperCase());
  if (eq) return res.json({ type: 'equipment', id: eq.equipment_id });
  const user = get('SELECT id, name, email, role, student_id, late_return_count, restricted_until FROM users WHERE student_id = ?', code);
  if (user) {
    const bookings = withItems(
      all(
        `${BOOKING_SELECT} WHERE b.user_id = ? AND b.booking_status IN ('pending','approved','reserved','in_use','overdue') ORDER BY b.start_at`,
        user.id,
      ),
    ).filter((b) => canManage(req.user, b.department_id, 'bookings.issue'));
    return res.json({ type: 'user', user, bookings });
  }
  throw notFound('Nothing matches this code');
});

// ---------------------------------------------------------------------------
// Damage & fault reports
// ---------------------------------------------------------------------------
router.get('/damage-reports', requirePerm('maintenance.manage'), (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.status) {
    where.push('r.status = ?');
    params.push(req.query.status);
  }
  if (req.query.equipment_id) {
    where.push('r.equipment_id = ?');
    params.push(req.query.equipment_id);
  }
  res.json(
    all(
      `SELECT r.*, e.equipment_name AS equipment_name, e.code AS equipment_code, l.lab_name AS lab_name, u.name AS reported_by_name,
          ru.name AS responsible_name, b.ref_code
         FROM damage_reports r JOIN equipment e ON e.equipment_id = r.equipment_id LEFT JOIN labs l ON l.lab_id = e.lab_id
         LEFT JOIN users u ON u.id = r.reported_by LEFT JOIN users ru ON ru.id = r.responsible_user_id
         LEFT JOIN bookings b ON b.booking_id = r.booking_id
        WHERE ${where.join(' AND ')}${deptWhere(req.user, 'l.department_id')}
        ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'in_repair' THEN 1 ELSE 2 END, r.created_at DESC LIMIT 200`,
      ...params,
    ),
  );
});

/** Anyone can report a fault (e.g. a student whose borrowed kit stops working); staff triage it. */
router.post('/damage-reports', imageUpload.single('image'), (req, res) => {
  const body = parseMultipartData(req);
  requireFields(body, ['equipment_id', 'description']);
  const eq = get('SELECT e.*, e.equipment_id AS id, e.equipment_name AS name, l.department_id FROM equipment e LEFT JOIN labs l ON l.lab_id = e.lab_id WHERE e.equipment_id = ?', body.equipment_id);
  if (!eq) throw notFound('Equipment');
  const severity = oneOf(body.severity || 'medium', ['low', 'medium', 'high'], 'severity');
  const quantity = Math.max(1, Math.min(eq.total_quantity, toInt(body.quantity, 1)));
  const id = tx(() => {
    const rid = insert(
      `INSERT INTO damage_reports (equipment_id, booking_id, reported_by, kind, quantity, severity, description, image_path)
       VALUES (?, ?, ?, 'fault', ?, ?, ?, ?)`,
      eq.id,
      toInt(body.booking_id, null),
      req.user.id,
      quantity,
      severity,
      String(body.description).slice(0, 2000),
      uploadedPath(req),
    );
    if (eq.maintenance_status === 'operational') run(`UPDATE equipment SET maintenance_status = 'needs_inspection' WHERE equipment_id = ?`, eq.id);
    logActivity(req.user.id, 'equipment', eq.id, 'fault_reported', { severity, quantity });
    notifyDepartment(
      eq.department_id,
      ['staff'],
      { type: 'fault_reported', title: `Fault reported: ${eq.name}`, message: `${req.user.name}: ${String(body.description).slice(0, 140)}`, link: '/maintenance' },
      { excludeUserId: req.user.id },
    );
    return rid;
  });
  res.status(201).json(get('SELECT * FROM damage_reports WHERE id = ?', id));
});

router.patch('/damage-reports/:id', requirePerm('maintenance.manage'), (req, res) => {
  const r = get(
    'SELECT r.*, l.department_id FROM damage_reports r JOIN equipment e ON e.equipment_id = r.equipment_id LEFT JOIN labs l ON l.lab_id = e.lab_id WHERE r.id = ?',
    req.params.id,
  );
  if (!r) throw notFound('Report');
  assertCanManage(req.user, r.department_id, 'maintenance.manage');
  const status = oneOf(req.body.status, ['open', 'in_repair', 'resolved', 'written_off'], 'status');
  tx(() => {
    const closing = ['resolved', 'written_off'].includes(status) && !['resolved', 'written_off'].includes(r.status);
    if (closing && r.kind !== 'fault') {
      const eq = getEquipmentRow(r.equipment_id);
      const col = r.kind === 'missing' ? 'missing_quantity' : 'maintenance_quantity';
      const qty = Math.min(r.quantity, eq[col]);
      // Resolved: repaired / found → back in service. Written off: removed from inventory.
      const f = { [col]: eq[col] - qty };
      if (status === 'written_off') f.total_quantity = eq.total_quantity - qty;
      else if (r.kind === 'damaged') f.last_maintenance_at = nowLocal();
      updateRow('equipment', eq.id, f);
    }
    updateRow('damage_reports', r.id, { status, resolved_at: closing ? nowLocal() : null });
    logActivity(req.user.id, 'equipment', r.equipment_id, `damage_${status}`, { report: r.id, note: req.body.note });
  });
  syncAvailableQuantities();
  res.json(get('SELECT * FROM damage_reports WHERE id = ?', r.id));
});

// ---------------------------------------------------------------------------
// Temporary blocks & maintenance scheduling
// ---------------------------------------------------------------------------
function resourceInfo(type, id) {
  if (type === 'lab') {
    const lab = getLab(id);
    return lab && { id: lab.id, name: lab.name, department_id: lab.department_id };
  }
  return get('SELECT e.equipment_id AS id, e.equipment_name AS name, l.department_id FROM equipment e LEFT JOIN labs l ON l.lab_id = e.lab_id WHERE e.equipment_id = ?', id);
}

function affectedBookings(type, id, startAt, endAt) {
  const holding = HOLDING_STATUSES.map((s) => `'${s}'`).join(',');
  const sql =
    type === 'lab'
      ? `${BOOKING_SELECT} WHERE b.lab_id = ? AND b.booking_status IN (${holding},'pending') AND b.start_at < ? AND b.end_at > ?`
      : `${BOOKING_SELECT} WHERE b.booking_id IN (SELECT booking_id FROM booking_items WHERE equipment_id = ?) AND b.booking_status IN (${holding},'pending') AND b.start_at < ? AND b.end_at > ?`;
  return all(sql, id, endAt, startAt);
}

router.get('/blocks', requirePerm('labs.availability'), (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.resource_type) {
    where.push('k.resource_type = ?');
    params.push(req.query.resource_type);
  }
  if (req.query.resource_id) {
    where.push('k.resource_id = ?');
    params.push(req.query.resource_id);
  }
  if (req.query.upcoming === '1') {
    where.push(`k.status IN ('scheduled','in_progress') AND k.end_at > ?`);
    params.push(nowLocal());
  }
  const rows = all(
    `SELECT k.*, u.name AS created_by_name,
        CASE k.resource_type WHEN 'lab' THEN (SELECT lab_name FROM labs WHERE lab_id = k.resource_id) ELSE (SELECT equipment_name FROM equipment WHERE equipment_id = k.resource_id) END AS resource_name,
        CASE k.resource_type WHEN 'lab' THEN (SELECT department_id FROM labs WHERE lab_id = k.resource_id)
          ELSE (SELECT l.department_id FROM equipment e JOIN labs l ON l.lab_id = e.lab_id WHERE e.equipment_id = k.resource_id) END AS department_id
       FROM resource_blocks k LEFT JOIN users u ON u.id = k.created_by
      WHERE ${where.join(' AND ')} ORDER BY k.start_at DESC LIMIT 200`,
    ...params,
  );
  const dept = scopeDept(req.user);
  res.json(dept ? rows.filter((r) => r.department_id === dept) : rows);
});

router.post('/blocks', requirePerm('labs.availability'), (req, res) => {
  requireFields(req.body, ['resource_type', 'resource_id', 'title', 'start_at', 'end_at']);
  const type = oneOf(req.body.resource_type, ['lab', 'equipment'], 'resource type');
  const kind = oneOf(req.body.kind || 'block', ['block', 'maintenance'], 'kind');
  const resource = resourceInfo(type, req.body.resource_id);
  if (!resource) throw notFound(type === 'lab' ? 'Lab' : 'Equipment');
  assertCanManage(req.user, resource.department_id, 'labs.availability');
  const startAt = String(req.body.start_at).slice(0, 16);
  const endAt = String(req.body.end_at).slice(0, 16);
  if (Number.isNaN(parseLocal(startAt).getTime()) || Number.isNaN(parseLocal(endAt).getTime()) || endAt <= startAt) {
    throw badRequest('Choose a valid start and end time');
  }
  const affected = affectedBookings(type, resource.id, startAt, endAt);
  if (req.body.preview) return res.json({ affected });

  const id = tx(() => {
    const bid = insert(
      `INSERT INTO resource_blocks (resource_type, resource_id, kind, title, reason, start_at, end_at, quantity, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      type,
      resource.id,
      kind,
      String(req.body.title).trim(),
      req.body.reason || null,
      startAt,
      endAt,
      type === 'equipment' ? toInt(req.body.quantity, null) : null,
      startAt <= nowLocal() ? 'in_progress' : 'scheduled',
      req.user.id,
    );
    if (req.body.cancel_affected) {
      for (const b of affected) {
        if (['pending', 'approved', 'reserved'].includes(b.status)) cancelBooking(req.user, getBookingRow(b.id), `${resource.name} unavailable: ${req.body.title}`);
      }
    } else {
      for (const b of affected) {
        notify(b.user_id, {
          type: 'booking_at_risk',
          title: `Heads-up: ${resource.name} ${kind === 'maintenance' ? 'maintenance' : 'blocked'}`,
          message: `${resource.name} is scheduled for "${req.body.title}" during your booking ${b.ref_code}. Lab staff will contact you.`,
          link: `/bookings/${b.id}`,
        });
      }
    }
    logActivity(req.user.id, type, resource.id, kind === 'maintenance' ? 'maintenance_scheduled' : 'blocked', { title: req.body.title, startAt, endAt });
    return bid;
  });
  syncAvailableQuantities();
  res.status(201).json({ block: get('SELECT * FROM resource_blocks WHERE id = ?', id), affected: affected.length });
});

router.patch('/blocks/:id', requirePerm('labs.availability'), (req, res) => {
  const blk = get('SELECT * FROM resource_blocks WHERE id = ?', req.params.id);
  if (!blk) throw notFound('Block');
  assertCanManage(req.user, resourceInfo(blk.resource_type, blk.resource_id)?.department_id, 'labs.availability');
  const status = oneOf(req.body.status, ['scheduled', 'in_progress', 'completed', 'cancelled'], 'status');
  const f = { status };
  if (status === 'completed' && blk.end_at > nowLocal()) f.end_at = nowLocal();
  updateRow('resource_blocks', blk.id, f);
  if (status === 'completed' && blk.kind === 'maintenance' && blk.resource_type === 'equipment') {
    run('UPDATE equipment SET last_maintenance_at = ? WHERE equipment_id = ?', nowLocal(), blk.resource_id);
  }
  syncAvailableQuantities();
  logActivity(req.user.id, blk.resource_type, blk.resource_id, `block_${status}`, { block: blk.id });
  res.json(get('SELECT * FROM resource_blocks WHERE id = ?', blk.id));
});

router.get('/maintenance/recommendations', requirePerm('maintenance.manage'), (req, res) => {
  res.json(maintenanceRecommendations({ departmentId: scopeDept(req.user, req.query.department_id) }));
});

export default router;
