import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { all, get, insert, updateRow } from '../db.js';
import { ROLES, authenticate, loadUser, requirePerm, inScope, scopeDept } from '../middleware/auth.js';
import { HttpError, badRequest, forbidden, isEmail, notFound, oneOf, requireFields } from '../utils/http.js';
import { logActivity, notify } from '../services/notify.js';

const router = Router();
router.use(authenticate);

const LIST_SQL = `
  SELECT u.id, u.name, u.email, u.role, u.department_id, u.student_id, u.phone, u.is_active, u.late_return_count,
    u.restricted_until, u.last_login_at, u.created_at, d.code AS department_code, d.name AS department_name,
    (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id AND b.booking_status != 'draft') AS booking_count,
    (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id AND b.booking_status IN ('pending','approved','reserved','in_use','overdue')) AS active_count
  FROM users u LEFT JOIN departments d ON d.id = u.department_id`;

// Non-admin user managers (e.g. coordinators) may only manage students and faculty of their department.
const LIMITED_ROLES = ['student', 'faculty'];
function assertCanEdit(actor, target, nextRole, nextDept) {
  if (actor.role === 'admin') return;
  if (target && (!inScope(actor, target.department_id) || !LIMITED_ROLES.includes(target.role))) throw forbidden('You can only manage students and faculty in your department');
  if (nextRole && !LIMITED_ROLES.includes(nextRole)) throw forbidden('Only administrators can assign staff, coordinator or administrator roles');
  if (nextDept !== undefined && nextDept !== '' && nextDept !== null && Number(nextDept) !== actor.department_id) {
    throw forbidden('You can only assign users to your own department');
  }
}

router.get('/', requirePerm('users.manage'), (req, res) => {
  const where = [];
  const params = [];
  const dept = scopeDept(req.user, req.query.department_id);
  if (dept) {
    where.push('u.department_id = ?');
    params.push(dept);
  }
  if (req.query.role) {
    where.push('u.role = ?');
    params.push(req.query.role);
  }
  if (req.query.q) {
    where.push('(u.name LIKE ? OR u.email LIKE ? OR u.student_id LIKE ?)');
    const q = `%${req.query.q}%`;
    params.push(q, q, q);
  }
  if (req.query.restricted === '1') where.push(`u.restricted_until IS NOT NULL`);
  res.json(all(`${LIST_SQL}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY u.role, u.name`, ...params));
});

/** Staff lookup by university ID card number (ID card scanning). */
router.get('/lookup', requirePerm('bookings.issue'), (req, res) => {
  const user = get(`${LIST_SQL} WHERE u.student_id = ? OR u.email = ?`, String(req.query.student_id || ''), String(req.query.student_id || ''));
  if (!user) throw notFound('User with this ID');
  res.json(user);
});

router.get('/:id', requirePerm('users.manage'), (req, res) => {
  const user = get(`${LIST_SQL} WHERE u.id = ?`, req.params.id);
  if (!user) throw notFound('User');
  if (!inScope(req.user, user.department_id)) throw forbidden();
  const recent = all(
    `SELECT b.booking_id AS id, b.ref_code, b.booking_status AS status, b.start_at, b.end_at, l.lab_name AS lab_name FROM bookings b
       LEFT JOIN labs l ON l.lab_id = b.lab_id WHERE b.user_id = ? ORDER BY b.start_at DESC LIMIT 10`,
    user.id,
  );
  res.json({ ...user, recent_bookings: recent });
});

router.post('/', requirePerm('users.manage'), (req, res) => {
  requireFields(req.body, ['name', 'email', 'password', 'role']);
  const { name, email, password, role, student_id, phone } = req.body;
  const department_id = req.user.role === 'admin' ? req.body.department_id : req.body.department_id || req.user.department_id;
  oneOf(role, ROLES, 'role');
  assertCanEdit(req.user, null, role, department_id);
  if (!isEmail(email)) throw badRequest('Invalid email');
  if (String(password).length < 8) throw badRequest('Password must be at least 8 characters');
  if (get('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'Email already in use');
  if (student_id && get('SELECT id FROM users WHERE student_id = ?', student_id)) throw new HttpError(409, 'University ID already in use');
  const id = insert(
    'INSERT INTO users (name, email, password_hash, role, department_id, student_id, phone) VALUES (?, ?, ?, ?, ?, ?, ?)',
    String(name).trim(),
    String(email).trim().toLowerCase(),
    bcrypt.hashSync(String(password), 10),
    role,
    department_id || null,
    student_id || null,
    phone || null,
  );
  logActivity(req.user.id, 'user', id, 'created', { role });
  res.status(201).json(loadUser(id));
});

router.put('/:id', requirePerm('users.manage'), (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!user) throw notFound('User');
  if (req.user.role !== 'admin') delete req.body.department_id; // department managers can't move users between departments
  assertCanEdit(req.user, user, req.body.role, req.body.department_id);
  const fields = {};
  if (req.body.name !== undefined) fields.name = String(req.body.name).trim();
  if (req.body.email !== undefined) {
    if (!isEmail(req.body.email)) throw badRequest('Invalid email');
    const clash = get('SELECT id FROM users WHERE email = ? AND id != ?', req.body.email, user.id);
    if (clash) throw new HttpError(409, 'Email already in use');
    fields.email = String(req.body.email).trim().toLowerCase();
  }
  if (req.body.role !== undefined) {
    oneOf(req.body.role, ROLES, 'role');
    if (user.id === req.user.id && req.body.role !== user.role) throw badRequest('You cannot change your own role');
    fields.role = req.body.role;
  }
  if (req.body.department_id !== undefined) fields.department_id = req.body.department_id || null;
  if (req.body.student_id !== undefined) {
    const sid = req.body.student_id ? String(req.body.student_id).trim() : null;
    if (sid && get('SELECT id FROM users WHERE student_id = ? AND id != ?', sid, user.id)) throw new HttpError(409, 'University ID already in use');
    fields.student_id = sid;
  }
  if (req.body.phone !== undefined) fields.phone = req.body.phone || null;
  if (req.body.is_active !== undefined) {
    if (user.id === req.user.id && !req.body.is_active) throw badRequest('You cannot deactivate your own account');
    fields.is_active = req.body.is_active ? 1 : 0;
  }
  if (req.body.password) {
    if (String(req.body.password).length < 8) throw badRequest('Password must be at least 8 characters');
    fields.password_hash = bcrypt.hashSync(String(req.body.password), 10);
  }
  updateRow('users', user.id, fields);
  const { password_hash, ...logged } = fields;
  logActivity(req.user.id, 'user', user.id, 'updated', { ...logged, password_reset: !!password_hash });
  res.json(loadUser(user.id));
});

router.post('/:id/clear-restriction', requirePerm('users.manage'), (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!user) throw notFound('User');
  if (!inScope(req.user, user.department_id)) throw forbidden();
  updateRow('users', user.id, { restricted_until: null, late_return_count: 0 });
  notify(user.id, { type: 'restriction_lifted', title: 'Booking privileges restored', message: `${req.user.name} lifted your booking restriction.`, link: '/book' });
  logActivity(req.user.id, 'user', user.id, 'restriction_cleared');
  res.json(loadUser(user.id));
});

export default router;
