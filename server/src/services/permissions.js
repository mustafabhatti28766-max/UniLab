import { all, run, tx } from '../db.js';

/** Every permission the system checks, grouped for the admin's permission matrix. */
export const PERMISSIONS = [
  { key: 'bookings.create', group: 'Booking', label: 'Browse resources & submit booking requests' },
  { key: 'bookings.view_all', group: 'Booking', label: 'View & monitor all bookings in their scope' },
  { key: 'bookings.approve', group: 'Approval', label: 'Approve / reject requests (staff level)' },
  { key: 'bookings.approve_coordinator', group: 'Approval', label: 'Approve coordinator-level (important) requests' },
  { key: 'conflicts.resolve', group: 'Approval', label: 'Handle booking conflicts' },
  { key: 'bookings.issue', group: 'Operations', label: 'Issue equipment, grant lab access & confirm returns' },
  { key: 'labs.availability', group: 'Operations', label: 'Manage lab availability & block resources' },
  { key: 'maintenance.manage', group: 'Operations', label: 'Record damage & update maintenance status' },
  { key: 'labs.manage', group: 'Resources', label: 'Create & edit labs' },
  { key: 'equipment.manage', group: 'Resources', label: 'Create & edit equipment' },
  { key: 'rules.manage', group: 'Administration', label: 'Define booking rules & priority levels' },
  { key: 'analytics.view', group: 'Administration', label: 'View dashboards & analytics' },
  { key: 'users.manage', group: 'Administration', label: 'Manage users' },
  { key: 'catalog.manage', group: 'Administration', label: 'Manage departments & equipment categories' },
  { key: 'activity.view', group: 'Administration', label: 'View activity & approval history log' },
  { key: 'permissions.manage', group: 'Administration', label: 'Control permissions', adminOnly: true },
];
export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

const STAFF = ['bookings.create', 'bookings.view_all', 'bookings.approve', 'conflicts.resolve', 'bookings.issue', 'labs.availability', 'maintenance.manage', 'equipment.manage', 'analytics.view', 'activity.view'];
export const DEFAULT_PERMISSIONS = {
  student: ['bookings.create'],
  faculty: ['bookings.create'],
  staff: STAFF,
  coordinator: [...STAFF, 'bookings.approve_coordinator', 'labs.manage', 'rules.manage', 'users.manage'],
  admin: PERMISSION_KEYS,
};

let cache = null;
function load() {
  if (!cache) {
    cache = new Map(Object.keys(DEFAULT_PERMISSIONS).map((r) => [r, new Set()]));
    for (const row of all('SELECT role, permission FROM role_permissions')) cache.get(row.role)?.add(row.permission);
  }
  return cache;
}

/** Seed defaults the first time (or after a reset). */
export function ensureDefaultPermissions() {
  if (all('SELECT 1 FROM role_permissions LIMIT 1').length) return;
  tx(() => {
    for (const [role, perms] of Object.entries(DEFAULT_PERMISSIONS)) {
      for (const p of perms) run('INSERT OR IGNORE INTO role_permissions (role, permission) VALUES (?, ?)', role, p);
    }
  });
  cache = null;
}

export function permissionsFor(role) {
  if (role === 'admin') return [...PERMISSION_KEYS]; // administrators always keep full access
  return [...(load().get(role) || [])];
}

export const hasPerm = (user, perm) => !!user && (user.role === 'admin' || load().get(user.role)?.has(perm) === true);

export function permissionMatrix() {
  return {
    permissions: PERMISSIONS,
    roles: Object.keys(DEFAULT_PERMISSIONS).map((role) => ({ role, permissions: permissionsFor(role), locked: role === 'admin' })),
    defaults: DEFAULT_PERMISSIONS,
  };
}

/** matrix: { role: [permission, ...] } — admin is never editable. */
export function savePermissions(matrix) {
  tx(() => {
    for (const [role, perms] of Object.entries(matrix || {})) {
      if (role === 'admin' || !DEFAULT_PERMISSIONS[role]) continue;
      run('DELETE FROM role_permissions WHERE role = ?', role);
      for (const p of perms) {
        const def = PERMISSIONS.find((x) => x.key === p);
        if (def && !def.adminOnly) run('INSERT INTO role_permissions (role, permission) VALUES (?, ?)', role, p);
      }
    }
  });
  cache = null;
}

export function resetPermissions() {
  run('DELETE FROM role_permissions');
  cache = null;
  ensureDefaultPermissions();
}
