import crypto from 'node:crypto';
import { Router } from 'express';
import { all, get, insert, run, updateRow, LAB_COLS, getLab, getEquipmentRow } from '../db.js';
import { authenticate, canManage, hasPerm, requirePerm, requireRole, scopeDept } from '../middleware/auth.js';
import { badRequest, forbidden, notFound, oneOf, toInt } from '../utils/http.js';
import { getRuleOverview, getRules, saveRules } from '../services/rules.js';
import { overview, predictDemand, maintenanceRecommendations } from '../services/analytics.js';
import { recommendLabs, findAlternativeSlots, equipmentAlternatives } from '../services/recommend.js';
import { equipmentAvailability, liveLabStatuses } from '../services/availability.js';
import { permissionMatrix, resetPermissions, savePermissions } from '../services/permissions.js';
import { removeSubscription, saveSubscription, vapidPublicKey } from '../services/push.js';
import { BOOKING_SELECT, redactBooking, serializeLab, withItems } from '../services/serialize.js';
import { logActivity } from '../services/notify.js';
import { bookingToEvent, calendar } from '../utils/ics.js';
import { addDays, isDate, isTime, nowLocal, today } from '../utils/time.js';

// ---------------------------------------------------------------------------
// Public: calendar subscription feed (calendar apps can't send auth headers,
// so each user gets a secret, revocable feed token).
// ---------------------------------------------------------------------------
export const publicRouter = Router();
publicRouter.get('/calendar/feed/:token.ics', (req, res) => {
  const user = get('SELECT id, name FROM users WHERE calendar_token = ? AND is_active = 1', req.params.token);
  if (!user) throw notFound('Calendar feed');
  const rows = withItems(
    all(
      `${BOOKING_SELECT} WHERE b.user_id = ? AND b.booking_status IN ('pending','approved','reserved','in_use','overdue','completed') AND b.booking_date >= ?
       ORDER BY b.start_at`,
      user.id,
      addDays(today(), -60),
    ),
  );
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(calendar(rows.map(bookingToEvent), `UniLab — ${user.name}`));
});

const router = Router();
router.use(authenticate);

// ---------------------------------------------------------------------------
// Notifications & web push
// ---------------------------------------------------------------------------
router.get('/notifications', (req, res) => {
  const limit = Math.min(100, toInt(req.query.limit, 30));
  const where = req.query.unread === '1' ? 'AND is_read = 0' : '';
  res.json({
    unread: get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', req.user.id).n,
    data: all(`SELECT * FROM notifications WHERE user_id = ? ${where} ORDER BY id DESC LIMIT ?`, req.user.id, limit),
  });
});
router.get('/notifications/unread-count', (req, res) => {
  const latest = get('SELECT id, title, message, link FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 1', req.user.id);
  let pendingApprovals = null;
  if (hasPerm(req.user, 'bookings.approve')) {
    const dept = scopeDept(req.user);
    pendingApprovals = dept
      ? get(`SELECT COUNT(*) AS n FROM bookings WHERE booking_status = 'pending' AND department_id = ?`, dept).n
      : get(`SELECT COUNT(*) AS n FROM bookings WHERE booking_status = 'pending'`).n;
  }
  res.json({
    unread: get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0', req.user.id).n,
    latest: latest || null,
    pending_approvals: pendingApprovals,
  });
});
router.post('/notifications/read-all', (req, res) => {
  run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', req.user.id);
  res.json({ ok: true });
});
router.post('/notifications/:id/read', (req, res) => {
  run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  res.json({ ok: true });
});
router.delete('/notifications/:id', (req, res) => {
  run('DELETE FROM notifications WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  res.json({ ok: true });
});

router.get('/push/public-key', (_req, res) => res.json({ publicKey: vapidPublicKey }));
router.post('/push/subscribe', (req, res) => {
  if (!saveSubscription(req.user.id, req.body)) throw badRequest('Invalid push subscription');
  res.json({ ok: true });
});
router.post('/push/unsubscribe', (req, res) => {
  if (req.body?.endpoint) removeSubscription(req.body.endpoint);
  res.json({ ok: true });
});
router.get('/push/status', (req, res) => res.json({ devices: get('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', req.user.id).n }));

// ---------------------------------------------------------------------------
// Calendar integration
// ---------------------------------------------------------------------------
router.get('/calendar/my.ics', (req, res) => {
  const rows = withItems(
    all(
      `${BOOKING_SELECT} WHERE b.user_id = ? AND b.booking_status IN ('pending','approved','reserved','in_use','overdue','completed') AND b.booking_date >= ?
       ORDER BY b.start_at`,
      req.user.id,
      addDays(today(), -30),
    ),
  );
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="unilab.ics"');
  res.send(calendar(rows.map(bookingToEvent), `UniLab — ${req.user.name}`));
});

/** Subscription URL for Google / Outlook / Apple Calendar (auto-refreshing feed). */
router.get('/calendar/feed', (req, res) => {
  let token = get('SELECT calendar_token FROM users WHERE id = ?', req.user.id).calendar_token;
  if (!token || req.query.regenerate === '1') {
    token = crypto.randomBytes(24).toString('hex');
    updateRow('users', req.user.id, { calendar_token: token });
  }
  res.json({ path: `/api/calendar/feed/${token}.ics` });
});

// ---------------------------------------------------------------------------
// Waitlist for fully booked labs / equipment
// ---------------------------------------------------------------------------
const WAITLIST_SQL = `
  SELECT w.*, u.name AS user_name,
    CASE w.resource_type WHEN 'lab' THEN (SELECT lab_name FROM labs WHERE lab_id = w.resource_id)
      ELSE (SELECT equipment_name FROM equipment WHERE equipment_id = w.resource_id) END AS resource_name
  FROM waitlist w JOIN users u ON u.id = w.user_id`;

router.get('/waitlist', (req, res) => {
  if (req.query.scope === 'manage' && hasPerm(req.user, 'bookings.view_all')) {
    return res.json(all(`${WAITLIST_SQL} WHERE w.status IN ('waiting','notified') ORDER BY w.start_at`));
  }
  res.json(all(`${WAITLIST_SQL} WHERE w.user_id = ? ORDER BY w.status = 'waiting' DESC, w.start_at DESC LIMIT 100`, req.user.id));
});

router.post('/waitlist', requirePerm('bookings.create'), (req, res) => {
  const type = oneOf(req.body.resource_type, ['lab', 'equipment'], 'resource type');
  const { booking_date, start_time, end_time } = req.body;
  if (!isDate(booking_date) || !isTime(start_time) || !isTime(end_time) || end_time <= start_time) throw badRequest('Choose a valid date and time');
  const startAt = `${booking_date}T${start_time}`;
  const endAt = `${booking_date}T${end_time}`;
  if (startAt <= nowLocal()) throw badRequest('That time has already passed');
  const resource = type === 'lab' ? getLab(req.body.resource_id) : getEquipmentRow(req.body.resource_id);
  if (!resource) throw notFound(type === 'lab' ? 'Lab' : 'Equipment');
  const quantity = type === 'equipment' ? Math.max(1, toInt(req.body.quantity, 1)) : 1;
  const exists = get(
    `SELECT id FROM waitlist WHERE user_id = ? AND resource_type = ? AND resource_id = ? AND start_at = ? AND status = 'waiting'`,
    req.user.id,
    type,
    resource.id,
    startAt,
  );
  if (exists) throw badRequest('You are already on the waitlist for this slot');
  const id = insert(
    'INSERT INTO waitlist (user_id, resource_type, resource_id, start_at, end_at, quantity, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
    req.user.id,
    type,
    resource.id,
    startAt,
    endAt,
    quantity,
    req.body.note || null,
  );
  insert(
    'INSERT INTO demand_misses (resource_type, resource_id, requested_qty, available_qty, start_at, user_id) VALUES (?, ?, ?, ?, ?, ?)',
    type,
    resource.id,
    quantity,
    0,
    startAt,
    req.user.id,
  );
  const position = get(
    `SELECT COUNT(*) AS n FROM waitlist WHERE resource_type = ? AND resource_id = ? AND status = 'waiting' AND start_at < ? AND end_at > ? AND id <= ?`,
    type,
    resource.id,
    endAt,
    startAt,
    id,
  ).n;
  res.status(201).json({ ...get(`${WAITLIST_SQL} WHERE w.id = ?`, id), position });
});

router.delete('/waitlist/:id', (req, res) => {
  const w = get('SELECT * FROM waitlist WHERE id = ?', req.params.id);
  if (!w) throw notFound('Waitlist entry');
  if (w.user_id !== req.user.id && !hasPerm(req.user, 'bookings.view_all')) throw forbidden();
  updateRow('waitlist', w.id, { status: 'cancelled' });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Booking rules & priority levels
// ---------------------------------------------------------------------------
router.get('/rules', (req, res) => {
  const dept = toInt(req.query.department_id, 0);
  if (req.query.effective === '1') return res.json(getRules(dept));
  res.json({ department_id: dept, rules: getRuleOverview(dept) });
});

router.put('/rules', requirePerm('rules.manage'), (req, res) => {
  const dept = toInt(req.body.department_id, 0);
  if (req.user.role !== 'admin' && dept !== req.user.department_id) throw forbidden('You can only set rules for your own department');
  saveRules(dept, req.body.values, req.user.id);
  logActivity(req.user.id, 'rules', dept, 'updated', req.body.values);
  res.json({ department_id: dept, rules: getRuleOverview(dept) });
});

// ---------------------------------------------------------------------------
// Permissions (administrator)
// ---------------------------------------------------------------------------
router.get('/permissions', requirePerm('permissions.manage'), (_req, res) => res.json(permissionMatrix()));
router.put('/permissions', requireRole('admin'), (req, res) => {
  savePermissions(req.body.matrix);
  logActivity(req.user.id, 'permissions', null, 'updated', req.body.matrix);
  res.json(permissionMatrix());
});
router.post('/permissions/reset', requireRole('admin'), (req, res) => {
  resetPermissions();
  logActivity(req.user.id, 'permissions', null, 'reset_to_defaults');
  res.json(permissionMatrix());
});

// ---------------------------------------------------------------------------
// Activity / audit history
// ---------------------------------------------------------------------------
router.get('/activity', requirePerm('activity.view'), (req, res) => {
  const where = ['1=1'];
  const params = [];
  if (req.query.entity_type) {
    where.push('a.entity_type = ?');
    params.push(req.query.entity_type);
  }
  if (req.query.entity_id) {
    where.push('a.entity_id = ?');
    params.push(req.query.entity_id);
  }
  if (req.query.q) {
    where.push('(a.action LIKE ? OR a.details LIKE ? OR u.name LIKE ?)');
    params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
  }
  if (req.user.role !== 'admin') {
    where.push('(u.department_id = ? OR a.actor_id IS NULL)');
    params.push(req.user.department_id);
  }
  const limit = Math.min(300, toInt(req.query.limit, 100));
  res.json(
    all(
      `SELECT a.*, u.name AS actor_name, u.role AS actor_role FROM activity_log a LEFT JOIN users u ON u.id = a.actor_id
        WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ?`,
      ...params,
      limit,
    ),
  );
});

// ---------------------------------------------------------------------------
// Analytics (department-scoped except for administrators)
// ---------------------------------------------------------------------------
router.get('/analytics/overview', requirePerm('analytics.view'), (req, res) => {
  res.json(
    overview({
      departmentId: scopeDept(req.user, req.query.department_id),
      days: Math.min(365, Math.max(7, toInt(req.query.days, 90))),
      labId: toInt(req.query.lab_id, null),
    }),
  );
});
router.get('/analytics/predictions', requirePerm('analytics.view'), (req, res) => {
  res.json(predictDemand({ departmentId: scopeDept(req.user, req.query.department_id) }));
});
router.get('/analytics/maintenance', requirePerm('analytics.view'), (req, res) => {
  res.json(maintenanceRecommendations({ departmentId: scopeDept(req.user, req.query.department_id) }));
});

// ---------------------------------------------------------------------------
// Smart recommendations
// ---------------------------------------------------------------------------
function validWindow(b) {
  if (!isDate(b.date) || !isTime(b.start_time) || !isTime(b.end_time) || b.end_time <= b.start_time) {
    throw badRequest('Choose a valid date and time range');
  }
}

router.post('/recommendations/labs', (req, res) => {
  validWindow(req.body);
  const needs = (req.body.needs || []).filter((n) => Number(n.category_id) > 0).map((n) => ({ category_id: Number(n.category_id), quantity: Math.max(1, toInt(n.quantity, 1)) }));
  res.json(
    recommendLabs({
      date: req.body.date,
      start_time: req.body.start_time,
      end_time: req.body.end_time,
      attendees: Math.max(1, toInt(req.body.attendees, 1)),
      purpose: String(req.body.purpose || ''),
      purpose_type: req.body.purpose_type,
      department_id: toInt(req.body.department_id, null),
      needs,
      user: req.user,
    }),
  );
});

router.post('/recommendations/equipment', (req, res) => {
  validWindow(req.body);
  const startAt = `${req.body.date}T${req.body.start_time}`;
  const endAt = `${req.body.date}T${req.body.end_time}`;
  const out = (req.body.needs || []).map((n) => {
    const qty = Math.max(1, toInt(n.quantity, 1));
    const items = all(
      `SELECT e.*, e.equipment_id AS id, e.equipment_name AS name, l.lab_name AS lab_name, l.department_id FROM equipment e LEFT JOIN labs l ON l.lab_id = e.lab_id
        WHERE e.category_id = ? AND e.maintenance_status NOT IN ('retired','under_maintenance')`,
      n.category_id,
    )
      .map((e) => {
        const available = equipmentAvailability(e, startAt, endAt).available;
        const condScore = { new: 1, good: 0.9, fair: 0.6, poor: 0.3 }[e.condition] ?? 0.7;
        const match = Math.round(100 * (0.6 * Math.min(1, available / qty) + 0.25 * condScore + 0.15 * (e.department_id === req.user.department_id ? 1 : 0.4)));
        return { equipment_id: e.id, name: e.name, code: e.code, lab_name: e.lab_name, condition: e.condition, available, sufficient: available >= qty, match };
      })
      .sort((a, b) => b.sufficient - a.sufficient || b.match - a.match);
    return { category_id: Number(n.category_id), quantity: qty, options: items };
  });
  res.json(out);
});

router.post('/recommendations/slots', (req, res) => {
  validWindow(req.body);
  res.json(
    findAlternativeSlots({
      labId: toInt(req.body.lab_id, null),
      items: (req.body.items || []).map((i) => ({ equipment_id: Number(i.equipment_id), quantity: Math.max(1, toInt(i.quantity, 1)) })),
      date: req.body.date,
      start_time: req.body.start_time,
      end_time: req.body.end_time,
      maxResults: 8,
    }),
  );
});

router.post('/recommendations/equipment-alternatives', (req, res) => {
  validWindow(req.body);
  res.json(equipmentAlternatives(req.body.equipment_id, toInt(req.body.quantity, 1), `${req.body.date}T${req.body.start_time}`, `${req.body.date}T${req.body.end_time}`));
});

// ---------------------------------------------------------------------------
// Schedule (timeline) & live occupancy
// ---------------------------------------------------------------------------
router.get('/schedule', (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : today();
  const labWhere = req.query.department_id ? ' WHERE l.department_id = ?' : '';
  const labs = all(
    `SELECT ${LAB_COLS()}, d.code AS department_code FROM labs l LEFT JOIN departments d ON d.id = l.department_id${labWhere} ORDER BY d.code, l.lab_name`,
    ...(req.query.department_id ? [req.query.department_id] : []),
  );
  const bookings = withItems(
    all(
      `${BOOKING_SELECT} WHERE b.lab_id IS NOT NULL AND b.booking_date = ?
         AND b.booking_status IN ('pending','approved','reserved','in_use','overdue','completed','returned_late','damaged') ORDER BY b.start_at`,
      date,
    ),
  ).map((b) => redactBooking(b, req.user));
  const blocks = all(
    `SELECT * FROM resource_blocks WHERE resource_type = 'lab' AND status != 'cancelled' AND start_at < ? AND end_at > ?`,
    `${date}T23:59`,
    `${date}T00:00`,
  );
  res.json({
    date,
    labs: labs.map((l) => ({
      ...serializeLab(l),
      bookings: bookings.filter((b) => b.lab_id === l.id),
      blocks: blocks.filter((k) => k.resource_id === l.id),
    })),
  });
});

router.get('/occupancy', (req, res) => {
  const live = liveLabStatuses();
  const labs = all(`SELECT ${LAB_COLS()}, d.code AS department_code, d.name AS department_name FROM labs l LEFT JOIN departments d ON d.id = l.department_id ORDER BY d.code, l.lab_name`);
  const out = labs.map((l) => {
    const status = live(l);
    if (status.current_booking && !canManage(req.user, l.department_id, 'bookings.view_all')) {
      status.current_booking = { ...status.current_booking, user_name: undefined, purpose: undefined };
    }
    return { ...serializeLab(l), ...status };
  });
  const totals = out.reduce(
    (acc, l) => {
      acc[l.live_status] = (acc[l.live_status] || 0) + 1;
      if (l.live_status === 'in_use' && l.current_booking) acc.people += l.current_booking.attendees;
      acc.seats += l.capacity;
      return acc;
    },
    { people: 0, seats: 0 },
  );
  res.json({ updated_at: nowLocal(), totals, labs: out });
});

// ---------------------------------------------------------------------------
// Role-aware dashboard summary
// ---------------------------------------------------------------------------
router.get('/dashboard', (req, res) => {
  const u = req.user;
  const now = nowLocal();
  const mine = get(
    `SELECT
       SUM(CASE WHEN booking_status IN ('approved','reserved') AND end_at > ? THEN 1 ELSE 0 END) AS upcoming,
       SUM(CASE WHEN booking_status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN booking_status IN ('in_use','overdue') THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN booking_status IN ('completed','returned_late','damaged') THEN 1 ELSE 0 END) AS completed,
       SUM(CASE WHEN booking_status = 'draft' THEN 1 ELSE 0 END) AS drafts
     FROM bookings WHERE user_id = ?`,
    now,
    u.id,
  );
  const upcoming = withItems(
    all(
      `${BOOKING_SELECT} WHERE b.user_id = ? AND b.booking_status IN ('pending','approved','reserved','in_use','overdue') AND b.end_at > ? ORDER BY b.start_at LIMIT 6`,
      u.id,
      addDays(today(), -1),
    ),
  );
  const outstanding = all(
    `SELECT i.*, i.issue_id AS id, e.equipment_name AS equipment_name, b.ref_code, b.booking_status AS booking_status FROM issues i
       JOIN bookings b ON b.booking_id = i.booking_id JOIN equipment e ON e.equipment_id = i.equipment_id
      WHERE b.user_id = ? AND i.returned_at IS NULL ORDER BY i.due_at`,
    u.id,
  );
  const result = { mine: { ...mine, outstanding_items: outstanding.reduce((s, i) => s + i.quantity, 0) }, upcoming, outstanding };

  if (hasPerm(u, 'bookings.view_all')) {
    const dept = scopeDept(u);
    const scope = dept ? ` AND b.department_id = ${Number(dept)}` : '';
    result.manage = get(
      `SELECT
         SUM(CASE WHEN b.booking_status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN b.booking_status = 'pending' AND b.required_approval = 'coordinator' THEN 1 ELSE 0 END) AS pending_coordinator,
         SUM(CASE WHEN b.booking_status = 'pending' AND b.priority = 'urgent' THEN 1 ELSE 0 END) AS urgent,
         SUM(CASE WHEN b.booking_status IN ('approved','reserved') AND b.booking_date = ? AND b.end_at > ? THEN 1 ELSE 0 END) AS to_issue_today,
         SUM(CASE WHEN b.booking_status = 'in_use' THEN 1 ELSE 0 END) AS in_use,
         SUM(CASE WHEN b.booking_status = 'overdue' THEN 1 ELSE 0 END) AS overdue,
         SUM(CASE WHEN b.booking_date = ? AND b.booking_status NOT IN ('draft','cancelled','rejected') THEN 1 ELSE 0 END) AS today_total
       FROM bookings b WHERE 1=1${scope}`,
      today(),
      now,
      today(),
    );
    result.manage.open_damage = get(
      `SELECT COUNT(*) AS n FROM damage_reports r JOIN equipment e ON e.equipment_id = r.equipment_id LEFT JOIN labs l ON l.lab_id = e.lab_id
        WHERE r.status IN ('open','in_repair')${dept ? ` AND l.department_id = ${Number(dept)}` : ''}`,
    ).n;
    result.queue = withItems(all(`${BOOKING_SELECT} WHERE b.booking_status = 'pending'${scope} ORDER BY b.priority_score DESC, b.start_at LIMIT 5`));
    result.overdue = withItems(all(`${BOOKING_SELECT} WHERE b.booking_status = 'overdue'${scope} ORDER BY b.end_at LIMIT 5`));
    result.today = withItems(
      all(`${BOOKING_SELECT} WHERE b.booking_date = ? AND b.booking_status IN ('approved','reserved','in_use','overdue')${scope} ORDER BY b.start_at LIMIT 8`, today()),
    );
  }
  res.json(result);
});

export default router;
