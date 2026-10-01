import { all, parseJSON, BOOKING_COLS } from '../db.js';
import { canManage } from '../middleware/auth.js';

export const BOOKING_SELECT = `
  SELECT ${BOOKING_COLS()}, u.name AS user_name, u.email AS user_email, u.role AS user_role, u.student_id AS user_student_id,
    u.late_return_count AS user_late_returns, ud.code AS user_department_code,
    l.lab_name AS lab_name, l.code AS lab_code, l.location AS lab_location, l.capacity AS lab_capacity,
    d.code AS department_code, d.name AS department_name, a.name AS approved_by_name
  FROM bookings b
  JOIN users u ON u.id = b.user_id
  LEFT JOIN departments ud ON ud.id = u.department_id
  LEFT JOIN labs l ON l.lab_id = b.lab_id
  LEFT JOIN departments d ON d.id = b.department_id
  LEFT JOIN users a ON a.id = b.approved_by`;

const inList = (ids) => ids.map(() => '?').join(',');

/** Attach equipment items to booking rows (single batched query). */
export function withItems(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const items = all(
    `SELECT bi.id, bi.booking_id, bi.equipment_id, bi.quantity, e.equipment_name AS name, e.code, e.category
       FROM booking_items bi JOIN equipment e ON e.equipment_id = bi.equipment_id
      WHERE bi.booking_id IN (${inList(ids)})`,
    ...ids,
  );
  const byBooking = new Map();
  for (const i of items) {
    if (!byBooking.has(i.booking_id)) byBooking.set(i.booking_id, []);
    byBooking.get(i.booking_id).push(i);
  }
  return rows.map((r) => ({ ...r, items: byBooking.get(r.id) || [] }));
}

export const canSeeBooking = (viewer, b) => b.user_id === viewer.id || canManage(viewer, b.department_id, 'bookings.view_all');

/** Hide personal details of other people's bookings from users without the monitoring permission. */
export function redactBooking(b, viewer) {
  if (canSeeBooking(viewer, b)) return b;
  return {
    id: b.id,
    booking_id: b.id,
    lab_id: b.lab_id,
    lab_name: b.lab_name,
    start_at: b.start_at,
    end_at: b.end_at,
    booking_date: b.booking_date,
    start_time: b.start_time,
    end_time: b.end_time,
    status: b.status,
    booking_status: b.status,
    resource_type: b.resource_type,
    attendees: b.attendees,
    purpose_type: b.purpose_type,
    items: (b.items || []).map(({ equipment_id, name, quantity }) => ({ equipment_id, name, quantity })),
    redacted: true,
  };
}

export const serializeLab = (lab) => ({ ...lab, facilities: parseJSON(lab.facilities), restricted_to_department: !!lab.restricted_to_department });
