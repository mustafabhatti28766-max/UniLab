import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { DATA_DIR } from './config.js';

export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'unilab.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const NOW = `(strftime('%Y-%m-%dT%H:%M:%S','now','localtime'))`;

/** Bump when the schema changes; older databases are rebuilt (demo data is re-seeded). */
export const SCHEMA_VERSION = 2;

// Core tables follow the project data model (section 7) column-for-column:
//   Lab Data, Equipment Data, Booking Data, Issue / Return Data.
// Extra columns support the workflow, rules and analytics features.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','faculty','staff','coordinator','admin')),
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  student_id TEXT UNIQUE,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  late_return_count INTEGER NOT NULL DEFAULT 0,
  restricted_until TEXT,
  calendar_token TEXT UNIQUE,
  last_login_at TEXT,
  created_at TEXT DEFAULT ${NOW}
);

-- Lab Data: lab_id, lab_name, department_id, capacity, location, facilities, status
CREATE TABLE IF NOT EXISTS labs (
  lab_id INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_name TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  capacity INTEGER NOT NULL DEFAULT 30 CHECK (capacity > 0),
  location TEXT,
  facilities TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','maintenance','closed')),
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  open_time TEXT NOT NULL DEFAULT '08:00',
  close_time TEXT NOT NULL DEFAULT '20:00',
  approval_level TEXT NOT NULL DEFAULT 'staff' CHECK (approval_level IN ('none','staff','coordinator')),
  restricted_to_department INTEGER NOT NULL DEFAULT 0,
  incharge_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  icon TEXT DEFAULT 'box',
  created_at TEXT DEFAULT ${NOW}
);

-- Equipment Data: equipment_id, equipment_name, category, total_quantity, available_quantity,
--                 condition, maintenance_status, lab_id
CREATE TABLE IF NOT EXISTS equipment (
  equipment_id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_name TEXT NOT NULL,
  category TEXT,
  total_quantity INTEGER NOT NULL DEFAULT 1 CHECK (total_quantity >= 0),
  available_quantity INTEGER NOT NULL DEFAULT 0 CHECK (available_quantity >= 0),
  condition TEXT NOT NULL DEFAULT 'good' CHECK (condition IN ('new','good','fair','poor')),
  maintenance_status TEXT NOT NULL DEFAULT 'operational'
    CHECK (maintenance_status IN ('operational','needs_inspection','under_maintenance','retired')),
  lab_id INTEGER REFERENCES labs(lab_id) ON DELETE SET NULL,
  code TEXT UNIQUE NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  description TEXT,
  maintenance_quantity INTEGER NOT NULL DEFAULT 0 CHECK (maintenance_quantity >= 0),
  missing_quantity INTEGER NOT NULL DEFAULT 0 CHECK (missing_quantity >= 0),
  approval_level TEXT NOT NULL DEFAULT 'staff' CHECK (approval_level IN ('none','staff','coordinator')),
  max_per_booking INTEGER,
  restricted_to_department INTEGER NOT NULL DEFAULT 0,
  last_maintenance_at TEXT,
  created_at TEXT DEFAULT ${NOW}
);

-- Booking Data: booking_id, user_id, resource_type, resource_id, booking_date, start_time, end_time,
--               purpose, approval_status, booking_status, approved_by
CREATE TABLE IF NOT EXISTS bookings (
  booking_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('lab','equipment','lab_equipment')),
  resource_id INTEGER NOT NULL,
  booking_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  purpose TEXT,
  approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('none','pending','approved','rejected','auto')),
  booking_status TEXT NOT NULL DEFAULT 'pending' CHECK (booking_status IN
    ('draft','pending','approved','reserved','in_use','completed','rejected','cancelled','overdue','returned_late','damaged')),
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ref_code TEXT UNIQUE NOT NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  lab_id INTEGER REFERENCES labs(lab_id) ON DELETE SET NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  purpose_type TEXT NOT NULL DEFAULT 'other',
  attendees INTEGER NOT NULL DEFAULT 1,
  priority TEXT NOT NULL DEFAULT 'normal',
  priority_score INTEGER NOT NULL DEFAULT 0,
  required_approval TEXT NOT NULL DEFAULT 'staff',
  approved_at TEXT,
  rejection_reason TEXT,
  rejection_category TEXT,
  cancel_reason TEXT,
  escalated INTEGER NOT NULL DEFAULT 0,
  checked_in_at TEXT,
  completed_at TEXT,
  qr_token TEXT UNIQUE,
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  return_reminder_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT ${NOW},
  updated_at TEXT DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_bookings_lab_time ON bookings(lab_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id, booking_status);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(booking_status, start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_resource ON bookings(resource_type, resource_id);

-- Equipment lines of a booking (a booking may combine a lab with several equipment types).
CREATE TABLE IF NOT EXISTS booking_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  equipment_id INTEGER NOT NULL REFERENCES equipment(equipment_id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);
CREATE INDEX IF NOT EXISTS idx_items_equipment ON booking_items(equipment_id);
CREATE INDEX IF NOT EXISTS idx_items_booking ON booking_items(booking_id);

-- Issue / Return Data: issue_id, booking_id, equipment_id, quantity, issued_at, due_at,
--                      returned_at, return_condition, remarks
CREATE TABLE IF NOT EXISTS issues (
  issue_id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  equipment_id INTEGER NOT NULL REFERENCES equipment(equipment_id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL,
  issued_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  returned_at TEXT,
  return_condition TEXT,
  remarks TEXT,
  booking_item_id INTEGER REFERENCES booking_items(id) ON DELETE SET NULL,
  issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  received_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  returned_good INTEGER,
  returned_damaged INTEGER,
  returned_missing INTEGER,
  damage_image TEXT,
  is_late INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_issues_equipment ON issues(equipment_id, returned_at);
CREATE INDEX IF NOT EXISTS idx_issues_booking ON issues(booking_id);

CREATE TABLE IF NOT EXISTS damage_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL REFERENCES equipment(equipment_id) ON DELETE CASCADE,
  booking_id INTEGER REFERENCES bookings(booking_id) ON DELETE SET NULL,
  issue_id INTEGER REFERENCES issues(issue_id) ON DELETE SET NULL,
  reported_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  responsible_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'damaged' CHECK (kind IN ('damaged','missing','fault')),
  quantity INTEGER NOT NULL DEFAULT 1,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  description TEXT,
  image_path TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_repair','resolved','written_off')),
  resolved_at TEXT,
  created_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS resource_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('lab','equipment')),
  resource_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'block' CHECK (kind IN ('block','maintenance')),
  title TEXT NOT NULL,
  reason TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  quantity INTEGER,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_blocks_resource ON resource_blocks(resource_type, resource_id, start_at);

-- Approval history
CREATE TABLE IF NOT EXISTS booking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  created_at TEXT DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_events_booking ON booking_events(booking_id);

-- Resource activity history / audit log
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  link TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('lab','equipment')),
  resource_id INTEGER NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','notified','booked','expired','cancelled')),
  notified_at TEXT,
  created_at TEXT DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id INTEGER NOT NULL DEFAULT 0,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT DEFAULT ${NOW},
  UNIQUE (department_id, key)
);

-- Permissions granted to each role (editable by the administrator)
CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);

CREATE TABLE IF NOT EXISTS demand_misses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_type TEXT NOT NULL,
  resource_id INTEGER NOT NULL,
  requested_qty INTEGER,
  available_qty INTEGER,
  start_at TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT ${NOW}
);
`;

const cache = new Map();

function dropAll() {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all();
  db.exec('PRAGMA foreign_keys = OFF;');
  for (const { name } of tables) db.exec(`DROP TABLE IF EXISTS "${name}"`);
  db.exec('PRAGMA foreign_keys = ON;');
  cache.clear();
}

const version = db.prepare('PRAGMA user_version').get().user_version;
if (version < SCHEMA_VERSION) {
  const hasTables = db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).get().n;
  if (hasTables) {
    console.log(`[db] Upgrading database schema to v${SCHEMA_VERSION} — rebuilding with demo data.`);
    dropAll();
  }
}
db.exec(SCHEMA);
db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);

// ---------------------------------------------------------------------------
// Query helpers. node:sqlite only binds null/number/bigint/string/bytes, so
// undefined → null and booleans → 0/1 are normalised here once.
// ---------------------------------------------------------------------------
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}
const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
const normAll = (params) => params.map(norm);

export const all = (sql, ...params) => stmt(sql).all(...normAll(params)).map((r) => ({ ...r }));
export const get = (sql, ...params) => {
  const r = stmt(sql).get(...normAll(params));
  return r ? { ...r } : undefined;
};
export const run = (sql, ...params) => stmt(sql).run(...normAll(params));
export const insert = (sql, ...params) => Number(run(sql, ...params).lastInsertRowid);

let depth = 0;
/** Run fn inside a transaction (nested calls join the outer transaction). */
export function tx(fn) {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}

/** Primary-key column per table (data-model tables use descriptive keys). */
export const PK = { labs: 'lab_id', equipment: 'equipment_id', bookings: 'booking_id', issues: 'issue_id' };

/** Build "col = ?, col2 = ?" update fragments from a plain object. */
export function updateRow(table, id, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ${PK[table] || 'id'} = ?`;
  run(sql, ...keys.map((k) => fields[k]), id);
}

// SELECT column lists that also expose short aliases (id / name / status) used by the API.
export const LAB_COLS = (a = 'l') => `${a}.*, ${a}.lab_id AS id, ${a}.lab_name AS name`;
export const EQ_COLS = (a = 'e') => `${a}.*, ${a}.equipment_id AS id, ${a}.equipment_name AS name`;
export const BOOKING_COLS = (a = 'b') => `${a}.*, ${a}.booking_id AS id, ${a}.booking_status AS status`;
export const ISSUE_COLS = (a = 'i') => `${a}.*, ${a}.issue_id AS id`;

export const getLab = (id) => get(`SELECT ${LAB_COLS()} FROM labs l WHERE l.lab_id = ?`, id);
export const getEquipmentRow = (id) => get(`SELECT ${EQ_COLS()} FROM equipment e WHERE e.equipment_id = ?`, id);

export function resetDatabase() {
  dropAll();
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

export const parseJSON = (s, fallback = []) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};
