import jwt from 'jsonwebtoken';
import { JWT_SECRET, TOKEN_TTL } from '../config.js';
import { get } from '../db.js';
import { HttpError, forbidden } from '../utils/http.js';
import { hasPerm, permissionsFor } from '../services/permissions.js';

export const ROLES = ['student', 'faculty', 'staff', 'coordinator', 'admin'];

const USER_COLUMNS = `u.id, u.name, u.email, u.role, u.department_id, u.student_id, u.phone, u.is_active,
  u.late_return_count, u.restricted_until, u.last_login_at, u.created_at, d.name AS department_name, d.code AS department_code`;

export function loadUser(id) {
  const user = get(`SELECT ${USER_COLUMNS} FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ?`, id);
  if (user) user.permissions = permissionsFor(user.role);
  return user;
}

export const signToken = (user) => jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_TTL });

export function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Authentication required'));
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return next(new HttpError(401, 'Session expired or invalid. Please sign in again.'));
  }
  const user = loadUser(payload.sub);
  if (!user || !user.is_active) return next(new HttpError(401, 'Account is inactive or no longer exists'));
  req.user = user;
  next();
}

export const requireRole = (...roles) => (req, _res, next) => (roles.includes(req.user?.role) ? next() : next(forbidden()));

/** Gate a route on a permission from the role-permission matrix. */
export const requirePerm = (perm) => (req, _res, next) => (hasPerm(req.user, perm) ? next() : next(forbidden()));

export { hasPerm };

/** Administrators act system-wide; everyone else only inside their own department. */
export const inScope = (u, deptId) => u?.role === 'admin' || (deptId != null && u?.department_id === Number(deptId));

/** Permission + department scope check. */
export const canManage = (u, deptId, perm) => hasPerm(u, perm) && inScope(u, deptId);

export function assertCanManage(u, deptId, perm) {
  if (!hasPerm(u, perm)) throw forbidden();
  if (!inScope(u, deptId)) throw forbidden('You can only manage resources that belong to your department');
}

/** Department filter for list queries: admins see everything (optionally filtered). */
export const scopeDept = (u, requested) => (u.role === 'admin' ? (requested ? Number(requested) : null) : u.department_id);

/** Simple in-memory limiter for login attempts. */
const attempts = new Map();
export function loginRateLimit(req, _res, next) {
  const key = `${req.ip}|${String(req.body?.email || '').toLowerCase()}`;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const entry = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  if (entry.length >= 10) return next(new HttpError(429, 'Too many login attempts. Try again in a few minutes.'));
  entry.push(now);
  attempts.set(key, entry);
  next();
}
export const clearLoginAttempts = (req) => attempts.delete(`${req.ip}|${String(req.body?.email || '').toLowerCase()}`);
