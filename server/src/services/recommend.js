import { all, get, parseJSON, getLab, getEquipmentRow, LAB_COLS, EQ_COLS } from '../db.js';
import { getRules } from './rules.js';
import { checkLab, equipmentAvailability, hoursProblems, DEFAULT_HOURS } from './availability.js';
import { addDays, addMinutes, fromMinutes, nowLocal, toMinutes, today, diffMinutes } from '../utils/time.js';

// Domain vocabulary used to match a user's purpose with what a lab offers.
const DOMAINS = {
  embedded: ['arduino', 'embedded', 'microcontroller', 'iot', 'sensor', 'raspberry', 'esp32', 'stm32', 'firmware', 'robot', 'robotics'],
  electronics: ['oscilloscope', 'circuit', 'electronics', 'multimeter', 'soldering', 'digital', 'logic', 'signal', 'pcb', 'analog'],
  power: ['power', 'machine', 'motor', 'transformer', 'grid', 'energy', 'high voltage'],
  networking: ['network', 'networking', 'router', 'switch', 'cisco', 'ccna', 'lan', 'subnet', 'routing', 'firewall', 'cable'],
  computing: ['programming', 'software', 'coding', 'computer', 'web', 'database', 'java', 'python', 'workstation', 'algorithm'],
  ai: ['ai', 'machine learning', 'ml', 'deep learning', 'gpu', 'data science', 'neural', 'vision', 'llm', 'model training'],
  media: ['camera', 'video', 'photo', 'photography', 'film', 'studio', 'shoot', 'documentary', 'podcast', 'audio', 'recording', 'editing', 'green screen', 'drone'],
  design: ['cad', 'solidworks', '3d', 'printer', 'printing', 'modeling', 'autocad', 'design', 'prototype'],
  fabrication: ['cnc', 'lathe', 'laser cutter', 'fabrication', 'workshop', 'welding', 'machining'],
  physics: ['optics', 'laser', 'physics', 'spectrometer', 'photonics', 'interference', 'wave', 'lens', 'spectroscopy'],
  vr: ['vr', 'virtual reality', 'ar', 'augmented', 'headset', 'unity', 'game'],
};

function domainsOf(text) {
  const t = ` ${String(text || '').toLowerCase()} `;
  const found = new Set();
  for (const [domain, words] of Object.entries(DOMAINS)) {
    if (words.some((w) => new RegExp(`[^a-z]${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z]`).test(t))) found.add(domain);
  }
  return found;
}

/** Booked hours / open hours per lab over the last `days` days (0..1). */
export function labUtilization(days = 30) {
  const from = addDays(today(), -days);
  const rows = all(
    `SELECT lab_id, SUM((julianday(end_at) - julianday(start_at)) * 24) AS hours
       FROM bookings WHERE lab_id IS NOT NULL AND booking_date >= ? AND booking_date < ?
        AND booking_status IN ('approved','reserved','in_use','completed','overdue','returned_late','damaged')
      GROUP BY lab_id`,
    from,
    today(),
  );
  const labs = all('SELECT lab_id AS id, open_time, close_time FROM labs');
  const openDays = Math.round(days * (6 / 7));
  const map = new Map();
  for (const lab of labs) {
    const daily = (toMinutes(lab.close_time) - toMinutes(lab.open_time)) / 60;
    const hours = rows.find((r) => r.lab_id === lab.id)?.hours || 0;
    map.set(lab.id, Math.min(1, hours / Math.max(1, daily * openDays)));
  }
  return map;
}

/**
 * Smart Resource Recommendation: rank labs for a request by how well they fit.
 * criteria: { date, start_time, end_time, attendees, purpose, purpose_type, department_id,
 *             needs: [{ category_id, quantity }], user }
 */
export function recommendLabs(criteria) {
  const { date, start_time, end_time, attendees = 1, purpose = '', purpose_type = '', department_id, needs = [], user, exclude_lab_id } = criteria;
  const startAt = `${date}T${start_time}`;
  const endAt = `${date}T${end_time}`;
  const wanted = domainsOf(purpose);
  const util = labUtilization(30);
  const categories = new Map(all('SELECT id, name FROM categories').map((c) => [c.id, c.name]));
  for (const n of needs) for (const d of domainsOf(categories.get(Number(n.category_id)))) wanted.add(d);

  const labs = all(
    `SELECT ${LAB_COLS()}, d.name AS department_name, d.code AS department_code FROM labs l
       LEFT JOIN departments d ON d.id = l.department_id WHERE l.status != 'closed'`,
  );
  const preferredDept = Number(department_id) || user?.department_id || null;

  const results = labs
    .filter((l) => l.id !== Number(exclude_lab_id))
    .map((lab) => {
      const rules = getRules(lab.department_id);
      const check = checkLab(lab, startAt, endAt, { rules });
      const reasons = [];
      const warnings = [];
      let eligible = true;

      // Department access
      const sameDept = preferredDept && lab.department_id === preferredDept;
      if (lab.restricted_to_department && user && user.role === 'student' && user.department_id !== lab.department_id) {
        eligible = false;
        warnings.push(`Restricted to ${lab.department_code} students`);
      }

      // Capacity fit
      let capacityScore;
      if (attendees > lab.capacity) {
        capacityScore = (lab.capacity / attendees) * 0.4;
        eligible = false;
        warnings.push(`Capacity ${lab.capacity} is below ${attendees} attendees`);
      } else {
        const fill = attendees / lab.capacity;
        capacityScore = 0.6 + 0.4 * Math.min(1, fill / 0.85);
        reasons.push(`Capacity ${lab.capacity} fits ${attendees} attendee${attendees > 1 ? 's' : ''}`);
      }

      // Equipment fit: units of each needed category stored in this lab and free for the slot.
      const labEquipment = all(`SELECT ${EQ_COLS()} FROM equipment e WHERE e.lab_id = ? AND e.maintenance_status != ?`, lab.id, 'retired');
      let equipmentScore = 1;
      const equipmentMatches = [];
      if (needs.length) {
        const fits = needs.map((n) => {
          const qty = Math.max(1, Number(n.quantity) || 1);
          const candidates = labEquipment.filter((e) => e.category_id === Number(n.category_id));
          let free = 0;
          for (const e of candidates) {
            const av = equipmentAvailability(e, startAt, endAt).available;
            free += av;
            if (av > 0) equipmentMatches.push({ equipment_id: e.id, name: e.name, category_id: e.category_id, available: av, quantity: Math.min(qty, av) });
          }
          const name = categories.get(Number(n.category_id)) || 'equipment';
          if (free >= qty) reasons.push(`${free} ${name} free in this lab`);
          else if (free > 0) warnings.push(`Only ${free}/${qty} ${name} in this lab`);
          else warnings.push(`No ${name} in this lab`);
          return Math.min(1, free / qty);
        });
        equipmentScore = fits.reduce((a, b) => a + b, 0) / fits.length;
      }

      // Purpose / facility match
      const labDomains = domainsOf(
        [lab.name, lab.description, parseJSON(lab.facilities).join(' '), labEquipment.map((e) => e.name).join(' ')].join(' '),
      );
      let purposeScore = 0.5;
      if (wanted.size) {
        const hit = [...wanted].filter((d) => labDomains.has(d));
        purposeScore = hit.length / wanted.size;
        if (hit.length) reasons.push(`Suited for ${hit.join(', ')} work`);
      }

      const deptScore = sameDept ? 1 : 0.4;
      if (sameDept) reasons.push(`${lab.department_code} department lab`);
      const balanceScore = 1 - (util.get(lab.id) || 0);

      const weights = needs.length
        ? { equipment: 0.35, capacity: 0.22, purpose: 0.23, dept: 0.12, balance: 0.08 }
        : { equipment: 0, capacity: 0.38, purpose: 0.34, dept: 0.18, balance: 0.1 };
      const match = Math.round(
        100 *
          (weights.equipment * equipmentScore +
            weights.capacity * capacityScore +
            weights.purpose * purposeScore +
            weights.dept * deptScore +
            weights.balance * balanceScore),
      );

      const available = check.available && eligible;
      let next_slot = null;
      if (!check.available && eligible) {
        next_slot = findAlternativeSlots({ labId: lab.id, items: [], date, start_time, end_time, maxResults: 1, maxDays: 0 })[0] || null;
      }
      return {
        lab_id: lab.id,
        code: lab.code,
        name: lab.name,
        department_id: lab.department_id,
        department_code: lab.department_code,
        location: lab.location,
        capacity: lab.capacity,
        available,
        eligible,
        match,
        reasons,
        warnings: [...warnings, ...check.problems.map((p) => p.message)],
        equipment: equipmentMatches,
        utilization: Math.round((util.get(lab.id) || 0) * 100),
        next_slot,
      };
    });

  return results.sort((a, b) => (a.available === b.available ? b.match - a.match : a.available ? -1 : 1));
}

/**
 * Alternative Slot Recommendation: earliest feasible slots of the same duration,
 * scanning the requested day first, then the following days.
 */
export function findAlternativeSlots({ labId = null, items = [], date, start_time, end_time, excludeId = 0, maxResults = 6, maxDays = 7 }) {
  const duration = toMinutes(end_time) - toMinutes(start_time);
  if (duration <= 0) return [];
  const lab = labId ? getLab(labId) : null;
  const eqs = items
    .map((i) => ({ q: i.quantity, eq: get(`SELECT ${EQ_COLS()}, l.open_time, l.close_time, l.lab_name AS lab_name FROM equipment e LEFT JOIN labs l ON l.lab_id = e.lab_id WHERE e.equipment_id = ?`, i.equipment_id) }))
    .filter((x) => x.eq);
  const hours = lab || (eqs[0]?.eq.open_time ? eqs[0].eq : DEFAULT_HOURS);
  const rules = getRules(lab?.department_id || 0);
  const notBefore = addMinutes(nowLocal(), Math.round(rules.min_notice_hours * 60));
  const requested = toMinutes(start_time);
  const results = [];

  for (let d = 0; d <= maxDays && results.length < maxResults; d++) {
    const day = addDays(date, d);
    const dayResults = [];
    for (let t = toMinutes(hours.open_time); t + duration <= toMinutes(hours.close_time); t += 30) {
      const s = `${day}T${fromMinutes(t)}`;
      const e = `${day}T${fromMinutes(t + duration)}`;
      if (s < notBefore) continue;
      if (d === 0 && t === requested) continue; // that's the slot that failed
      if (hoursProblems(hours, s, e, rules).length) continue;
      if (lab && !checkLab(lab, s, e, { excludeId, rules }).available) continue;
      if (eqs.some(({ q, eq }) => equipmentAvailability(eq, s, e, excludeId).available < q)) continue;
      dayResults.push({ date: day, start_time: fromMinutes(t), end_time: fromMinutes(t + duration), distance: Math.abs(t - requested) + d * 10000 });
    }
    dayResults.sort((a, b) => a.distance - b.distance);
    results.push(...dayResults.slice(0, d === 0 ? 3 : 2));
  }
  return results.slice(0, maxResults).map(({ distance, ...r }) => ({
    ...r,
    label: r.date === date ? 'Same day' : diffMinutes(`${date}T00:00`, `${r.date}T00:00`) === 1440 ? 'Next day' : 'Another date',
  }));
}

/** Same-category equipment that can cover the requested quantity in the window. */
export function equipmentAlternatives(equipmentId, quantity, startAt, endAt, excludeId = 0) {
  const eq = getEquipmentRow(equipmentId);
  if (!eq) return [];
  return all(
    `SELECT ${EQ_COLS()}, l.lab_name AS lab_name, l.code AS lab_code FROM equipment e LEFT JOIN labs l ON l.lab_id = e.lab_id
      WHERE e.category_id = ? AND e.equipment_id != ? AND e.maintenance_status NOT IN ('retired','under_maintenance')`,
    eq.category_id,
    eq.id,
  )
    .map((e) => ({ equipment_id: e.id, name: e.name, lab_name: e.lab_name, available: equipmentAvailability(e, startAt, endAt, excludeId).available }))
    .filter((e) => e.available > 0)
    .sort((a, b) => (b.available >= quantity) - (a.available >= quantity) || b.available - a.available)
    .slice(0, 3);
}
