// Minimal iCalendar (RFC 5545) generator for calendar integration.
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const dt = (local) => local.replace(/[-:]/g, '').slice(0, 13) + '00'; // 2026-10-02T14:00 → 20261002T140000 (floating local time)

function fold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

export function bookingToEvent(b) {
  const what = [b.lab_name, ...(b.items || []).map((i) => `${i.quantity}× ${i.name}`)].filter(Boolean).join(' + ');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return [
    'BEGIN:VEVENT',
    `UID:${b.ref_code}@unilab`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${dt(b.start_at)}`,
    `DTEND:${dt(b.end_at)}`,
    `SUMMARY:${esc(`${what || 'Lab booking'} (${b.ref_code})`)}`,
    `DESCRIPTION:${esc(`Status: ${b.status}\nPurpose: ${b.purpose || '-'}`)}`,
    b.lab_location ? `LOCATION:${esc(b.lab_location)}` : null,
    `STATUS:${['cancelled', 'rejected'].includes(b.status) ? 'CANCELLED' : b.status === 'pending' ? 'TENTATIVE' : 'CONFIRMED'}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Lab booking reminder',
    'END:VALARM',
    'END:VEVENT',
  ]
    .filter(Boolean)
    .map(fold)
    .join('\r\n');
}

export function calendar(events, name = 'UniLab bookings') {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//UniLab//Booking System//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(name)}`, ...events, 'END:VCALENDAR'].join('\r\n');
}
