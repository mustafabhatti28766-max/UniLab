import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutDashboard, CalendarPlus, Sparkles, Search, CalendarDays, Activity, ClipboardList, ListOrdered, CheckSquare,
  GitMerge, PackageCheck, ScanLine, Wrench, BarChart3, Scale, Users, Building2, History, Bell, Menu, X, LogOut,
  UserCircle, FlaskConical, ChevronDown, Table2, KeyRound, Smartphone,
} from 'lucide-react';
import { useInstallPrompt } from '../lib/pwa';

/** "Install app" — shown when the browser offers PWA installation (mobile & desktop). */
function InstallButton() {
  const { canInstall, install } = useInstallPrompt();
  if (!canInstall) return null;
  return (
    <button onClick={install} className="flex items-center gap-1.5 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100" title="Install UniLab as an app">
      <Smartphone className="size-4" /> <span className="hidden sm:inline">Install app</span>
    </button>
  );
}
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { ROLE_LABELS, timeAgo } from '../lib/format';
import { api } from '../lib/api';

const NAV = [
  {
    title: 'Booking',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/book', label: 'New booking', icon: CalendarPlus, perm: 'bookings.create' },
      { to: '/finder', label: 'Smart finder', icon: Sparkles },
      { to: '/resources', label: 'Labs & equipment', icon: Search },
      { to: '/schedule', label: 'Schedule', icon: CalendarDays },
      { to: '/occupancy', label: 'Live occupancy', icon: Activity },
      { to: '/bookings', label: 'My bookings', icon: ClipboardList },
      { to: '/waitlist', label: 'Waitlist', icon: ListOrdered },
    ],
  },
  {
    title: 'Lab operations',
    items: [
      { to: '/all-bookings', label: 'All bookings', icon: Table2, perm: 'bookings.view_all' },
      { to: '/approvals', label: 'Approvals', icon: CheckSquare, badge: 'approvals', perm: 'bookings.approve' },
      { to: '/conflicts', label: 'Conflicts', icon: GitMerge, perm: 'conflicts.resolve' },
      { to: '/desk', label: 'Issue & return', icon: PackageCheck, perm: 'bookings.issue' },
      { to: '/scan', label: 'Scan QR / ID', icon: ScanLine, perm: 'bookings.issue' },
      { to: '/maintenance', label: 'Maintenance', icon: Wrench, perm: 'maintenance.manage' },
      { to: '/analytics', label: 'Analytics', icon: BarChart3, perm: 'analytics.view' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/rules', label: 'Booking rules', icon: Scale, perm: 'rules.manage' },
      { to: '/users', label: 'Users', icon: Users, perm: 'users.manage' },
      { to: '/permissions', label: 'Roles & permissions', icon: KeyRound, perm: 'permissions.manage' },
      { to: '/catalog', label: 'Departments & categories', icon: Building2, perm: 'catalog.manage' },
      { to: '/activity', label: 'Activity log', icon: History, perm: 'activity.view' },
    ],
  },
];

function Sidebar({ onNavigate }) {
  const { user, can } = useAuth();
  const { pendingApprovals } = useNotifications();
  const sections = NAV.map((s) => ({ ...s, items: s.items.filter((i) => !i.perm || can(i.perm)) })).filter((s) => s.items.length);
  return (
    <nav className="flex h-full flex-col" aria-label="Main">
      <Link to="/" onClick={onNavigate} className="flex items-center gap-2.5 px-5 py-5">
        <span className="rounded-xl bg-brand-700 p-2 text-white shadow-sm">
          <FlaskConical className="size-5" aria-hidden />
        </span>
        <span>
          <span className="block text-base font-semibold leading-tight text-slate-900">UniLab</span>
          <span className="block text-xs text-slate-500">Lab & equipment booking</span>
        </span>
      </Link>
      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto px-3 pb-6">
        {sections.map((section) => (
          <div key={section.title}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">{section.title}</p>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      clsx(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                      )
                    }
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden />
                    <span className="flex-1">{item.label}</span>
                    {item.badge === 'approvals' && pendingApprovals > 0 && (
                      <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white tabular">{pendingApprovals}</span>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
        Signed in as <span className="font-medium text-slate-700">{ROLE_LABELS[user.role]}</span>
        {user.department_code && <> · {user.department_code}</>}
      </div>
    </nav>
  );
}

function useClickOutside(ref, onOutside, active) {
  useEffect(() => {
    if (!active) return undefined;
    const handler = (e) => ref.current && !ref.current.contains(e.target) && onOutside();
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onOutside, active]);
}

function NotificationBell() {
  const { unread, refresh, version } = useNotifications();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const ref = useRef(null);
  const navigate = useNavigate();
  useClickOutside(ref, () => setOpen(false), open);

  useEffect(() => {
    if (open) api.get('/notifications?limit=8').then((r) => setItems(r.data)).catch(() => {});
  }, [open, version]);

  const openItem = async (n) => {
    setOpen(false);
    if (!n.is_read) await api.post(`/notifications/${n.id}/read`).catch(() => {});
    refresh();
    if (n.link) navigate(n.link);
  };
  const markAll = async () => {
    await api.post('/notifications/read-all');
    setItems((xs) => xs.map((x) => ({ ...x, is_read: 1 })));
    refresh();
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
        <Bell className="size-5" />
        {unread > 0 && <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white tabular">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[calc(100vw-2rem)] max-w-sm overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button onClick={markAll} className="text-xs font-medium text-brand-700 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">You're all caught up.</li>}
            {items.map((n) => (
              <li key={n.id}>
                <button onClick={() => openItem(n)} className={clsx('flex w-full gap-3 px-4 py-3 text-left hover:bg-slate-50', !n.is_read && 'bg-brand-50/50')}>
                  <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', n.is_read ? 'bg-transparent' : 'bg-brand-600')} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900">{n.title}</span>
                    <span className="line-clamp-2 block text-xs text-slate-500">{n.message}</span>
                    <span className="mt-0.5 block text-[11px] text-slate-400">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Link to="/notifications" onClick={() => setOpen(false)} className="block border-t border-slate-100 px-4 py-2.5 text-center text-sm font-medium text-brand-700 hover:bg-slate-50">
            View all
          </Link>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false), open);
  const initials = user.name.replace(/^(Dr\.|Prof\.)\s*/, '').split(' ').map((p) => p[0]).slice(0, 2).join('');
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-slate-100" aria-label="Account menu">
        <span className="flex size-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">{initials}</span>
        <span className="hidden text-left sm:block">
          <span className="block max-w-[160px] truncate text-sm font-medium leading-tight text-slate-800">{user.name}</span>
          <span className="block text-xs leading-tight text-slate-500">{ROLE_LABELS[user.role]}</span>
        </span>
        <ChevronDown className="hidden size-4 text-slate-400 sm:block" aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
          <div className="border-b border-slate-100 px-4 py-2.5">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
          </div>
          <Link to="/profile" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
            <UserCircle className="size-4" /> Profile & settings
          </Link>
          <button onClick={logout} className="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50">
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const [drawer, setDrawer] = useState(false);
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => setDrawer(false), [location.pathname]);

  const search = (e) => {
    e.preventDefault();
    if (q.trim()) navigate(`/resources?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:block">
        <Sidebar />
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl">
            <button onClick={() => setDrawer(false)} className="absolute top-4 right-3 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close menu">
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
        <button onClick={() => setDrawer(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <form onSubmit={search} className="relative max-w-md flex-1" role="search">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search labs, equipment, facilities…"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
            aria-label="Search resources"
          />
        </form>
        <div className="ml-auto flex items-center gap-1">
          <InstallButton />
          <NotificationBell />
          <UserMenu />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
