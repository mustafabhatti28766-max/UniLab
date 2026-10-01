import clsx from 'clsx';

// Reference data-viz palette (validated with the dataviz skill's validator).
export const VIZ = {
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  seq: ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'],
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  muted: '#898781',
  text: '#0b0b0b',
  textSecondary: '#52514e',
  surface: '#fcfcfb',
};

/** Tooltip body for Recharts: values in ink colors, a colored key carries identity. */
export function ChartTooltip({ active, payload, label, formatter, labelFormatter }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      {!formatter && <p className="mb-1 font-medium text-slate-900">{labelFormatter ? labelFormatter(label, row) : label}</p>}
      {payload.map((p) => {
        const [value, name] = formatter ? formatter(p.value, row, p) : [p.value, p.name];
        return (
          <p key={p.dataKey} className="flex items-center gap-2 text-slate-600">
            <span className="size-2 rounded-sm" style={{ background: p.color || p.fill }} aria-hidden />
            <span className="font-semibold text-slate-900 tabular">{value}</span>
            <span>{name}</span>
          </p>
        );
      })}
    </div>
  );
}

/** Ranked horizontal bars with direct labels (single series, one hue). */
export function BarList({ data, valueKey, labelKey, format = (v) => v, max, sublabel, color = VIZ.series[0], empty = 'No data' }) {
  if (!data?.length) return <p className="py-6 text-center text-sm text-slate-500">{empty}</p>;
  const top = max ?? Math.max(...data.map((d) => d[valueKey]), 1);
  return (
    <ul className="space-y-2.5">
      {data.map((d, i) => (
        <li key={d.id ?? d[labelKey] ?? i} className="group" title={`${d[labelKey]}: ${format(d[valueKey], d)}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-slate-700">
              {d[labelKey]}
              {sublabel && <span className="ml-1 text-xs text-slate-400">{sublabel(d)}</span>}
            </span>
            <span className="shrink-0 font-medium text-slate-900 tabular">{format(d[valueKey], d)}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-100">
            <div className="h-2 rounded-full transition-all group-hover:opacity-80" style={{ width: `${Math.max(2, (d[valueKey] / top) * 100)}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Weekday × hour heatmap (sequential blue ramp, light = low). */
export function Heatmap({ rows, fromHour = 7, toHour = 21 }) {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const ordered = order.map((wd) => rows.find((r) => r.weekday === wd)).filter(Boolean).map((r) => ({ label: r.day, hours: r.hours }));
  return <HourHeatmap rows={ordered} fromHour={fromHour} toHour={toHour} ariaLabel="Bookings by weekday and hour" />;
}

/** Generic row × hour-of-day heatmap — rows are weekdays, labs or departments. */
export function HourHeatmap({ rows, fromHour = 7, toHour = 21, ariaLabel = 'Usage heatmap', labelWidth = 'auto' }) {
  const hours = [];
  for (let h = fromHour; h <= toHour; h++) hours.push(h);
  const ordered = rows;
  const max = Math.max(1, ...ordered.flatMap((r) => hours.map((h) => r.hours[h])));
  const colorFor = (v) => (v === 0 ? '#f1f5f9' : VIZ.seq[Math.min(VIZ.seq.length - 1, Math.floor((v / max) * (VIZ.seq.length - 1)))]);
  const label = (h) => (h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`);
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full border-separate border-spacing-[2px] text-[11px]" aria-label={ariaLabel}>
        <thead>
          <tr>
            <th />
            {hours.map((h) => (
              <th key={h} className="font-normal text-slate-400 tabular">{h % 2 === 0 ? label(h) : ''}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map((r) => (
            <tr key={r.label}>
              <th className="max-w-[180px] truncate pr-2 text-left font-medium text-slate-500" style={{ width: labelWidth }} title={r.label}>{r.label}</th>
              {hours.map((h) => (
                <td key={h} title={`${r.label} ${label(h)}: ${r.hours[h]} booking-hours`} className="h-6 min-w-5 rounded-[4px] hover:outline hover:outline-2 hover:outline-slate-900/40" style={{ background: colorFor(r.hours[h]) }} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center justify-end gap-2 text-[11px] text-slate-500">
        Fewer
        <span className="flex gap-0.5">
          {[0, 3, 6, 9, 12].map((i) => (
            <span key={i} className="h-3 w-5 rounded-sm" style={{ background: VIZ.seq[i] }} />
          ))}
        </span>
        More
      </div>
    </div>
  );
}

export function KpiTile({ label, value, sub, tone, className }) {
  return (
    <div className={clsx('card p-4', className)}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={clsx('mt-1 text-2xl font-semibold', tone === 'bad' ? 'text-red-600' : 'text-slate-900')}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
