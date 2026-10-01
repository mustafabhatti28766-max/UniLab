import { Router } from 'express';
import { all, get, insert, run, updateRow, LAB_COLS, EQ_COLS, getLab } from '../db.js';
import { authenticate, assertCanManage, canManage, hasPerm } from '../middleware/auth.js';
import { HttpError, badRequest, forbidden, notFound, oneOf, requireFields, toInt } from '../utils/http.js';
import { checkLab, equipmentSnapshots, liveLabStatuses } from '../services/availability.js';
import { labUtilization } from '../services/recommend.js';
import { BOOKING_SELECT, redactBooking, serializeLab, withItems } from '../services/serialize.js';
import { logActivity } from '../services/notify.js';
import { addDays, isDate, isTime, nowLocal, today } from '../utils/time.js';

const router = Router();
router.use(authenticate);

const LAB_SQL = `
  SELECT ${LAB_COLS()}, d.code AS department_code, d.name AS department_name, u.name AS incharge_name,
    (SELECT COUNT(*) FROM equipment e WHERE e.lab_id = l.lab_id) AS equipment_count
  FROM labs l LEFT JOIN departments d ON d.id = l.department_id LEFT JOIN users u ON u.id = l.incharge_id`;

router.get('/', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.department_id) {
    where.push('l.department_id = ?');
    params.push(req.query.department_id);
  }
  if (req.query.q) {
    where.push('(l.lab_name LIKE ? OR l.code LIKE ? OR l.location LIKE ? OR l.facilities LIKE ? OR l.description LIKE ?)');
    const q = `%${req.query.q}%`;
    params.push(q, q, q, q, q);
  }
  if (req.query.min_capacity) {
    where.push('l.capacity >= ?');
    params.push(toInt(req.query.min_capacity, 0));
  }
  const live = liveLabStatuses();
  const util = labUtilization(30);
  const { date, start_time, end_time } = req.query;
  const windowed = isDate(date) && isTime(start_time) && isTime(end_time) && end_time > start_time;

  let labs = all(`${LAB_SQL}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY d.code, l.lab_name`, ...params).map((lab) => {
    const out = { ...serializeLab(lab), ...live(lab), utilization: Math.round((util.get(lab.id) || 0) * 100) };
    if (windowed) {
      const check = checkLab(lab, `${date}T${start_time}`, `${date}T${end_time}`);
      out.window = { available: check.available, problems: check.problems.map((p) => p.message) };
    }
    return out;
  });
  if (req.query.status) labs = labs.filter((l) => l.live_status === req.query.status);
  if (windowed && req.query.available_only === '1') labs = labs.filter((l) => l.window.available);
  res.json(labs);
});

router.get('/:id', (req, res) => {
  const lab = get(`${LAB_SQL} WHERE l.lab_id = ?`, req.params.id);
  if (!lab) throw notFound('Lab');
  const snap = equipmentSnapshots();
  const equipment = all(`SELECT ${EQ_COLS()} FROM equipment e WHERE e.lab_id = ? ORDER BY e.category, e.equipment_name`, lab.id).map((e) => ({ ...e, ...snap(e) }));
  const upcoming = withItems(
    all(
      `${BOOKING_SELECT} WHERE b.lab_id = ? AND b.booking_status IN ('pending','approved','reserved','in_use','overdue')
         AND b.end_at > ? AND b.booking_date <= ? ORDER BY b.start_at LIMIT 30`,
      lab.id,
      nowLocal(),
      addDays(today(), 14),
    ),
  ).map((b) => redactBooking(b, req.user));
  const blocks = all(
    `SELECT * FROM resource_blocks WHERE resource_type = 'lab' AND resource_id = ? AND status IN ('scheduled','in_progress') AND end_at > ? ORDER BY start_at`,
    lab.id,
    nowLocal(),
  );
  const stats = get(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN booking_status IN ('completed','returned_late','damaged') THEN 1 ELSE 0 END) AS completed
       FROM bookings WHERE lab_id = ? AND booking_status != 'draft'`,
    lab.id,
  );
  res.json({
    ...serializeLab(lab),
    ...liveLabStatuses()(lab),
    utilization: Math.round((labUtilization(30).get(lab.id) || 0) * 100),
    equipment,
    upcoming,
    blocks,
    stats,
    can_manage: canManage(req.user, lab.department_id, 'labs.manage'),
    can_manage_availability: canManage(req.user, lab.department_id, 'labs.availability'),
    can_manage_equipment: canManage(req.user, lab.department_id, 'equipment.manage'),
  });
});

router.get('/:id/schedule', (req, res) => {
  const lab = getLab(req.params.id);
  if (!lab) throw notFound('Lab');
  const date = isDate(req.query.date) ? req.query.date : today();
  const bookings = withItems(
    all(
      `${BOOKING_SELECT} WHERE b.lab_id = ? AND b.booking_date = ? AND b.booking_status IN ('pending','approved','reserved','in_use','overdue','completed','returned_late','damaged')
       ORDER BY b.start_at`,
      lab.id,
      date,
    ),
  ).map((b) => redactBooking(b, req.user));
  const blocks = all(
    `SELECT * FROM resource_blocks WHERE resource_type = 'lab' AND resource_id = ? AND status != 'cancelled' AND start_at < ? AND end_at > ?`,
    lab.id,
    `${date}T23:59`,
    `${date}T00:00`,
  );
  res.json({ date, open_time: lab.open_time, close_time: lab.close_time, bookings, blocks });
});

function labFields(body, { partial = false } = {}) {
  const f = {};
  if (!partial) requireFields(body, ['code', 'name', 'department_id', 'capacity']);
  if (body.code !== undefined) f.code = String(body.code).trim().toUpperCase();
  const name = body.lab_name ?? body.name;
  if (name !== undefined) f.lab_name = String(name).trim();
  if (body.department_id !== undefined) f.department_id = Number(body.department_id) || null;
  if (body.capacity !== undefined) {
    f.capacity = toInt(body.capacity, 0);
    if (f.capacity < 1 || f.capacity > 1000) throw badRequest('Capacity must be between 1 and 1000');
  }
  if (body.location !== undefined) f.location = body.location || null;
  if (body.description !== undefined) f.description = body.description || null;
  if (body.facilities !== undefined) {
    const list = Array.isArray(body.facilities) ? body.facilities : String(body.facilities).split(',');
    f.facilities = JSON.stringify(list.map((s) => String(s).trim()).filter(Boolean));
  }
  if (body.status !== undefined) f.status = oneOf(body.status, ['available', 'maintenance', 'closed'], 'status');
  if (body.open_time !== undefined) {
    if (!isTime(body.open_time)) throw badRequest('Invalid opening time');
    f.open_time = body.open_time;
  }
  if (body.close_time !== undefined) {
    if (!isTime(body.close_time)) throw badRequest('Invalid closing time');
    f.close_time = body.close_time;
  }
  if (f.open_time && f.close_time && f.close_time <= f.open_time) throw badRequest('Closing time must be after opening time');
  if (body.approval_level !== undefined) f.approval_level = oneOf(body.approval_level, ['none', 'staff', 'coordinator'], 'approval level');
  if (body.restricted_to_department !== undefined) f.restricted_to_department = body.restricted_to_department ? 1 : 0;
  if (body.incharge_id !== undefined) f.incharge_id = Number(body.incharge_id) || null;
  return f;
}

router.post('/', (req, res) => {
  const f = labFields(req.body);
  assertCanManage(req.user, f.department_id, 'labs.manage');
  if (get('SELECT lab_id FROM labs WHERE code = ?', f.code)) throw new HttpError(409, 'Lab code already exists');
  const keys = Object.keys(f);
  const id = insert(`INSERT INTO labs (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map((k) => f[k]));
  logActivity(req.user.id, 'lab', id, 'created', { code: f.code });
  res.status(201).json(serializeLab(get(`${LAB_SQL} WHERE l.lab_id = ?`, id)));
});

router.put('/:id', (req, res) => {
  const lab = getLab(req.params.id);
  if (!lab) throw notFound('Lab');
  const f = labFields(req.body, { partial: true });
  // Changing only the status is "lab availability"; anything else needs full lab management.
  const statusOnly = Object.keys(f).every((k) => k === 'status');
  assertCanManage(req.user, lab.department_id, statusOnly && hasPerm(req.user, 'labs.availability') ? 'labs.availability' : 'labs.manage');
  if (f.department_id && f.department_id !== lab.department_id) assertCanManage(req.user, f.department_id, 'labs.manage');
  if (f.code && get('SELECT lab_id FROM labs WHERE code = ? AND lab_id != ?', f.code, lab.id)) throw new HttpError(409, 'Lab code already exists');
  if ((f.open_time || lab.open_time) >= (f.close_time || lab.close_time)) throw badRequest('Closing time must be after opening time');
  updateRow('labs', lab.id, f);
  logActivity(req.user.id, 'lab', lab.id, f.status && f.status !== lab.status ? `status_${f.status}` : 'updated', f);
  res.json(serializeLab(get(`${LAB_SQL} WHERE l.lab_id = ?`, lab.id)));
});

router.delete('/:id', (req, res) => {
  const lab = getLab(req.params.id);
  if (!lab) throw notFound('Lab');
  assertCanManage(req.user, lab.department_id, 'labs.manage');
  const active = get(`SELECT COUNT(*) AS n FROM bookings WHERE lab_id = ? AND booking_status IN ('pending','approved','reserved','in_use','overdue')`, lab.id).n;
  if (active) throw new HttpError(409, `This lab has ${active} active booking(s). Cancel them or close the lab instead.`);
  run('DELETE FROM labs WHERE lab_id = ?', lab.id);
  logActivity(req.user.id, 'lab', lab.id, 'deleted');
  res.json({ ok: true });
});

router.get('/:id/activity', (req, res) => {
  if (!hasPerm(req.user, 'activity.view')) throw forbidden();
  res.json(
    all(
      `SELECT a.*, u.name AS actor_name FROM activity_log a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.entity_type = 'lab' AND a.entity_id = ? ORDER BY a.id DESC LIMIT 50`,
      req.params.id,
    ),
  );
});

export default router;
