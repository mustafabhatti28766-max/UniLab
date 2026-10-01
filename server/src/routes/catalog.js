import { Router } from 'express';
import { all, get, insert, run, updateRow } from '../db.js';
import { authenticate, requirePerm } from '../middleware/auth.js';
import { HttpError, notFound, requireFields } from '../utils/http.js';
import { logActivity } from '../services/notify.js';

const router = Router();

// ---- Departments (list is public so the registration form can use it) ----
router.get('/departments', (_req, res) => {
  res.json(
    all(`SELECT d.*,
      (SELECT COUNT(*) FROM labs l WHERE l.department_id = d.id) AS lab_count,
      (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id) AS user_count,
      (SELECT COUNT(*) FROM equipment e JOIN labs l ON l.lab_id = e.lab_id WHERE l.department_id = d.id) AS equipment_count
      FROM departments d ORDER BY d.name`),
  );
});

router.post('/departments', authenticate, requirePerm('catalog.manage'), (req, res) => {
  requireFields(req.body, ['code', 'name']);
  const code = String(req.body.code).trim().toUpperCase();
  if (get('SELECT id FROM departments WHERE code = ?', code)) throw new HttpError(409, 'Department code already exists');
  const id = insert('INSERT INTO departments (code, name, description) VALUES (?, ?, ?)', code, String(req.body.name).trim(), req.body.description || null);
  logActivity(req.user.id, 'department', id, 'created', { code });
  res.status(201).json(get('SELECT * FROM departments WHERE id = ?', id));
});

router.put('/departments/:id', authenticate, requirePerm('catalog.manage'), (req, res) => {
  const dept = get('SELECT * FROM departments WHERE id = ?', req.params.id);
  if (!dept) throw notFound('Department');
  const fields = {};
  if (req.body.code) fields.code = String(req.body.code).trim().toUpperCase();
  if (req.body.name) fields.name = String(req.body.name).trim();
  if (req.body.description !== undefined) fields.description = req.body.description;
  updateRow('departments', dept.id, fields);
  logActivity(req.user.id, 'department', dept.id, 'updated', fields);
  res.json(get('SELECT * FROM departments WHERE id = ?', dept.id));
});

router.delete('/departments/:id', authenticate, requirePerm('catalog.manage'), (req, res) => {
  const inUse = get('SELECT (SELECT COUNT(*) FROM labs WHERE department_id = ?) + (SELECT COUNT(*) FROM users WHERE department_id = ?) AS n', req.params.id, req.params.id).n;
  if (inUse) throw new HttpError(409, 'Department still has labs or users assigned. Reassign them first.');
  run('DELETE FROM departments WHERE id = ?', req.params.id);
  logActivity(req.user.id, 'department', Number(req.params.id), 'deleted');
  res.json({ ok: true });
});

// ---- Equipment categories ----
router.get('/categories', authenticate, (_req, res) => {
  res.json(all(`SELECT c.*, (SELECT COUNT(*) FROM equipment e WHERE e.category_id = c.id) AS equipment_count FROM categories c ORDER BY c.name`));
});

router.post('/categories', authenticate, requirePerm('catalog.manage'), (req, res) => {
  requireFields(req.body, ['name']);
  if (get('SELECT id FROM categories WHERE name = ?', String(req.body.name).trim())) throw new HttpError(409, 'Category already exists');
  const id = insert('INSERT INTO categories (name, description, icon) VALUES (?, ?, ?)', String(req.body.name).trim(), req.body.description || null, req.body.icon || 'box');
  logActivity(req.user.id, 'category', id, 'created', { name: req.body.name });
  res.status(201).json(get('SELECT * FROM categories WHERE id = ?', id));
});

router.put('/categories/:id', authenticate, requirePerm('catalog.manage'), (req, res) => {
  const cat = get('SELECT * FROM categories WHERE id = ?', req.params.id);
  if (!cat) throw notFound('Category');
  const fields = {};
  for (const k of ['name', 'description', 'icon']) if (req.body[k] !== undefined) fields[k] = req.body[k];
  updateRow('categories', cat.id, fields);
  // equipment.category stores the category name (data model) — keep it in sync.
  if (fields.name) run('UPDATE equipment SET category = ? WHERE category_id = ?', fields.name, cat.id);
  logActivity(req.user.id, 'category', cat.id, 'updated', fields);
  res.json(get('SELECT * FROM categories WHERE id = ?', cat.id));
});

router.delete('/categories/:id', authenticate, requirePerm('catalog.manage'), (req, res) => {
  if (get('SELECT COUNT(*) AS n FROM equipment WHERE category_id = ?', req.params.id).n) {
    throw new HttpError(409, 'Category still has equipment. Move it to another category first.');
  }
  run('DELETE FROM categories WHERE id = ?', req.params.id);
  logActivity(req.user.id, 'category', Number(req.params.id), 'deleted');
  res.json({ ok: true });
});

export default router;
