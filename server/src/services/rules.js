import { all, run, tx } from '../db.js';

/**
 * Booking rules a university can configure. Values are stored globally
 * (department_id = 0) and may be overridden per department by its coordinator.
 */
export const RULE_DEFS = {
  max_hours_student: { group: 'Duration & limits', label: 'Maximum booking duration — students', type: 'number', unit: 'hours', default: 4, min: 0.5, max: 24 },
  max_hours_faculty: { group: 'Duration & limits', label: 'Maximum booking duration — faculty & staff', type: 'number', unit: 'hours', default: 8, min: 0.5, max: 24 },
  advance_days_student: { group: 'Duration & limits', label: 'Advance booking limit — students', type: 'number', unit: 'days', default: 14, min: 1, max: 365 },
  advance_days_faculty: { group: 'Duration & limits', label: 'Advance booking limit — faculty & staff', type: 'number', unit: 'days', default: 45, min: 1, max: 365 },
  min_notice_hours: { group: 'Duration & limits', label: 'Minimum notice before start', type: 'number', unit: 'hours', default: 1, min: 0, max: 168 },
  max_equipment_qty_student: { group: 'Duration & limits', label: 'Maximum units per equipment item — students', type: 'number', unit: 'units', default: 10, min: 1, max: 500 },
  max_equipment_qty_faculty: { group: 'Duration & limits', label: 'Maximum units per equipment item — faculty & staff', type: 'number', unit: 'units', default: 40, min: 1, max: 500 },
  max_active_bookings_student: { group: 'Duration & limits', label: 'Maximum active bookings per student', type: 'number', unit: 'bookings', default: 5, min: 1, max: 50 },
  closed_weekdays: { group: 'Duration & limits', label: 'Days when labs are closed', type: 'weekdays', default: '0' },

  student_requires_approval: { group: 'Approval', label: 'Student bookings always require staff approval', type: 'boolean', default: true },
  faculty_auto_approve: { group: 'Approval', label: 'Auto-approve faculty bookings for staff-level resources', type: 'boolean', default: true },
  coordinator_review_hours: { group: 'Approval', label: 'Bookings longer than this need coordinator review', type: 'number', unit: 'hours', default: 4, min: 0.5, max: 24 },
  coordinator_review_qty: { group: 'Approval', label: 'Total equipment units that need coordinator review', type: 'number', unit: 'units', default: 15, min: 1, max: 500 },

  late_return_limit: { group: 'Penalties', label: 'Late returns before booking restriction', type: 'number', unit: 'returns', default: 3, min: 1, max: 20 },
  restriction_days: { group: 'Penalties', label: 'Restriction length after limit is reached', type: 'number', unit: 'days', default: 14, min: 1, max: 180 },
  block_with_overdue: { group: 'Penalties', label: 'Block new bookings while user has overdue equipment', type: 'boolean', default: true },

  faculty_priority: { group: 'Priority', label: 'Faculty priority booking', type: 'boolean', default: true },
  priority_weight_faculty: { group: 'Priority', label: 'Priority weight — faculty requests', type: 'number', unit: 'pts', default: 30, min: 0, max: 50 },
  priority_weight_student: { group: 'Priority', label: 'Priority weight — student requests', type: 'number', unit: 'pts', default: 12, min: 0, max: 50 },
  priority_weight_exam: { group: 'Priority', label: 'Purpose weight — exam / assessment', type: 'number', unit: 'pts', default: 30, min: 0, max: 50 },
  priority_weight_class: { group: 'Priority', label: 'Purpose weight — scheduled class / lab session', type: 'number', unit: 'pts', default: 25, min: 0, max: 50 },
  priority_weight_research: { group: 'Priority', label: 'Purpose weight — research', type: 'number', unit: 'pts', default: 25, min: 0, max: 50 },
  priority_weight_thesis: { group: 'Priority', label: 'Purpose weight — thesis / final-year project', type: 'number', unit: 'pts', default: 22, min: 0, max: 50 },
  priority_weight_project: { group: 'Priority', label: 'Purpose weight — course project', type: 'number', unit: 'pts', default: 15, min: 0, max: 50 },
  priority_weight_workshop: { group: 'Priority', label: 'Purpose weight — workshop / seminar', type: 'number', unit: 'pts', default: 15, min: 0, max: 50 },
  priority_weight_club: { group: 'Priority', label: 'Purpose weight — club / society activity', type: 'number', unit: 'pts', default: 8, min: 0, max: 50 },
  priority_weight_other: { group: 'Priority', label: 'Purpose weight — other', type: 'number', unit: 'pts', default: 5, min: 0, max: 50 },
};

export const PURPOSE_TYPES = ['class', 'exam', 'research', 'thesis', 'project', 'workshop', 'club', 'other'];

function parseValue(def, raw) {
  if (def.type === 'number') return Number(raw);
  if (def.type === 'boolean') return raw === true || raw === 'true' || raw === '1' || raw === 1;
  return String(raw ?? '');
}

/** Effective rules for a department: defaults ← global overrides ← department overrides. */
export function getRules(departmentId = 0) {
  const rows = all('SELECT department_id, key, value FROM rules WHERE department_id IN (0, ?)', departmentId || 0);
  const out = {};
  for (const [key, def] of Object.entries(RULE_DEFS)) out[key] = def.default;
  for (const r of rows.filter((r) => r.department_id === 0)) if (RULE_DEFS[r.key]) out[r.key] = parseValue(RULE_DEFS[r.key], r.value);
  for (const r of rows.filter((r) => r.department_id !== 0)) if (RULE_DEFS[r.key]) out[r.key] = parseValue(RULE_DEFS[r.key], r.value);
  out.closed_weekdays_list = String(out.closed_weekdays || '')
    .split(',')
    .filter((s) => s !== '')
    .map(Number);
  return out;
}

export function getRuleOverview(departmentId = 0) {
  const global = getRules(0);
  const effective = getRules(departmentId);
  const overrides = departmentId
    ? new Set(all('SELECT key FROM rules WHERE department_id = ?', departmentId).map((r) => r.key))
    : new Set();
  return Object.entries(RULE_DEFS).map(([key, def]) => ({
    key,
    ...def,
    value: effective[key],
    global_value: global[key],
    overridden: overrides.has(key),
  }));
}

/** values: { key: value | null } — null removes a department override. */
export function saveRules(departmentId, values, actorId) {
  const errors = [];
  tx(() => {
    for (const [key, raw] of Object.entries(values || {})) {
      const def = RULE_DEFS[key];
      if (!def) continue;
      if (raw === null && departmentId) {
        run('DELETE FROM rules WHERE department_id = ? AND key = ?', departmentId, key);
        continue;
      }
      let value = parseValue(def, raw);
      if (def.type === 'number') {
        if (!Number.isFinite(value) || value < def.min || value > def.max) {
          errors.push(`${def.label} must be between ${def.min} and ${def.max}`);
          continue;
        }
      }
      if (def.type === 'weekdays') {
        value = String(value)
          .split(',')
          .map((s) => s.trim())
          .filter((s) => /^[0-6]$/.test(s))
          .join(',');
      }
      run(
        `INSERT INTO rules (department_id, key, value, updated_by, updated_at)
         VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%S','now','localtime'))
         ON CONFLICT(department_id, key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        departmentId || 0,
        key,
        String(value),
        actorId,
      );
    }
    if (errors.length) throw Object.assign(new Error(errors.join('; ')), { status: 400 });
  });
}
