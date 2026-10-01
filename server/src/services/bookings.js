import crypto from 'node:crypto';
import { all, get, insert, run, tx, updateRow, getLab, getEquipmentRow, BOOKING_COLS, ISSUE_COLS } from '../db.js';
import { getRules, PURPOSE_TYPES } from './rules.js';
import { checkLab, equipmentAvailability, equipmentBase, hoursProblems, syncAvailableQuantities, DEFAULT_HOURS } from './availability.js';
import { findAlternativeSlots, recommendLabs, equipmentAlternatives } from './recommend.js';
import { notify, notifyDepartment, logActivity } from './notify.js';
import { canManage, hasPerm, inScope } from '../middleware/auth.js';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../utils/http.js';
import { addDays, addMinutes, dateOf, diffMinutes, humanDateTime, isDate, isTime, nowLocal, timeOf, today } from '../utils/time.js';
import { EARLY_CHECKIN_MINUTES, LATE_GRACE_MINUTES, RESERVE_LEAD_HOURS } from '../config.js';

const LEVEL = { none: 0, staff: 1, coordinator: 2 };
const FACULTY_LIKE = ['faculty', 'staff', 'coordinator', 'admin'];
export const ACTIVE_STATUSES = ['pending', 'approved', 'reserved', 'in_use', 'overdue'];
const AVAILABILITY_CODES = new Set(['lab_conflict', 'lab_blocked', 'lab_unavailable', 'insufficient_quantity', 'outside_hours', 'closed_day', 'capacity']);
const WAITLISTABLE = new Set(['lab_conflict', 'insufficient_quantity', 'lab_blocked']);

// ---------------------------------------------------------------------------
// Input normalisation
// ---------------------------------------------------------------------------
export function normalizeInput(body = {}) {
  const merged = new Map();
  for (const i of Array.isArray(body.items) ? body.items : []) {
    const id = Number(i?.equipment_id);
    const q = Math.floor(Number(i?.quantity));
    if (id > 0 && q > 0) merged.set(id, (merged.get(id) || 0) + q);
  }
  return {
    lab_id: Number(body.lab_id) > 0 ? Number(body.lab_id) : null,
    items: [...merged].map(([equipment_id, quantity]) => ({ equipment_id, quantity })),
    booking_date: String(body.booking_date || ''),
    start_time: String(body.start_time || ''),
    end_time: String(body.end_time || ''),
    attendees: Math.min(1000, Math.max(1, Number.parseInt(body.attendees, 10) || 1)),
    purpose: String(body.purpose || '').trim().slice(0, 1000),
    purpose_type: PURPOSE_TYPES.includes(body.purpose_type) ? body.purpose_type : 'other',
  };
}

export const loadEquipment = (id) =>
  get(
    `SELECT e.*, e.equipment_id AS id, e.equipment_name AS name, l.lab_name AS lab_name, l.department_id AS lab_department_id, l.open_time, l.close_time
       FROM equipment e LEFT JOIN labs l ON l.lab_id = e.lab_id WHERE e.equipment_id = ?`,
    id,
  );

/** resource_type / resource_id as defined in the Booking Data model. */
function resourceOf(input) {
  if (input.lab_id) return { resource_type: input.items.length ? 'lab_equipment' : 'lab', resource_id: input.lab_id };
  return { resource_type: 'equipment', resource_id: input.items[0].equipment_id };
}

// ---------------------------------------------------------------------------
// Approval & priority
// ---------------------------------------------------------------------------
export function computeApproval(user, rules, lab, equipment, durationH, totalQty) {
  if (['coordinator', 'admin'].includes(user.role)) return { level: 'none', reasons: ['Booked by a coordinator/administrator'] };
  let level = 'none';
  const reasons = [];
  const raise = (l, why) => {
    if (LEVEL[l] > LEVEL[level]) level = l;
    reasons.push(why);
  };
  const facultyAuto = FACULTY_LIKE.includes(user.role) && rules.faculty_auto_approve;
  const resources = [...(lab ? [{ name: lab.name, approval_level: lab.approval_level }] : []), ...equipment.map((e) => ({ name: e.name, approval_level: e.approval_level }))];
  for (const r of resources) {
    if (r.approval_level === 'coordinator') raise('coordinator', `${r.name} requires coordinator approval`);
    else if (r.approval_level === 'staff' && !facultyAuto) raise('staff', `${r.name} requires lab staff approval`);
  }
  if (user.role === 'student' && rules.student_requires_approval) raise('staff', 'Student bookings require lab staff approval');
  if (durationH > rules.coordinator_review_hours) raise('coordinator', `Bookings longer than ${rules.coordinator_review_hours}h need coordinator review`);
  if (totalQty > rules.coordinator_review_qty) raise('coordinator', `More than ${rules.coordinator_review_qty} equipment units need coordinator review`);
  if (level === 'none' && !reasons.length) reasons.push(facultyAuto ? 'Faculty auto-approval applies' : 'No approval required for these resources');
  return { level, reasons };
}

export function computePriority(user, input, rules, startAt) {
  const reasons = [];
  const isFaculty = FACULTY_LIKE.includes(user.role);
  const roleW = isFaculty && rules.faculty_priority ? rules.priority_weight_faculty : rules.priority_weight_student;
  reasons.push(`${isFaculty ? 'Faculty' : 'Student'} request (+${roleW})`);
  const purposeW = rules[`priority_weight_${input.purpose_type}`] ?? rules.priority_weight_other;
  reasons.push(`Purpose: ${input.purpose_type} (+${purposeW})`);
  const hoursUntil = diffMinutes(nowLocal(), startAt) / 60;
  let urgency = 0;
  if (hoursUntil <= 24) urgency = 20;
  else if (hoursUntil <= 72) urgency = 10;
  if (urgency) reasons.push(`Starts in ${Math.max(0, Math.round(hoursUntil))}h (+${urgency})`);
  const size = input.attendees >= 20 ? 10 : input.attendees >= 10 ? 5 : 0;
  if (size) reasons.push(`${input.attendees} attendees (+${size})`);
  const reliability = -Math.min(15, (user.late_return_count || 0) * 5);
  if (reliability) reasons.push(`${user.late_return_count} late return(s) (${reliability})`);
  const score = Math.max(0, Math.min(100, roleW + purposeW + urgency + size + reliability));
  const level = score >= 70 ? 'urgent' : score >= 45 ? 'high' : 'normal';
  return { score, level, reasons };
}

// ---------------------------------------------------------------------------
// Evaluation: availability + conflict + rules check (used live by the UI and on submit)
// ---------------------------------------------------------------------------
export function evaluateBooking(user, input, { excludeId = 0, withAlternatives = true } = {}) {
  const errors = [];
  const warnings = [];
  const add = (code, message, extra = {}) => errors.push({ code, message, ...extra });
  const result = { ok: false, errors, warnings, items: [], lab: null, approval: null, priority: null, alternatives: null };

  if (!input.lab_id && !input.items.length) add('no_resource', 'Select a lab or at least one equipment item.');
  if (!isDate(input.booking_date)) add('invalid_date', 'Choose a valid date.');
  if (!isTime(input.start_time) || !isTime(input.end_time)) add('invalid_time', 'Choose valid start and end times.');
  if (errors.length) return result;

  const startAt = `${input.booking_date}T${input.start_time}`;
  const endAt = `${input.booking_date}T${input.end_time}`;
  Object.assign(result, { start_at: startAt, end_at: endAt });
  if (endAt <= startAt) {
    add('invalid_range', 'End time must be after start time.');
    return result;
  }

  const lab = input.lab_id ? getLab(input.lab_id) : null;
  if (input.lab_id && !lab) add('not_found', 'Selected lab does not exist.');
  const equipment = input.items.map((i) => ({ ...i, eq: loadEquipment(i.equipment_id) }));
  for (const e of equipment) if (!e.eq) add('not_found', `Equipment #${e.equipment_id} does not exist.`);
  if (errors.length) return result;

  const departmentId = lab?.department_id ?? equipment[0]?.eq.lab_department_id ?? user.department_id ?? null;
  const rules = getRules(departmentId);
  const isFaculty = FACULTY_LIKE.includes(user.role);
  const roleLabel = isFaculty ? 'faculty & staff' : 'students';
  const durationH = diffMinutes(startAt, endAt) / 60;
  const now = nowLocal();
  Object.assign(result, { department_id: departmentId, duration_hours: durationH });

  // --- Booking rules -------------------------------------------------------
  if (startAt < now) add('past', 'The selected time is in the past.');
  else if (startAt < addMinutes(now, Math.round(rules.min_notice_hours * 60))) {
    add('min_notice', `Bookings must be made at least ${rules.min_notice_hours} hour(s) in advance.`);
  }
  const maxH = isFaculty ? rules.max_hours_faculty : rules.max_hours_student;
  if (durationH > maxH) add('max_duration', `Maximum booking duration for ${roleLabel} is ${maxH} hours (requested ${durationH}h).`);
  const adv = isFaculty ? rules.advance_days_faculty : rules.advance_days_student;
  if (input.booking_date > addDays(today(), adv)) add('advance_limit', `${isFaculty ? 'Faculty' : 'Students'} can book at most ${adv} days in advance.`);
  if (user.restricted_until && user.restricted_until > now) {
    add('restricted', `Your booking privileges are restricted until ${humanDateTime(user.restricted_until)} due to repeated late returns.`);
  }
  if (rules.block_with_overdue) {
    const overdue = get(`SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND booking_status = 'overdue'`, user.id).n;
    if (overdue) add('has_overdue', 'You have overdue equipment. Return it before making new bookings.');
  }
  if (user.role === 'student') {
    const active = get(
      `SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND booking_id != ? AND booking_status IN ('pending','approved','reserved','in_use')`,
      user.id,
      excludeId,
    ).n;
    if (active >= rules.max_active_bookings_student) add('max_active', `Students may hold at most ${rules.max_active_bookings_student} active bookings (you have ${active}).`);
  }

  // --- Lab -----------------------------------------------------------------
  if (lab) {
    const check = checkLab(lab, startAt, endAt, { excludeId, rules });
    for (const p of check.problems) add(p.code, p.message);
    if (input.attendees > lab.capacity) add('capacity', `${lab.name} seats ${lab.capacity}; you requested ${input.attendees} attendees.`);
    if (lab.restricted_to_department && user.role === 'student' && user.department_id !== lab.department_id) {
      add('dept_restricted', `${lab.name} can only be booked by students of its own department.`);
    }
    result.lab = {
      id: lab.id,
      name: lab.name,
      code: lab.code,
      capacity: lab.capacity,
      available: check.available,
      conflicts: check.conflicts.map((c) => ({ ref_code: c.ref_code, start_time: timeOf(c.start_at), end_time: timeOf(c.end_at), status: c.status })),
      blocks: check.blocks.map((b) => ({ title: b.title, kind: b.kind, start_time: timeOf(b.start_at), end_time: timeOf(b.end_at) })),
    };
  } else if (equipment.length) {
    // Equipment-only bookings follow the opening hours of the lab that stores the first item.
    const hours = equipment[0].eq.open_time ? { ...equipment[0].eq, name: equipment[0].eq.lab_name } : DEFAULT_HOURS;
    for (const p of hoursProblems(hours, startAt, endAt, rules)) add(p.code, p.message);
  }

  // --- Equipment -----------------------------------------------------------
  const maxQtyRule = isFaculty ? rules.max_equipment_qty_faculty : rules.max_equipment_qty_student;
  let totalQty = 0;
  result.items = equipment.map(({ equipment_id, quantity, eq }) => {
    totalQty += quantity;
    const av = equipmentAvailability(eq, startAt, endAt, excludeId);
    const limit = Math.min(maxQtyRule, eq.max_per_booking || Infinity);
    if (quantity > limit) add('max_quantity', `You can book at most ${limit} × ${eq.name} per booking.`, { equipment_id });
    if (eq.maintenance_status === 'retired') add('equipment_retired', `${eq.name} has been retired.`, { equipment_id });
    else if (av.available < quantity) {
      add(
        'insufficient_quantity',
        av.available > 0
          ? `Requested ${quantity} × ${eq.name}, but only ${av.available} ${av.available === 1 ? 'is' : 'are'} available for this time slot.`
          : `${eq.name} is fully booked for this time slot.`,
        { equipment_id, available: av.available },
      );
    }
    if (eq.restricted_to_department && user.role === 'student' && user.department_id !== eq.lab_department_id) {
      add('dept_restricted', `${eq.name} can only be booked by students of its own department.`, { equipment_id });
    }
    if (eq.condition === 'poor') warnings.push(`${eq.name} is in poor condition.`);
    return { equipment_id, name: eq.name, lab_name: eq.lab_name, requested: quantity, available: av.available, total: eq.total_quantity, ok: av.available >= quantity };
  });

  result.approval = computeApproval(user, rules, lab, equipment.map((e) => e.eq), durationH, totalQty);
  result.priority = computePriority(user, input, rules, startAt);
  result.ok = errors.length === 0;
  result.can_waitlist = !result.ok && errors.every((e) => WAITLISTABLE.has(e.code));

  // --- Alternatives (Conflict → suggestions) --------------------------------
  if (withAlternatives && errors.some((e) => AVAILABILITY_CODES.has(e.code))) {
    const alt = { slots: [], labs: [], equipment: [] };
    alt.slots = findAlternativeSlots({
      labId: lab?.id,
      items: input.items,
      date: input.booking_date,
      start_time: input.start_time,
      end_time: input.end_time,
      excludeId,
    });
    if (lab) {
      const needs = groupNeeds(equipment);
      alt.labs = recommendLabs({ ...input, date: input.booking_date, needs, user, department_id: lab.department_id, exclude_lab_id: lab.id })
        .filter((l) => l.available)
        .slice(0, 3);
    }
    for (const e of errors.filter((x) => x.code === 'insufficient_quantity')) {
      const item = input.items.find((i) => i.equipment_id === e.equipment_id);
      alt.equipment.push({
        equipment_id: e.equipment_id,
        requested: item.quantity,
        available: e.available,
        alternatives: equipmentAlternatives(e.equipment_id, item.quantity, startAt, endAt, excludeId),
      });
    }
    result.alternatives = alt;
  }
  return result;
}

function groupNeeds(equipment) {
  const byCat = new Map();
  for (const { eq, quantity } of equipment) if (eq.category_id) byCat.set(eq.category_id, (byCat.get(eq.category_id) || 0) + quantity);
  return [...byCat].map(([category_id, quantity]) => ({ category_id, quantity }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function newRef() {
  const d = today().replace(/-/g, '').slice(2);
  for (;;) {
    const ref = `BK-${d}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    if (!get('SELECT 1 FROM bookings WHERE ref_code = ?', ref)) return ref;
  }
}

export function addEvent(bookingId, actorId, action, fromStatus, toStatus, note = null) {
  insert(
    'INSERT INTO booking_events (booking_id, actor_id, action, from_status, to_status, note) VALUES (?, ?, ?, ?, ?, ?)',
    bookingId,
    actorId,
    action,
    fromStatus,
    toStatus,
    note,
  );
}

function setStatus(booking, toStatus, actorId, action, note, extra = {}) {
  updateRow('bookings', booking.id, { booking_status: toStatus, updated_at: nowLocal(), ...extra });
  addEvent(booking.id, actorId, action, booking.status, toStatus, note);
  booking.status = toStatus;
  booking.booking_status = toStatus;
}

export function getBookingRow(id) {
  const b = get(`SELECT ${BOOKING_COLS()} FROM bookings b WHERE b.booking_id = ?`, id);
  if (!b) throw notFound('Booking');
  return b;
}

function describe(booking) {
  const lab = booking.lab_id ? getLab(booking.lab_id)?.name : null;
  const items = all(
    'SELECT e.equipment_name AS name, bi.quantity FROM booking_items bi JOIN equipment e ON e.equipment_id = bi.equipment_id WHERE bi.booking_id = ?',
    booking.id,
  );
  const parts = [lab, ...items.map((i) => `${i.quantity} × ${i.name}`)].filter(Boolean);
  return `${parts.join(' + ')} on ${humanDateTime(booking.start_at)}–${timeOf(booking.end_at)}`;
}

const link = (b) => `/bookings/${b.id}`;

export function assertCanManageBooking(user, booking, perm) {
  if (!hasPerm(user, perm)) throw forbidden();
  if (!inScope(user, booking.department_id)) throw forbidden('This booking belongs to another department');
}

function bookingResources(bookingId) {
  return all('SELECT equipment_id, quantity FROM booking_items WHERE booking_id = ?', bookingId);
}

/** Minimal availability re-check used at approval time (rules were checked at submission). */
function recheckAvailability(booking) {
  const problems = [];
  if (booking.lab_id) {
    const check = checkLab(getLab(booking.lab_id), booking.start_at, booking.end_at, { excludeId: booking.id });
    problems.push(...check.problems);
  }
  for (const item of bookingResources(booking.id)) {
    const eq = loadEquipment(item.equipment_id);
    const av = equipmentAvailability(eq, booking.start_at, booking.end_at, booking.id);
    if (av.available < item.quantity) problems.push({ code: 'insufficient_quantity', message: `Only ${av.available} × ${eq.name} available (requested ${item.quantity}).` });
  }
  return problems;
}

/** Pending-request conflict status, used by the approvals queue and conflict center. */
export function pendingConflictInfo(booking) {
  const problems = recheckAvailability(booking).filter((p) => ['lab_conflict', 'lab_blocked', 'insufficient_quantity', 'lab_unavailable'].includes(p.code));
  const competing = booking.lab_id
    ? all(
        `SELECT booking_id AS id, ref_code, priority_score FROM bookings
          WHERE lab_id = ? AND booking_id != ? AND booking_status = 'pending' AND start_at < ? AND end_at > ?`,
        booking.lab_id,
        booking.id,
        booking.end_at,
        booking.start_at,
      )
    : [];
  return { available: problems.length === 0, problems, competing };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
export function createBooking(user, body) {
  const input = normalizeInput(body);
  const isDraft = Boolean(body.draft);

  const result = tx(() => {
    let evaluation = null;
    if (isDraft) {
      if (!input.lab_id && !input.items.length) throw badRequest('Select a lab or equipment before saving a draft.');
      if (!isDate(input.booking_date) || !isTime(input.start_time) || !isTime(input.end_time) || input.end_time <= input.start_time) {
        throw badRequest('Choose a valid date and time range before saving a draft.');
      }
    } else {
      evaluation = evaluateBooking(user, input, { withAlternatives: true });
      if (!evaluation.ok) {
        recordDemandMisses(user, input, evaluation);
        throw new HttpError(422, evaluation.errors[0]?.message || 'Booking cannot be submitted', { evaluation });
      }
    }

    const startAt = `${input.booking_date}T${input.start_time}`;
    const endAt = `${input.booking_date}T${input.end_time}`;
    const lab = input.lab_id ? getLab(input.lab_id) : null;
    const firstEq = input.items[0] ? loadEquipment(input.items[0].equipment_id) : null;
    const departmentId = lab?.department_id ?? firstEq?.lab_department_id ?? user.department_id ?? null;
    const autoApproved = evaluation && evaluation.approval.level === 'none';
    const status = isDraft ? 'draft' : autoApproved ? 'approved' : 'pending';
    const { resource_type, resource_id } = resourceOf(input);
    const now = nowLocal();

    const id = insert(
      `INSERT INTO bookings (user_id, resource_type, resource_id, booking_date, start_time, end_time, purpose, approval_status,
         booking_status, ref_code, department_id, lab_id, start_at, end_at, purpose_type, attendees, priority, priority_score,
         required_approval, approved_at, qr_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      user.id,
      resource_type,
      resource_id,
      input.booking_date,
      input.start_time,
      input.end_time,
      input.purpose,
      isDraft ? 'none' : autoApproved ? 'auto' : 'pending',
      status,
      newRef(),
      departmentId,
      input.lab_id,
      startAt,
      endAt,
      input.purpose_type,
      input.attendees,
      evaluation?.priority.level || 'normal',
      evaluation?.priority.score || 0,
      evaluation?.approval.level === 'none' ? 'none' : evaluation?.approval.level || 'staff',
      autoApproved ? now : null,
      crypto.randomBytes(12).toString('hex'),
      now,
      now,
    );
    for (const i of input.items) insert('INSERT INTO booking_items (booking_id, equipment_id, quantity) VALUES (?, ?, ?)', id, i.equipment_id, i.quantity);

    const booking = getBookingRow(id);
    addEvent(id, user.id, isDraft ? 'draft_saved' : 'submitted', null, isDraft ? 'draft' : 'pending', input.purpose || null);
    if (!isDraft) afterSubmit(booking, user, evaluation);
    logActivity(user.id, 'booking', id, isDraft ? 'draft_saved' : 'created', { ref: booking.ref_code });
    return { booking: getBookingRow(id), evaluation };
  });
  syncAvailableQuantities();
  return result;
}

function afterSubmit(booking, user, evaluation) {
  if (booking.status === 'approved') {
    addEvent(booking.id, null, 'auto_approved', 'pending', 'approved', evaluation.approval.reasons.join('; '));
    notify(user.id, { type: 'booking_approved', title: `Booking confirmed — ${booking.ref_code}`, message: `${describe(booking)} was approved automatically.`, link: link(booking) });
    promoteIfImminent(booking);
  } else {
    notify(user.id, { type: 'booking_submitted', title: `Request submitted — ${booking.ref_code}`, message: `${describe(booking)} is awaiting ${booking.required_approval} approval.`, link: link(booking) });
    const roles = booking.required_approval === 'coordinator' ? ['coordinator'] : ['staff', 'coordinator'];
    notifyDepartment(
      booking.department_id,
      roles,
      {
        type: 'approval_needed',
        title: `${booking.priority === 'urgent' ? '[URGENT] ' : ''}New booking request ${booking.ref_code}`,
        message: `${user.name} requested ${describe(booking)}.`,
        link: link(booking),
      },
      { excludeUserId: user.id },
    );
  }
}

function recordDemandMisses(user, input, evaluation) {
  const startAt = `${input.booking_date}T${input.start_time}`;
  for (const e of evaluation.errors) {
    if (e.code === 'insufficient_quantity') {
      const item = input.items.find((i) => i.equipment_id === e.equipment_id);
      insert('INSERT INTO demand_misses (resource_type, resource_id, requested_qty, available_qty, start_at, user_id) VALUES (?,?,?,?,?,?)', 'equipment', e.equipment_id, item?.quantity, e.available, startAt, user.id);
    }
    if (e.code === 'lab_conflict' && input.lab_id) {
      insert('INSERT INTO demand_misses (resource_type, resource_id, requested_qty, available_qty, start_at, user_id) VALUES (?,?,?,?,?,?)', 'lab', input.lab_id, 1, 0, startAt, user.id);
    }
  }
}

export function updateDraft(user, booking, body) {
  if (booking.user_id !== user.id) throw forbidden();
  if (booking.status !== 'draft') throw badRequest('Only drafts can be edited. Cancel and re-book to change a submitted request.');
  const input = normalizeInput(body);
  if (!input.lab_id && !input.items.length) throw badRequest('Select a lab or equipment.');
  if (!isDate(input.booking_date) || !isTime(input.start_time) || !isTime(input.end_time) || input.end_time <= input.start_time) {
    throw badRequest('Choose a valid date and time range.');
  }
  tx(() => {
    const lab = input.lab_id ? getLab(input.lab_id) : null;
    const firstEq = input.items[0] ? loadEquipment(input.items[0].equipment_id) : null;
    updateRow('bookings', booking.id, {
      lab_id: input.lab_id,
      ...resourceOf(input),
      department_id: lab?.department_id ?? firstEq?.lab_department_id ?? user.department_id,
      booking_date: input.booking_date,
      start_time: input.start_time,
      end_time: input.end_time,
      start_at: `${input.booking_date}T${input.start_time}`,
      end_at: `${input.booking_date}T${input.end_time}`,
      purpose: input.purpose,
      purpose_type: input.purpose_type,
      attendees: input.attendees,
      updated_at: nowLocal(),
    });
    run('DELETE FROM booking_items WHERE booking_id = ?', booking.id);
    for (const i of input.items) insert('INSERT INTO booking_items (booking_id, equipment_id, quantity) VALUES (?, ?, ?)', booking.id, i.equipment_id, i.quantity);
  });
  return getBookingRow(booking.id);
}

export function inputFromBooking(booking) {
  return normalizeInput({ ...booking, items: bookingResources(booking.id) });
}

export function submitDraft(user, booking) {
  if (booking.user_id !== user.id) throw forbidden();
  if (booking.status !== 'draft') throw badRequest('This booking has already been submitted.');
  const result = tx(() => {
    const input = inputFromBooking(booking);
    const evaluation = evaluateBooking(user, input, { excludeId: booking.id });
    if (!evaluation.ok) throw new HttpError(422, evaluation.errors[0].message, { evaluation });
    const auto = evaluation.approval.level === 'none';
    updateRow('bookings', booking.id, {
      booking_status: auto ? 'approved' : 'pending',
      approval_status: auto ? 'auto' : 'pending',
      approved_at: auto ? nowLocal() : null,
      required_approval: evaluation.approval.level,
      priority: evaluation.priority.level,
      priority_score: evaluation.priority.score,
      created_at: nowLocal(),
      updated_at: nowLocal(),
    });
    addEvent(booking.id, user.id, 'submitted', 'draft', 'pending');
    afterSubmit(getBookingRow(booking.id), user, evaluation);
    return getBookingRow(booking.id);
  });
  syncAvailableQuantities();
  return result;
}

/** Approved → Reserved once the booking is within the reservation lead time. */
export function promoteIfImminent(booking) {
  if (booking.status !== 'approved') return;
  if (booking.start_at <= addMinutes(nowLocal(), RESERVE_LEAD_HOURS * 60)) {
    setStatus(booking, 'reserved', null, 'reserved', 'Time slot and equipment locked for this booking');
    notify(booking.user_id, {
      type: 'booking_reserved',
      title: `Reserved — ${booking.ref_code}`,
      message: `${describe(booking)} is reserved. Show your booking QR code at the lab.`,
      link: link(booking),
    });
  }
}

export function approveBooking(actor, booking, note) {
  assertCanManageBooking(actor, booking, 'bookings.approve');
  if (booking.status !== 'pending') throw badRequest(`Only pending requests can be approved (current status: ${booking.status}).`);
  if (booking.required_approval === 'coordinator' && !hasPerm(actor, 'bookings.approve_coordinator')) {
    throw forbidden('This request requires coordinator approval. Escalate it to the department coordinator instead.');
  }
  const result = tx(() => {
    const problems = recheckAvailability(booking);
    if (problems.length) throw conflict(`Cannot approve: ${problems[0].message}`, { problems });
    setStatus(booking, 'approved', actor.id, 'approved', note || null, { approval_status: 'approved', approved_by: actor.id, approved_at: nowLocal() });
    notify(booking.user_id, {
      type: 'booking_approved',
      title: `Booking approved — ${booking.ref_code}`,
      message: `${describe(booking)} was approved by ${actor.name}.${note ? ` Note: ${note}` : ''}`,
      link: link(booking),
    });
    logActivity(actor.id, 'booking', booking.id, 'approved', { ref: booking.ref_code, note });
    promoteIfImminent(booking);
    return getBookingRow(booking.id);
  });
  syncAvailableQuantities();
  return result;
}

export const REJECTION_CATEGORIES = ['conflict', 'unavailable', 'rules', 'maintenance', 'insufficient_justification', 'priority', 'other'];

export function rejectBooking(actor, booking, reason, category = 'other') {
  assertCanManageBooking(actor, booking, 'bookings.approve');
  if (booking.status !== 'pending') throw badRequest('Only pending requests can be rejected.');
  if (!reason || !String(reason).trim()) throw badRequest('A rejection reason is required.');
  if (!REJECTION_CATEGORIES.includes(category)) category = 'other';
  return tx(() => {
    setStatus(booking, 'rejected', actor.id, 'rejected', reason, {
      approval_status: 'rejected',
      approved_by: actor.id,
      rejection_reason: String(reason).trim(),
      rejection_category: category,
    });
    notify(booking.user_id, {
      type: 'booking_rejected',
      title: `Booking rejected — ${booking.ref_code}`,
      message: `${describe(booking)} was rejected. Reason: ${reason}. Try the Smart Finder for alternatives.`,
      link: link(booking),
    });
    logActivity(actor.id, 'booking', booking.id, 'rejected', { ref: booking.ref_code, reason, category });
    return getBookingRow(booking.id);
  });
}

export function escalateBooking(actor, booking, note) {
  assertCanManageBooking(actor, booking, 'bookings.approve');
  if (booking.status !== 'pending') throw badRequest('Only pending requests can be escalated.');
  return tx(() => {
    updateRow('bookings', booking.id, { required_approval: 'coordinator', escalated: 1, updated_at: nowLocal() });
    addEvent(booking.id, actor.id, 'escalated', 'pending', 'pending', note || 'Escalated to department coordinator');
    notifyDepartment(booking.department_id, ['coordinator'], {
      type: 'approval_needed',
      title: `Escalated request ${booking.ref_code}`,
      message: `${actor.name} escalated ${describe(booking)} for your review.${note ? ` Note: ${note}` : ''}`,
      link: link(booking),
    });
    logActivity(actor.id, 'booking', booking.id, 'escalated', { ref: booking.ref_code, note });
    return getBookingRow(booking.id);
  });
}

export function cancelBooking(actor, booking, reason) {
  const isOwner = booking.user_id === actor.id;
  if (!isOwner && !canManage(actor, booking.department_id, 'bookings.approve')) throw forbidden();
  if (!['draft', 'pending', 'approved', 'reserved'].includes(booking.status)) {
    throw badRequest(`A booking that is ${booking.status.replace('_', ' ')} cannot be cancelled.`);
  }
  const wasHolding = ['approved', 'reserved'].includes(booking.status);
  const result = tx(() => {
    setStatus(booking, 'cancelled', actor.id, 'cancelled', reason || null, { cancel_reason: reason || (isOwner ? 'Cancelled by user' : 'Cancelled by staff') });
    if (!isOwner) {
      notify(booking.user_id, {
        type: 'booking_cancelled',
        title: `Booking cancelled — ${booking.ref_code}`,
        message: `${describe(booking)} was cancelled by ${actor.name}.${reason ? ` Reason: ${reason}` : ''}`,
        link: link(booking),
      });
    } else {
      notify(actor.id, { type: 'booking_cancelled', title: `Booking cancelled — ${booking.ref_code}`, message: `You cancelled ${describe(booking)}.`, link: link(booking) });
      if (wasHolding) {
        notifyDepartment(booking.department_id, ['staff'], {
          type: 'booking_cancelled',
          title: `Booking cancelled — ${booking.ref_code}`,
          message: `${actor.name} cancelled ${describe(booking)}.`,
          link: link(booking),
        });
      }
    }
    logActivity(actor.id, 'booking', booking.id, 'cancelled', { ref: booking.ref_code, reason });
    if (wasHolding) releaseResources(booking);
    return getBookingRow(booking.id);
  });
  syncAvailableQuantities();
  return result;
}

/** Issue equipment and/or grant lab access: Approved/Reserved → In Use. */
export function checkInBooking(actor, booking) {
  assertCanManageBooking(actor, booking, 'bookings.issue');
  if (!['approved', 'reserved'].includes(booking.status)) throw badRequest(`Cannot check in a booking that is ${booking.status}.`);
  const now = nowLocal();
  if (now < addMinutes(booking.start_at, -EARLY_CHECKIN_MINUTES)) {
    throw badRequest(`Too early — check-in opens ${EARLY_CHECKIN_MINUTES} minutes before the start time (${humanDateTime(addMinutes(booking.start_at, -EARLY_CHECKIN_MINUTES))}).`);
  }
  if (now >= booking.end_at) throw badRequest('This booking has already ended.');
  const result = tx(() => {
    const items = all(
      `SELECT bi.*, e.equipment_name AS name, e.total_quantity, e.maintenance_quantity, e.missing_quantity
         FROM booking_items bi JOIN equipment e ON e.equipment_id = bi.equipment_id WHERE bi.booking_id = ?`,
      booking.id,
    );
    for (const item of items) {
      const out = get('SELECT COALESCE(SUM(quantity),0) AS q FROM issues WHERE equipment_id = ? AND returned_at IS NULL', item.equipment_id).q;
      const onShelf = equipmentBase(item) - out;
      if (onShelf < item.quantity) throw conflict(`Only ${onShelf} × ${item.name} physically on the shelf (others not yet returned).`);
      insert(
        'INSERT INTO issues (booking_id, equipment_id, quantity, issued_at, due_at, booking_item_id, issued_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        booking.id,
        item.equipment_id,
        item.quantity,
        now,
        booking.end_at,
        item.id,
        actor.id,
      );
      logActivity(actor.id, 'equipment', item.equipment_id, 'issued', { quantity: item.quantity, booking: booking.ref_code });
    }
    const what = [booking.lab_id ? 'lab access granted' : null, items.length ? `${items.reduce((s, i) => s + i.quantity, 0)} item(s) issued` : null].filter(Boolean).join(', ');
    setStatus(booking, 'in_use', actor.id, 'checked_in', what, { checked_in_at: now });
    notify(booking.user_id, {
      type: 'checked_in',
      title: `Checked in — ${booking.ref_code}`,
      message: `${what[0].toUpperCase()}${what.slice(1)}. ${items.length ? `Please return all equipment by ${humanDateTime(booking.end_at)}.` : ''}`,
      link: link(booking),
    });
    if (booking.lab_id) logActivity(actor.id, 'lab', booking.lab_id, 'access_granted', { booking: booking.ref_code });
    return getBookingRow(booking.id);
  });
  syncAvailableQuantities();
  return result;
}

/**
 * Return equipment. payload.items: [{ issue_id, good, damaged, missing, remarks }]
 * Damaged units go to maintenance, missing units are tracked, late returns count toward penalties.
 */
export function returnBooking(actor, booking, payload, imagePath = null) {
  assertCanManageBooking(actor, booking, 'bookings.issue');
  if (!['in_use', 'overdue'].includes(booking.status)) throw badRequest(`Cannot return a booking that is ${booking.status}.`);
  const open = all(
    `SELECT ${ISSUE_COLS()}, e.equipment_name AS name FROM issues i JOIN equipment e ON e.equipment_id = i.equipment_id
      WHERE i.booking_id = ? AND i.returned_at IS NULL`,
    booking.id,
  );
  if (!open.length) throw badRequest('No outstanding equipment on this booking. Use "Complete" to check out the lab.');
  const byId = new Map((payload.items || []).map((i) => [Number(i.issue_id), i]));
  const now = nowLocal();

  const result = tx(() => {
    let anyDamage = false;
    let late = false;
    for (const issue of open) {
      const r = byId.get(issue.id) || { good: issue.quantity, damaged: 0, missing: 0 };
      const good = Math.max(0, Number(r.good) || 0);
      const damaged = Math.max(0, Number(r.damaged) || 0);
      const missing = Math.max(0, Number(r.missing) || 0);
      if (good + damaged + missing !== issue.quantity) {
        throw badRequest(`${issue.name}: good + damaged + missing must equal ${issue.quantity}.`);
      }
      const isLate = now > addMinutes(issue.due_at, LATE_GRACE_MINUTES);
      late ||= isLate;
      const condition = missing ? 'missing' : damaged ? 'damaged' : 'good';
      updateRow('issues', issue.id, {
        returned_at: now,
        received_by: actor.id,
        returned_good: good,
        returned_damaged: damaged,
        returned_missing: missing,
        return_condition: condition,
        remarks: r.remarks || payload.remarks || null,
        damage_image: damaged || missing ? imagePath : null,
        is_late: isLate ? 1 : 0,
      });
      if (damaged || missing) {
        anyDamage = true;
        run(
          `UPDATE equipment SET maintenance_quantity = maintenance_quantity + ?, missing_quantity = missing_quantity + ?,
             maintenance_status = CASE WHEN ? > 0 AND maintenance_status = 'operational' THEN 'needs_inspection' ELSE maintenance_status END
           WHERE equipment_id = ?`,
          damaged,
          missing,
          damaged,
          issue.equipment_id,
        );
        if (damaged) {
          insert(
            `INSERT INTO damage_reports (equipment_id, booking_id, issue_id, reported_by, responsible_user_id, kind, quantity, severity, description, image_path)
             VALUES (?, ?, ?, ?, ?, 'damaged', ?, ?, ?, ?)`,
            issue.equipment_id, booking.id, issue.id, actor.id, booking.user_id, damaged, payload.severity || 'medium',
            r.remarks || payload.remarks || 'Damaged on return', imagePath,
          );
        }
        if (missing) {
          insert(
            `INSERT INTO damage_reports (equipment_id, booking_id, issue_id, reported_by, responsible_user_id, kind, quantity, severity, description)
             VALUES (?, ?, ?, ?, ?, 'missing', ?, 'high', ?)`,
            issue.equipment_id, booking.id, issue.id, actor.id, booking.user_id, missing, r.remarks || 'Not returned',
          );
        }
      }
      logActivity(actor.id, 'equipment', issue.equipment_id, 'returned', { booking: booking.ref_code, good, damaged, missing, late: isLate });
    }

    const final = anyDamage ? 'damaged' : late ? 'returned_late' : 'completed';
    const note = [anyDamage ? 'Damage/missing items recorded' : null, late ? 'Returned after due time' : null].filter(Boolean).join('; ') || 'All items returned in good condition';
    setStatus(booking, final, actor.id, 'returned', note, { completed_at: now });
    notify(booking.user_id, {
      type: 'returned',
      title: `Return recorded — ${booking.ref_code}`,
      message: `${note}. Thank you!`,
      link: link(booking),
    });
    if (late) applyLatePenalty(booking.user_id, booking);
    for (const issue of open) processWaitlist('equipment', issue.equipment_id);
    if (booking.lab_id) processWaitlist('lab', booking.lab_id);
    return getBookingRow(booking.id);
  });
  syncAvailableQuantities();
  return result;
}

/** Lab-only (or fully returned) booking check-out: In Use → Completed. */
export function completeBooking(actor, booking) {
  assertCanManageBooking(actor, booking, 'bookings.issue');
  if (booking.status !== 'in_use') throw badRequest('Only bookings in use can be completed.');
  const outstanding = get('SELECT COUNT(*) AS n FROM issues WHERE booking_id = ? AND returned_at IS NULL', booking.id).n;
  if (outstanding) throw badRequest('Equipment is still outstanding — record the return first.');
  return tx(() => {
    setStatus(booking, 'completed', actor.id, 'completed', 'Lab checked out', { completed_at: nowLocal() });
    if (booking.lab_id) processWaitlist('lab', booking.lab_id);
    return getBookingRow(booking.id);
  });
}

export function applyLatePenalty(userId, booking) {
  const user = get('SELECT * FROM users WHERE id = ?', userId);
  const rules = getRules(booking.department_id);
  const count = user.late_return_count + 1;
  if (count >= rules.late_return_limit) {
    const until = `${addDays(today(), rules.restriction_days)}T23:59`;
    updateRow('users', userId, { late_return_count: count, restricted_until: until });
    notify(userId, {
      type: 'restriction',
      title: 'Booking privileges restricted',
      message: `You have ${count} late returns. New bookings are blocked until ${humanDateTime(until)}.`,
      link: '/profile',
    });
    logActivity(null, 'user', userId, 'restricted', { until, late_returns: count });
  } else {
    updateRow('users', userId, { late_return_count: count });
    notify(userId, {
      type: 'late_warning',
      title: 'Late return recorded',
      message: `This is late return ${count} of ${rules.late_return_limit}. Reaching the limit restricts bookings for ${rules.restriction_days} days.`,
      link: '/profile',
    });
  }
}

// ---------------------------------------------------------------------------
// Waitlist: notify users when a resource they wanted becomes available
// ---------------------------------------------------------------------------
export function releaseResources(booking) {
  if (booking.lab_id) processWaitlist('lab', booking.lab_id);
  for (const i of bookingResources(booking.id)) processWaitlist('equipment', i.equipment_id);
}

export function processWaitlist(resourceType, resourceId) {
  const entries = all(
    `SELECT * FROM waitlist WHERE resource_type = ? AND resource_id = ? AND status = 'waiting' AND start_at > ? ORDER BY created_at`,
    resourceType,
    resourceId,
    nowLocal(),
  );
  for (const w of entries) {
    let ok = false;
    let name = '';
    if (resourceType === 'lab') {
      const lab = getLab(resourceId);
      if (!lab) continue;
      name = lab.name;
      ok = checkLab(lab, w.start_at, w.end_at).available;
    } else {
      const eq = getEquipmentRow(resourceId);
      if (!eq) continue;
      name = `${w.quantity} × ${eq.name}`;
      ok = equipmentAvailability(eq, w.start_at, w.end_at).available >= w.quantity;
    }
    if (!ok) continue;
    updateRow('waitlist', w.id, { status: 'notified', notified_at: nowLocal() });
    const q = new URLSearchParams({
      [resourceType === 'lab' ? 'lab' : 'equipment']: String(resourceId),
      ...(resourceType === 'equipment' ? { qty: String(w.quantity) } : {}),
      date: dateOf(w.start_at),
      start: timeOf(w.start_at),
      end: timeOf(w.end_at),
    });
    notify(w.user_id, {
      type: 'resource_available',
      title: `Now available: ${name}`,
      message: `${name} is now free on ${humanDateTime(w.start_at)}–${timeOf(w.end_at)}. Book it before someone else does!`,
      link: `/book?${q}`,
    });
  }
}
