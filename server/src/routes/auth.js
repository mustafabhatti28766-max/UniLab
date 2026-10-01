import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { get, insert, updateRow } from '../db.js';
import { authenticate, clearLoginAttempts, loadUser, loginRateLimit, signToken } from '../middleware/auth.js';
import { HttpError, badRequest, isEmail, requireFields } from '../utils/http.js';
import { logActivity } from '../services/notify.js';
import { nowLocal } from '../utils/time.js';

const router = Router();

router.post('/login', loginRateLimit, (req, res) => {
  requireFields(req.body, ['email', 'password']);
  const row = get('SELECT * FROM users WHERE email = ?', String(req.body.email).trim());
  if (!row || !bcrypt.compareSync(String(req.body.password), row.password_hash)) {
    throw new HttpError(401, 'Invalid email or password');
  }
  if (!row.is_active) throw new HttpError(403, 'Your account has been deactivated. Contact the administrator.');
  clearLoginAttempts(req);
  updateRow('users', row.id, { last_login_at: nowLocal() });
  logActivity(row.id, 'user', row.id, 'login');
  res.json({ token: signToken(row), user: loadUser(row.id) });
});

router.post('/register', (req, res) => {
  requireFields(req.body, ['name', 'email', 'password', 'department_id']);
  const { name, email, password, department_id, student_id, phone } = req.body;
  const role = req.body.role === 'faculty' ? 'faculty' : 'student';
  if (!isEmail(email)) throw badRequest('Enter a valid email address');
  if (String(password).length < 8) throw badRequest('Password must be at least 8 characters');
  if (String(name).trim().length < 2) throw badRequest('Enter your full name');
  if (!get('SELECT id FROM departments WHERE id = ?', department_id)) throw badRequest('Choose a valid department');
  if (get('SELECT id FROM users WHERE email = ?', email.trim())) throw new HttpError(409, 'An account with this email already exists');
  if (student_id && get('SELECT id FROM users WHERE student_id = ?', String(student_id).trim())) {
    throw new HttpError(409, 'This university ID is already registered');
  }
  const id = insert(
    'INSERT INTO users (name, email, password_hash, role, department_id, student_id, phone) VALUES (?, ?, ?, ?, ?, ?, ?)',
    String(name).trim(),
    email.trim().toLowerCase(),
    bcrypt.hashSync(String(password), 10),
    role,
    Number(department_id),
    student_id ? String(student_id).trim() : null,
    phone || null,
  );
  logActivity(id, 'user', id, 'registered', { role });
  res.status(201).json({ token: signToken({ id, role }), user: loadUser(id) });
});

router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

router.put('/me', authenticate, (req, res) => {
  const fields = {};
  if (req.body.name !== undefined) {
    if (String(req.body.name).trim().length < 2) throw badRequest('Enter your full name');
    fields.name = String(req.body.name).trim();
  }
  if (req.body.phone !== undefined) fields.phone = String(req.body.phone).trim() || null;
  if (req.body.new_password) {
    const row = get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
    if (!bcrypt.compareSync(String(req.body.current_password || ''), row.password_hash)) throw badRequest('Current password is incorrect');
    if (String(req.body.new_password).length < 8) throw badRequest('New password must be at least 8 characters');
    fields.password_hash = bcrypt.hashSync(String(req.body.new_password), 10);
  }
  updateRow('users', req.user.id, fields);
  logActivity(req.user.id, 'user', req.user.id, fields.password_hash ? 'password_changed' : 'profile_updated');
  res.json({ user: loadUser(req.user.id) });
});

export default router;
