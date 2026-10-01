import { forwardRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Loader2, X, Inbox, AlertTriangle } from 'lucide-react';

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
const BTN_VARIANTS = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 disabled:bg-brand-300',
  cta: 'bg-accent-500 text-slate-950 font-semibold hover:bg-accent-400 disabled:opacity-50',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:border-slate-400 hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  success: 'bg-emerald-700 text-white hover:bg-emerald-800 disabled:bg-emerald-300',
  soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100',
};
// md/lg meet the 44px touch target on phones; dense sizes stay compact for tables.
const BTN_SIZES = {
  xs: 'px-2 py-1 text-xs gap-1',
  sm: 'px-3 py-1.5 text-sm gap-1.5',
  md: 'min-h-11 px-4 py-2 text-sm gap-2 sm:min-h-10',
  lg: 'min-h-12 px-5 py-2.5 text-base gap-2',
};

export const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', loading = false, icon: Icon, className, children, disabled, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed',
        BTN_VARIANTS[variant],
        BTN_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Icon ? <Icon className="size-4 shrink-0" aria-hidden /> : null}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------
const TONES = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
};
export const DOT_TONES = {
  slate: 'bg-slate-400',
  blue: 'bg-blue-500',
  indigo: 'bg-indigo-500',
  violet: 'bg-violet-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
  rose: 'bg-rose-500',
};

export function Badge({ tone = 'slate', dot = false, className, children }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', TONES[tone], className)}>
      {dot && <span className={clsx('size-1.5 rounded-full', DOT_TONES[tone])} aria-hidden />}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------
export function Card({ className, children, ...props }) {
  return (
    <div className={clsx('card', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, icon: Icon, className }) {
  return (
    <div className={clsx('flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 rounded-lg bg-brand-50 p-1.5 text-brand-700">
            <Icon className="size-4" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back}
        <h1 className="text-2xl font-bold text-brand-950 sm:text-[1.75rem]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, icon: Icon, tone = 'blue', hint, to, onClick }) {
  const toneCls = {
    blue: 'bg-blue-50 text-blue-700',
    amber: 'bg-amber-50 text-amber-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    red: 'bg-red-50 text-red-700',
    violet: 'bg-violet-50 text-violet-700',
    slate: 'bg-slate-100 text-slate-700',
    indigo: 'bg-indigo-50 text-indigo-700',
  }[tone];
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp onClick={onClick} className={clsx('card flex items-center gap-4 p-4 text-left', onClick && 'transition-colors duration-150 hover:border-brand-400 hover:bg-brand-50/40')}>
      {Icon && (
        <span className={clsx('rounded-xl p-2.5', toneCls)}>
          <Icon className="size-5" aria-hidden />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-600">{label}</p>
        <p className="text-2xl font-bold text-slate-900 tabular">{value ?? '—'}</p>
        {hint && <p className="truncate text-xs text-slate-500">{hint}</p>}
      </div>
      {to}
    </Comp>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------
export function Field({ label, hint, error, children, className, required }) {
  const id = useId();
  const child = typeof children === 'function' ? children(id) : children;
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="label">
          {label}
          {required && <span className="text-red-500"> *</span>}
        </label>
      )}
      {child}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export const Input = forwardRef(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={clsx('input', className)} {...props} />;
});

export const Select = forwardRef(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={clsx('input pr-8', className)} {...props}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={clsx('input min-h-[80px]', className)} {...props} />;
});

export function Toggle({ checked, onChange, label, description }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx('relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-brand-600' : 'bg-slate-300')}
      >
        <span className={clsx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
      </button>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------
export function Spinner({ className, label = 'Loading…' }) {
  return (
    <div className={clsx('flex items-center justify-center gap-2 py-10 text-sm text-slate-500', className)} role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div className={clsx('animate-pulse rounded-lg bg-slate-200/70', className)} />;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <span className="mb-3 rounded-full bg-slate-100 p-3 text-slate-500">
        <Icon className="size-6" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title="Something went wrong"
      description={error?.message || 'Could not load this page.'}
      action={onRetry && <Button variant="secondary" onClick={() => onRetry()}>Try again</Button>}
    />
  );
}

export function Alert({ tone = 'amber', icon: Icon = AlertTriangle, title, children, className }) {
  const cls = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    red: 'border-red-200 bg-red-50 text-red-900',
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    slate: 'border-slate-200 bg-slate-50 text-slate-800',
  }[tone];
  return (
    <div className={clsx('flex gap-3 rounded-xl border p-3 text-sm', cls, className)} role={tone === 'red' ? 'alert' : undefined}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx(title && 'mt-0.5')}>{children}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
export function Modal({ open, onClose, title, description, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onClose} />
      <div className={clsx('relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', width)}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <button onClick={onClose} className="-m-1.5 rounded-lg p-2.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Tabs (underline style)
// ---------------------------------------------------------------------------
export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={clsx('scroll-thin -mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 px-1', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            '-mb-px flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors duration-150',
            value === t.value ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
          )}
        >
          {t.label}
          {t.count !== undefined && t.count !== null && (
            <span className={clsx('rounded-full px-1.5 py-0.5 text-xs tabular', value === t.value ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600')}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Horizontal meter (e.g. utilization, match %). */
export function Meter({ value, max = 100, tone = 'blue', className, label }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = { blue: 'bg-[var(--viz-series-1)]', emerald: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', violet: 'bg-violet-500', slate: 'bg-slate-400' }[tone];
  return (
    <div className={clsx('h-2 w-full overflow-hidden rounded-full bg-slate-100', className)} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      <div className={clsx('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}
