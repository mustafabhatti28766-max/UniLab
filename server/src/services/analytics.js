import { all, get } from '../db.js';
import { addDays, diffMinutes, parseLocal, today, toMinutes, nowLocal, WEEKDAYS } from '../utils/time.js';
import { equipmentBase } from './availability.js';

const USED = `('approved','reserved','in_use','completed','overdue','returned_late','damaged')`;
const hoursExpr = `((julianday(b.end_at) - julianday(b.start_at)) * 24)`;

function scopeSql(departmentId) {
  return departmentId
    ? { sql: ` AND b.department_id = ${Number(departmentId)}`, labSql: ` AND l.department_id = ${Number(departmentId)}` }
    : { sql: '', labSql: '' };
}

const round1 = (n) => Math.round(n * 10) / 10;

/** Occupied booking-hours per hour of day for a set of bookings. */
function spreadHours(bookings) {
  const hours = Array(24).fill(0);
  for (const b of bookings) {
    const sh = Number(b.start_at.slice(11, 13));
    const eh = Math.ceil(toMinutes(b.end_at.slice(11, 16)) / 60);
    for (let h = sh; h < Math.max(eh, sh + 1); h++) hours[h]++;
  }
  return hours;
}

export function overview({ departmentId = null, days = 90, labId = null } = {}) {
  const from = addDays(today(), -days);
  const to = addDays(today(), 1);
  const { sql, labSql } = scopeSql(departmentId);
  const inPeriod = `b.booking_date >= '${from}' AND b.booking_date < '${to}'${sql}`;

  const counts = get(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN b.approval_status IN ('approved','auto') THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN b.booking_status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN b.booking_status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN b.booking_status IN ('completed','returned_late','damaged') THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN b.booking_status = 'returned_late' THEN 1 ELSE 0 END) AS returned_late
    FROM bookings b WHERE b.booking_status != 'draft' AND ${inPeriod}`);

  const pendingNow = get(`SELECT COUNT(*) AS n FROM bookings b WHERE b.booking_status = 'pending'${sql}`).n;
  const issuedNow = get(`SELECT COALESCE(SUM(i.quantity),0) AS q FROM issues i JOIN bookings b ON b.booking_id = i.booking_id WHERE i.returned_at IS NULL${sql}`).q;
  const overdueNow = get(`SELECT COUNT(*) AS n FROM bookings b WHERE b.booking_status = 'overdue'${sql}`).n;
  const damage = get(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN r.status IN ('open','in_repair') THEN 1 ELSE 0 END) AS open
      FROM damage_reports r JOIN equipment e ON e.equipment_id = r.equipment_id LEFT JOIN labs l ON l.lab_id = e.lab_id
     WHERE r.created_at >= '${from}'${labSql}`);

  // Lab utilization over the period (booked hours / open hours on open days)
  const openDays = Math.max(1, Math.round(days * (6 / 7)));
  const labRows = all(`
    SELECT l.lab_id AS id, l.lab_name AS name, l.code, l.capacity, l.open_time, l.close_time, d.code AS department_code,
      COUNT(b.booking_id) AS bookings, COALESCE(SUM(${hoursExpr}),0) AS hours
    FROM labs l LEFT JOIN departments d ON d.id = l.department_id
    LEFT JOIN bookings b ON b.lab_id = l.lab_id AND b.booking_status IN ${USED} AND b.booking_date >= '${from}' AND b.booking_date < '${today()}'
    WHERE 1=1${labSql}
    GROUP BY l.lab_id ORDER BY hours DESC`);
  const labs = labRows.map((l) => {
    const capacityHours = ((toMinutes(l.close_time) - toMinutes(l.open_time)) / 60) * openDays;
    return { ...l, hours: round1(l.hours), utilization: Math.round((l.hours / capacityHours) * 100) };
  });
  const avgUtilization = labs.length ? Math.round(labs.reduce((s, l) => s + l.utilization, 0) / labs.length) : 0;

  const topEquipment = all(`
    SELECT e.equipment_id AS id, e.equipment_name AS name, c.name AS category, SUM(bi.quantity) AS units, COUNT(DISTINCT b.booking_id) AS bookings
      FROM booking_items bi JOIN bookings b ON b.booking_id = bi.booking_id JOIN equipment e ON e.equipment_id = bi.equipment_id
      LEFT JOIN categories c ON c.id = e.category_id
     WHERE b.booking_status IN ${USED} AND ${inPeriod}
     GROUP BY e.equipment_id ORDER BY units DESC LIMIT 8`);

  const months = all(`
    SELECT substr(b.booking_date, 1, 7) AS month, COUNT(*) AS bookings,
      SUM(CASE WHEN b.booking_status IN ${USED} THEN ${hoursExpr} ELSE 0 END) AS hours,
      SUM(CASE WHEN b.booking_status IN ('cancelled','rejected') THEN 1 ELSE 0 END) AS lost
    FROM bookings b WHERE b.booking_status != 'draft' AND b.booking_date >= '${addDays(today(), -180).slice(0, 7)}-01'${sql}
    GROUP BY month ORDER BY month`).map((m) => ({ ...m, hours: round1(m.hours) }));

  const statusBreakdown = all(`SELECT b.booking_status AS status, COUNT(*) AS count FROM bookings b WHERE b.booking_status != 'draft' AND ${inPeriod} GROUP BY b.booking_status ORDER BY count DESC`);

  // Peak hours + weekday × hour heatmap (optionally for a single lab)
  const used = all(
    `SELECT b.start_at, b.end_at, b.lab_id FROM bookings b WHERE b.booking_status IN ${USED} AND ${inPeriod}${labId ? ` AND b.lab_id = ${Number(labId)}` : ''}`,
  );
  const startsByHour = Array(24).fill(0);
  const byWeekday = Array.from({ length: 7 }, () => []);
  for (const b of used) {
    startsByHour[Number(b.start_at.slice(11, 13))]++;
    byWeekday[parseLocal(b.start_at).getDay()].push(b);
  }
  const peakHours = startsByHour.map((count, hour) => ({ hour, count })).filter((h) => h.hour >= 7 && h.hour <= 21);

  // Usage heatmap by lab: occupied booking-hours per lab and hour of day
  const labBookings = all(`SELECT b.start_at, b.end_at, b.lab_id FROM bookings b WHERE b.lab_id IS NOT NULL AND b.booking_status IN ${USED} AND ${inPeriod}`);
  const heatmapByLab = labs.map((l) => ({ id: l.id, label: l.name, hours: spreadHours(labBookings.filter((b) => b.lab_id === l.id)) }));

  // Usage heatmap by department (requester's department)
  const deptBookings = all(`
    SELECT b.start_at, b.end_at, COALESCE(d.code, '—') AS code FROM bookings b JOIN users u ON u.id = b.user_id
      LEFT JOIN departments d ON d.id = u.department_id WHERE b.booking_status IN ${USED} AND ${inPeriod}`);
  const deptCodes = [...new Set(deptBookings.map((b) => b.code))].sort();
  const heatmapByDepartment = deptCodes.map((code) => ({ id: code, label: code, hours: spreadHours(deptBookings.filter((b) => b.code === code)) }));

  const byDepartment = all(`
    SELECT COALESCE(d.code, '—') AS code, COALESCE(d.name, 'Unassigned') AS name, COUNT(*) AS bookings, COALESCE(SUM(${hoursExpr}),0) AS hours
      FROM bookings b JOIN users u ON u.id = b.user_id LEFT JOIN departments d ON d.id = u.department_id
     WHERE b.booking_status IN ${USED} AND ${inPeriod}
     GROUP BY d.id ORDER BY bookings DESC`).map((d) => ({ ...d, hours: round1(d.hours) }));

  const byRole = all(`
    SELECT u.role, COUNT(*) AS bookings FROM bookings b JOIN users u ON u.id = b.user_id
     WHERE b.booking_status IN ${USED} AND ${inPeriod} GROUP BY u.role ORDER BY bookings DESC`);

  const rejectionReasons = all(`
    SELECT COALESCE(b.rejection_category, 'other') AS category, COUNT(*) AS count
      FROM bookings b WHERE b.booking_status = 'rejected' AND ${inPeriod}
     GROUP BY category ORDER BY count DESC`);

  const frequentlyUnavailable = all(`
    SELECT e.equipment_id AS id, e.equipment_name AS name, e.total_quantity, l.lab_name AS lab_name,
      (SELECT COUNT(*) FROM demand_misses m WHERE m.resource_type = 'equipment' AND m.resource_id = e.equipment_id AND m.created_at >= '${from}') AS misses,
      (SELECT COUNT(*) FROM waitlist w WHERE w.resource_type = 'equipment' AND w.resource_id = e.equipment_id AND w.created_at >= '${from}') AS waitlisted
    FROM equipment e LEFT JOIN labs l ON l.lab_id = e.lab_id WHERE 1=1${labSql}
    ORDER BY (misses + waitlisted) DESC LIMIT 6`).filter((e) => e.misses + e.waitlisted > 0);

  const damageByEquipment = all(`
    SELECT e.equipment_id AS id, e.equipment_name AS name, COUNT(r.id) AS reports, SUM(r.quantity) AS units
      FROM damage_reports r JOIN equipment e ON e.equipment_id = r.equipment_id LEFT JOIN labs l ON l.lab_id = e.lab_id
     WHERE r.created_at >= '${from}'${labSql}
     GROUP BY e.equipment_id ORDER BY reports DESC LIMIT 6`);

  return {
    period: { from, to: today(), days },
    kpis: {
      total: counts.total || 0,
      approved: counts.approved || 0,
      pending: pendingNow,
      cancelled: counts.cancelled || 0,
      rejected: counts.rejected || 0,
      completed: counts.completed || 0,
      returned_late: counts.returned_late || 0,
      issued_now: issuedNow,
      overdue: overdueNow,
      damage_reports: damage.total || 0,
      damage_open: damage.open || 0,
      avg_utilization: avgUtilization,
      approval_rate: counts.approved + counts.rejected ? Math.round((counts.approved / (counts.approved + counts.rejected)) * 100) : 0,
    },
    labs,
    top_labs: labs.filter((l) => l.bookings > 0).slice(0, 8),
    underused_labs: labs.filter((l) => l.utilization < Math.max(10, avgUtilization * 0.6)).sort((a, b) => a.utilization - b.utilization),
    top_equipment: topEquipment,
    months,
    status_breakdown: statusBreakdown,
    peak_hours: peakHours,
    heatmap: byWeekday.map((list, wd) => ({ day: WEEKDAYS[wd].slice(0, 3), weekday: wd, hours: spreadHours(list) })),
    heatmap_by_lab: heatmapByLab,
    heatmap_by_department: heatmapByDepartment,
    by_department: byDepartment,
    by_role: byRole,
    rejection_reasons: rejectionReasons,
    frequently_unavailable: frequentlyUnavailable,
    damage_by_equipment: damageByEquipment,
  };
}

// ---------------------------------------------------------------------------
// Usage prediction: weekly demand trend (least squares) blended with bookings
// already on the calendar for the next 7 days.
// ---------------------------------------------------------------------------
function linearForecast(series) {
  const n = series.length;
  const xs = series.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = series.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (series[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den ? num / den : 0;
  return { next: Math.max(0, my + slope * (n - mx)), slope, mean: my };
}

export function predictDemand({ departmentId = null, weeks = 8 } = {}) {
  const { sql, labSql } = scopeSql(departmentId);
  const start = addDays(today(), -weeks * 7);
  const horizon = addDays(today(), 7);
  const weekIndex = (date) => Math.floor(diffMinutes(`${start}T00:00`, `${date}T00:00`) / (7 * 1440));

  const labs = all(`SELECT l.lab_id AS id, l.lab_name AS name, l.code, l.open_time, l.close_time FROM labs l WHERE l.status != 'closed'${labSql}`);
  const labBookings = all(
    `SELECT b.lab_id, b.booking_date, b.start_at, ${hoursExpr} AS hours FROM bookings b
      WHERE b.lab_id IS NOT NULL AND b.booking_date >= ? AND b.booking_date < ? AND b.booking_status IN ${USED}${sql}`,
    start,
    horizon,
  );

  const labPredictions = labs.map((lab) => {
    const series = Array(weeks).fill(0);
    const byWeekday = Array(7).fill(0);
    let upcoming = 0;
    for (const b of labBookings.filter((x) => x.lab_id === lab.id)) {
      if (b.booking_date >= today()) upcoming += b.hours;
      else {
        series[Math.min(weeks - 1, weekIndex(b.booking_date))] += b.hours;
        byWeekday[parseLocal(b.start_at).getDay()] += b.hours;
      }
    }
    const f = linearForecast(series);
    const forecast = Math.max(upcoming, 0.7 * f.next + 0.3 * Math.max(upcoming, f.mean));
    const weeklyCapacity = ((toMinutes(lab.close_time) - toMinutes(lab.open_time)) / 60) * 6;
    const util = Math.min(100, Math.round((forecast / weeklyCapacity) * 100));
    const peakDay = byWeekday.indexOf(Math.max(...byWeekday));
    const trend = f.mean ? Math.round((f.slope / f.mean) * 100) : 0;
    return {
      id: lab.id,
      name: lab.name,
      code: lab.code,
      history: series.map(round1),
      already_booked_hours: round1(upcoming),
      forecast_hours: round1(forecast),
      predicted_utilization: util,
      demand: util >= 45 ? 'high' : util >= 25 ? 'medium' : 'low',
      trend_pct: trend,
      peak_day: byWeekday[peakDay] > 0 ? WEEKDAYS[peakDay] : null,
    };
  });

  const equipment = all(
    `SELECT e.*, e.equipment_id AS id, e.equipment_name AS name, l.lab_name AS lab_name FROM equipment e LEFT JOIN labs l ON l.lab_id = e.lab_id
      WHERE e.maintenance_status != 'retired'${labSql}`,
  );
  const itemRows = all(
    `SELECT bi.equipment_id, bi.quantity, b.booking_date, ${hoursExpr} AS hours FROM booking_items bi JOIN bookings b ON b.booking_id = bi.booking_id
      WHERE b.booking_date >= ? AND b.booking_date < ? AND b.booking_status IN ${USED}${sql}`,
    start,
    horizon,
  );
  const equipmentPredictions = equipment
    .map((eq) => {
      const series = Array(weeks).fill(0);
      let upcoming = 0;
      for (const r of itemRows.filter((x) => x.equipment_id === eq.id)) {
        const unitHours = r.quantity * r.hours;
        if (r.booking_date >= today()) upcoming += unitHours;
        else series[Math.min(weeks - 1, weekIndex(r.booking_date))] += unitHours;
      }
      const f = linearForecast(series);
      const forecast = Math.max(upcoming, 0.7 * f.next + 0.3 * Math.max(upcoming, f.mean));
      const capacity = Math.max(1, equipmentBase(eq)) * 8 * 6; // ~8 bookable hours per unit per day
      const util = Math.min(100, Math.round((forecast / capacity) * 100));
      return {
        id: eq.id,
        name: eq.name,
        lab_name: eq.lab_name,
        total_quantity: eq.total_quantity,
        forecast_unit_hours: round1(forecast),
        predicted_utilization: util,
        demand: util >= 30 ? 'high' : util >= 15 ? 'medium' : 'low',
        trend_pct: f.mean ? Math.round((f.slope / f.mean) * 100) : 0,
      };
    })
    .sort((a, b) => b.predicted_utilization - a.predicted_utilization);

  return {
    generated_at: nowLocal(),
    method: `Least-squares trend over the last ${weeks} weeks, blended with bookings already confirmed for the next 7 days.`,
    labs: labPredictions.sort((a, b) => b.predicted_utilization - a.predicted_utilization),
    equipment: equipmentPredictions.slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Maintenance recommendation: equipment frequently reported as faulty
// ---------------------------------------------------------------------------
export function maintenanceRecommendations({ departmentId = null } = {}) {
  const { labSql } = scopeSql(departmentId);
  const since = addDays(today(), -120);
  const rows = all(`
    SELECT e.*, e.equipment_id AS id, e.equipment_name AS name, l.lab_name AS lab_name, c.name AS category_name,
      (SELECT COUNT(*) FROM damage_reports r WHERE r.equipment_id = e.equipment_id AND r.kind IN ('damaged','fault') AND r.created_at >= '${since}') AS reports,
      (SELECT COUNT(*) FROM damage_reports r WHERE r.equipment_id = e.equipment_id AND r.status IN ('open','in_repair')) AS open_reports,
      (SELECT COUNT(*) FROM issues i WHERE i.equipment_id = e.equipment_id AND i.issued_at >= '${since}') AS issues
    FROM equipment e LEFT JOIN labs l ON l.lab_id = e.lab_id LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.maintenance_status != 'retired'${labSql}`);
  const conditionFactor = { new: 0, good: 0.15, fair: 0.55, poor: 1 };
  return rows
    .map((e) => {
      const faultRate = e.issues ? e.reports / e.issues : e.reports ? 1 : 0;
      const daysSince = e.last_maintenance_at ? Math.round(diffMinutes(e.last_maintenance_at.slice(0, 16), nowLocal()) / 1440) : 365;
      const risk =
        0.45 * Math.min(1, faultRate * 4 + e.reports * 0.08) +
        0.25 * (conditionFactor[e.condition] ?? 0.3) +
        0.2 * Math.min(1, daysSince / 240) +
        0.1 * Math.min(1, e.open_reports / 2);
      const reasons = [];
      if (e.reports) reasons.push(`${e.reports} fault/damage report(s) in 120 days`);
      if (e.issues) reasons.push(`fault rate ${Math.round(faultRate * 100)}% of ${e.issues} checkouts`);
      if (['fair', 'poor'].includes(e.condition)) reasons.push(`condition: ${e.condition}`);
      if (daysSince > 180) reasons.push(e.last_maintenance_at ? `last serviced ${daysSince} days ago` : 'no service on record');
      if (e.open_reports) reasons.push(`${e.open_reports} unresolved report(s)`);
      const score = Math.round(risk * 100);
      return {
        id: e.id,
        name: e.name,
        code: e.code,
        category: e.category_name || e.category,
        lab_name: e.lab_name,
        condition: e.condition,
        maintenance_status: e.maintenance_status,
        maintenance_quantity: e.maintenance_quantity,
        risk: score,
        level: score >= 60 ? 'critical' : score >= 40 ? 'high' : score >= 25 ? 'medium' : 'low',
        action: score >= 60 ? 'Repair or replace units' : score >= 40 ? 'Schedule inspection this week' : score >= 25 ? 'Include in next routine service' : 'No action needed',
        reasons,
      };
    })
    .filter((r) => r.risk >= 25)
    .sort((a, b) => b.risk - a.risk);
}
