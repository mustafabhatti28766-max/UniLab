import { Router } from 'express';
import { all, get, insert, run, updateRow, EQ_COLS } from '../db.js';
import { authenticate, assertCanManage, canManage, hasPerm } from '../middleware/auth.js';
import { HttpError, badRequest, notFound, oneOf, requireFields, toInt } from '../utils/http.js';
import { equipmentAvailability, equipmentSnapshots, syncAvailableQuantities } from '../services/availability.js';
import { BOOKING_SELECT, redactBooking, withItems } from '../services/serialize.js';
import { logActivity } from '../services/notify.js';
import { addDays, fromMinutes, isDate, isTime, nowLocal, today, toMinutes } from '../utils/time.js';

const router = Router();
router.use(authenticate);

const EQ_SQL = `
  SELECT ${EQ_COLS()}, c.icon AS category_icon, l.lab_name AS lab_name, l.code AS lab_code, l.location AS lab_location,
    l.department_id, l.open_time, l.close_time, d.code AS department_code
  FROM equipment e LEFT JOIN categories c ON c.id = e.category_id LEFT JOIN labs l ON l.lab_id = e.lab_id
  LEFT JOIN departments d ON d.id = l.department_id`;

router.get('/', (req, res) => {
  const where = [];
  const params = [];
  const filters = { category_id: 'e.category_id', lab_id: 'e.lab_id', department_id: 'l.department_id', maintenance_status: 'e.maintenance_status' };
  for (const [q, col] of Object.entries(filters)) {
    if (req.query[q]) {
      where.push(`${col} = ?`);
      params.push(req.query[q]);
    }
  }
  if (req.query.q) {
    where.push('(e.equipment_name LIKE ? OR e.code LIKE ? OR e.category LIKE ? OR e.description LIKE ?)');
    const q = `%${req.query.q}%`;
    params.push(q, q, q, q);
  }
  const snap = equipmentSnapshots();
  const { date, start_time, end_time } = req.query;
  const windowed = isDate(date) && isTime(start_time) && isTime(end_time) && end_time > start_time;
  let rows = all(`${EQ_SQL}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY e.category, e.equipment_name`, ...params).map((e) => {
    const out = { ...e, ...snap(e) };
    if (windowed) out.window_available = equipmentAvailability(e, `${date}T${start_time}`, `${date}T${end_time}`).available;
    return out;
  });
  if (req.query.available_only === '1') rows = rows.filter((e) => (windowed ? e.window_available : e.available_quantity) > 0);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const eq = get(`${EQ_SQL} WHERE e.equipment_id = ?`, req.params.id);
  if (!eq) throw notFound('Equipment');
  const snap = equipmentSnapshots();
  const upcoming = withItems(
    all(
      `${BOOKING_SELECT} WHERE b.booking_id IN (SELECT booking_id FROM booking_items WHERE equipment_id = ?)
         AND b.booking_status IN ('pending','approved','reserved','in_use','overdue') AND b.end_at > ? AND b.booking_date <= ?
       ORDER BY b.start_at LIMIT 30`,
      eq.id,
      nowLocal(),
      addDays(today(), 14),
    ),
  ).map((b) => ({ ...redactBooking(b, req.user), quantity: b.items.find((i) => i.equipment_id === eq.id)?.quantity }));
  const monitor = canManage(req.user, eq.department_id, 'bookings.view_all');
  const damage = all(
    `SELECT r.*, u.name AS reported_by_name, ru.name AS responsible_name, b.ref_code FROM damage_reports r
       LEFT JOIN users u ON u.id = r.reported_by LEFT JOIN users ru ON ru.id = r.responsible_user_id LEFT JOIN bookings b ON b.booking_id = r.booking_id
      WHERE r.equipment_id = ? ORDER BY r.created_at DESC LIMIT 20`,
    eq.id,
  );
  const outstanding = monitor
    ? all(
        `SELECT i.*, i.issue_id AS id, b.ref_code, b.booking_status AS booking_status, u.name AS user_name FROM issues i
           JOIN bookings b ON b.booking_id = i.booking_id JOIN users u ON u.id = b.user_id
          WHERE i.equipment_id = ? AND i.returned_at IS NULL ORDER BY i.due_at`,
        eq.id,
      )
    : [];
  const activity = hasPerm(req.user, 'activity.view')
    ? all(
        `SELECT a.*, u.name AS actor_name FROM activity_log a LEFT JOIN users u ON u.id = a.actor_id
          WHERE a.entity_type = 'equipment' AND a.entity_id = ? ORDER BY a.id DESC LIMIT 40`,
        eq.id,
      )
    : [];
  const blocks = all(
    `SELECT * FROM resource_blocks WHERE resource_type = 'equipment' AND resource_id = ? AND status IN ('scheduled','in_progress') AND end_at > ? ORDER BY start_at`,
    eq.id,
    nowLocal(),
  );
  const usage = get(
    `SELECT COUNT(DISTINCT b.booking_id) AS bookings, COALESCE(SUM(bi.quantity),0) AS units FROM booking_items bi JOIN bookings b ON b.booking_id = bi.booking_id
      WHERE bi.equipment_id = ? AND b.booking_status IN ('completed','returned_late','damaged','in_use','overdue')`,
    eq.id,
  );
  res.json({
    ...eq,
    ...snap(eq),
    upcoming,
    damage_reports: damage,
    outstanding,
    activity,
    blocks,
    usage,
    can_manage: canManage(req.user, eq.department_id, 'equipment.manage'),
    can_maintain: canManage(req.user, eq.department_id, 'maintenance.manage'),
    can_block: canManage(req.user, eq.department_id, 'labs.availability'),
  });
});

/** Units available per 30-minute slot for a date — drives the availability chart. */
router.get('/:id/availability', (req, res) => {
  const eq = get(`${EQ_SQL} WHERE e.equipment_id = ?`, req.params.id);
  if (!eq) throw notFound('Equipment');
  const date = isDate(req.query.date) ? req.query.date : today();
  const open = toMinutes(eq.open_time || '08:00');
  const close = toMinutes(eq.close_time || '20:00');
  const slots = [];
  for (let t = open; t < close; t += 30) {
    const s = `${date}T${fromMinutes(t)}`;
    const e = `${date}T${fromMinutes(t + 30)}`;
    slots.push({ time: fromMinutes(t), available: equipmentAvailability(eq, s, e).available });
  }
  res.json({ date, total: eq.total_quantity, slots });
});

function eqFields(body, { partial = false } = {}) {
  if (!partial) requireFields(body, ['code', 'name', 'category_id', 'lab_id', 'total_quantity']);
  const f = {};
  if (body.code !== undefined) f.code = String(body.code).trim().toUpperCase();
  const name = body.equipment_name ?? body.name;
  if (name !== undefined) f.equipment_name = String(name).trim();
  if (body.category_id !== undefined) {
    f.category_id = Number(body.category_id) || null;
    f.category = f.category_id ? get('SELECT name FROM categories WHERE id = ?', f.category_id)?.name ?? null : null;
  }
  if (body.lab_id !== undefined) f.lab_id = Number(body.lab_id) || null;
  if (body.description !== undefined) f.description = body.description || null;
  if (body.total_quantity !== undefined) {
    f.total_quantity = toInt(body.total_quantity, -1);
    if (f.total_quantity < 0 || f.total_quantity > 10000) throw badRequest('Total quantity must be between 0 and 10000');
  }
  if (body.condition !== undefined) f.condition = oneOf(body.condition, ['new', 'good', 'fair', 'poor'], 'condition');
  if (body.maintenance_status !== undefined) {
    f.maintenance_status = oneOf(body.maintenance_status, ['operational', 'needs_inspection', 'under_maintenance', 'retired'], 'maintenance status');
  }
  if (body.approval_level !== undefined) f.approval_level = oneOf(body.approval_level, ['none', 'staff', 'coordinator'], 'approval level');
  if (body.max_per_booking !== undefined) f.max_per_booking = toInt(body.max_per_booking, null) || null;
  if (body.restricted_to_department !== undefined) f.restricted_to_department = body.restricted_to_department ? 1 : 0;
  return f;
}

const labDept = (labId) => get('SELECT department_id FROM labs WHERE lab_id = ?', labId)?.department_id;

router.post('/', (req, res) => {
  const f = eqFields(req.body);
  assertCanManage(req.user, labDept(f.lab_id), 'equipment.manage');
  if (get('SELECT equipment_id FROM equipment WHERE code = ?', f.code)) throw new HttpError(409, 'Equipment code already exists');
  const keys = Object.keys(f);
  const id = insert(`INSERT INTO equipment (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => f[k]));
  syncAvailableQuantities();
  logActivity(req.user.id, 'equipment', id, 'created', { code: f.code, quantity: f.total_quantity });
  res.status(201).json(get(`${EQ_SQL} WHERE e.equipment_id = ?`, id));
});

router.put('/:id', (req, res) => {
  const eq = get(`${EQ_SQL} WHERE e.equipment_id = ?`, req.params.id);
  if (!eq) throw notFound('Equipment');
  assertCanManage(req.user, eq.department_id, 'equipment.manage');
  const f = eqFields(req.body, { partial: true });
  if (f.lab_id && f.lab_id !== eq.lab_id) assertCanManage(req.user, labDept(f.lab_id), 'equipment.manage');
  if (f.code && get('SELECT equipment_id FROM equipment WHERE code = ? AND equipment_id != ?', f.code, eq.id)) throw new HttpError(409, 'Equipment code already exists');
  if (f.total_quantity !== undefined && f.total_quantity < eq.maintenance_quantity + eq.missing_quantity) {
    throw badRequest('Total quantity cannot be lower than units in maintenance plus missing units');
  }
  updateRow('equipment', eq.id, f);
  syncAvailableQuantities();
  logActivity(req.user.id, 'equipment', eq.id, 'updated', f);
  res.json(get(`${EQ_SQL} WHERE e.equipment_id = ?`, eq.id));
});

/** Maintenance desk: change status/condition, return repaired units, write off units. */
router.patch('/:id/maintenance', (req, res) => {
  const eq = get(`${EQ_SQL} WHERE e.equipment_id = ?`, req.params.id);
  if (!eq) throw notFound('Equipment');
  assertCanManage(req.user, eq.department_id, 'maintenance.manage');
  const f = {};
  const { maintenance_status, condition, repaired, found, written_off, to_maintenance, note } = req.body;
  if (maintenance_status) f.maintenance_status = oneOf(maintenance_status, ['operational', 'needs_inspection', 'under_maintenance', 'retired'], 'maintenance status');
  if (condition) f.condition = oneOf(condition, ['new', 'good', 'fair', 'poor'], 'condition');
  let maint = eq.maintenance_quantity;
  let missing = eq.missing_quantity;
  let total = eq.total_quantity;
  const n = (v) => Math.max(0, toInt(v, 0));
  if (n(to_maintenance)) {
    if (n(to_maintenance) > total - maint - missing) throw badRequest('Not enough working units to move into maintenance');
    maint += n(to_maintenance);
  }
  if (n(repaired)) {
    if (n(repaired) > maint) throw badRequest(`Only ${maint} unit(s) are in maintenance`);
    maint -= n(repaired);
  }
  if (n(found)) {
    if (n(found) > missing) throw badRequest(`Only ${missing} unit(s) are missing`);
    missing -= n(found);
  }
  if (written_off) {
    const wm = n(written_off.maintenance);
    const wx = n(written_off.missing);
    if (wm > maint || wx > missing) throw badRequest('Cannot write off more units than are in maintenance / missing');
    maint -= wm;
    missing -= wx;
    total -= wm + wx;
  }
  Object.assign(f, { maintenance_quantity: maint, missing_quantity: missing, total_quantity: total });
  if (n(repaired) || f.maintenance_status === 'operational') f.last_maintenance_at = nowLocal();
  updateRow('equipment', eq.id, f);
  syncAvailableQuantities();
  logActivity(req.user.id, 'equipment', eq.id, 'maintenance_update', { ...req.body, note });
  res.json(get(`${EQ_SQL} WHERE e.equipment_id = ?`, eq.id));
});

router.delete('/:id', (req, res) => {
  const eq = get(`${EQ_SQL} WHERE e.equipment_id = ?`, req.params.id);
  if (!eq) throw notFound('Equipment');
  assertCanManage(req.user, eq.department_id, 'equipment.manage');
  const active = get(
    `SELECT COUNT(*) AS n FROM booking_items bi JOIN bookings b ON b.booking_id = bi.booking_id
      WHERE bi.equipment_id = ? AND b.booking_status IN ('pending','approved','reserved','in_use','overdue')`,
    eq.id,
  ).n;
  if (active) throw new HttpError(409, `This equipment is part of ${active} active booking(s). Retire it instead.`);
  run('DELETE FROM equipment WHERE equipment_id = ?', eq.id);
  logActivity(req.user.id, 'equipment', eq.id, 'deleted', { code: eq.code });
  res.json({ ok: true });
});

export default router;
