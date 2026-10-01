import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ShieldAlert, ShieldCheck, Download, BellRing, BellOff, Smartphone, Copy, CalendarDays, RefreshCw } from 'lucide-react';
import { disablePush, isStandalone, pushEnabledOnThisDevice, useInstallPrompt } from '../lib/pwa';
import { api, downloadFile, API_ORIGIN } from '../lib/api';
import { useTitle } from '../lib/hooks';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useNotifications } from '../context/NotificationContext';
import { Alert, Button, Card, CardHeader, Field, Input, PageHeader } from '../components/ui';
import { ROLE_LABELS, fmtDateTime, nowLocal } from '../lib/format';

/** Calendar integration: auto-updating subscription feed + one-off export. */
function CalendarCard() {
  const toast = useToast();
  const [feed, setFeed] = useState(null);
  const load = (regenerate = false) =>
    api.get(`/calendar/feed${regenerate ? '?regenerate=1' : ''}`).then((r) => setFeed(`${API_ORIGIN || window.location.origin}${r.path}`)).catch(toast.error);
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const webcal = feed?.replace(/^https?:/, 'webcal:');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(feed);
      toast.success('Calendar link copied');
    } catch {
      toast.info(feed);
    }
  };
  return (
    <Card>
      <CardHeader title="Calendar integration" subtitle="Your bookings appear in your calendar and stay up to date automatically" icon={CalendarDays} />
      <div className="space-y-3 p-5">
        <div className="flex gap-2">
          <Input value={feed || 'Loading…'} readOnly aria-label="Calendar subscription link" className="font-mono text-xs" />
          <Button variant="secondary" icon={Copy} onClick={copy} disabled={!feed}>Copy</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={feed ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` : undefined} target="_blank" rel="noreferrer">
            <Button size="sm" variant="secondary" disabled={!feed}>Subscribe in Google Calendar</Button>
          </a>
          <a href={webcal}>
            <Button size="sm" variant="secondary" disabled={!feed}>Open in Apple / Outlook calendar</Button>
          </a>
          <Button size="sm" variant="ghost" icon={Download} onClick={() => downloadFile('/calendar/my.ics', 'unilab-bookings.ics').catch(toast.error)}>Download .ics</Button>
          <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => load(true).then(() => toast.success('New private link generated — the old one stops working'))}>Reset link</Button>
        </div>
        <p className="text-xs text-slate-500">Keep this link private: anyone with it can see your bookings. Calendar apps need the server to be reachable on the internet to subscribe.</p>
      </div>
    </Card>
  );
}

export default function Profile() {
  useTitle('Profile');
  const { user, setUser } = useAuth();
  const toast = useToast();
  const { requestPush } = useNotifications();
  const [form, setForm] = useState({ name: user.name, phone: user.phone || '' });
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const [busy, setBusy] = useState(null);
  const restricted = user.restricted_until && user.restricted_until > nowLocal();
  const [pushOn, setPushOn] = useState(null);
  const { canInstall, install } = useInstallPrompt();
  useEffect(() => {
    pushEnabledOnThisDevice().then(setPushOn).catch(() => setPushOn(false));
  }, []);

  const saveProfile = async (e) => {
    e.preventDefault();
    setBusy('profile');
    try {
      const r = await api.put('/auth/me', form);
      setUser(r.user);
      toast.success('Profile updated');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };
  const savePassword = async (e) => {
    e.preventDefault();
    if (pw.new_password !== pw.confirm) return toast.error('New passwords do not match');
    setBusy('pw');
    try {
      await api.put('/auth/me', { current_password: pw.current_password, new_password: pw.new_password });
      setPw({ current_password: '', new_password: '', confirm: '' });
      toast.success('Password changed');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader title="Profile & settings" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Personal information" />
            <form onSubmit={saveProfile} className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="Full name">{(id) => <Input id={id} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />}</Field>
              <Field label="Phone">{(id) => <Input id={id} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />}</Field>
              <Field label="Email" hint="Contact the administrator to change">{(id) => <Input id={id} value={user.email} disabled />}</Field>
              <Field label="Role & department">{(id) => <Input id={id} value={`${ROLE_LABELS[user.role]}${user.department_name ? ` · ${user.department_name}` : ''}`} disabled />}</Field>
              <div className="sm:col-span-2"><Button type="submit" loading={busy === 'profile'}>Save changes</Button></div>
            </form>
          </Card>
          <Card>
            <CardHeader title="Change password" />
            <form onSubmit={savePassword} className="grid gap-4 p-5 sm:grid-cols-3">
              <Field label="Current password">{(id) => <Input id={id} type="password" autoComplete="current-password" required value={pw.current_password} onChange={(e) => setPw((p) => ({ ...p, current_password: e.target.value }))} />}</Field>
              <Field label="New password" hint="At least 8 characters">{(id) => <Input id={id} type="password" autoComplete="new-password" required minLength={8} value={pw.new_password} onChange={(e) => setPw((p) => ({ ...p, new_password: e.target.value }))} />}</Field>
              <Field label="Confirm new password">{(id) => <Input id={id} type="password" autoComplete="new-password" required value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} />}</Field>
              <div className="sm:col-span-3"><Button type="submit" variant="secondary" loading={busy === 'pw'}>Update password</Button></div>
            </form>
          </Card>
          <CalendarCard />
          <Card>
            <CardHeader title="Push notifications & mobile app" />
            <div className="space-y-3 p-5">
              <p className="text-sm text-slate-600">
                Get approval, reminder, return-due and overdue alerts on this device — even when UniLab is closed.
                {pushOn !== null && (
                  <span className={pushOn ? 'ml-1 font-medium text-emerald-700' : 'ml-1 font-medium text-slate-500'}>
                    {pushOn ? 'Enabled on this device.' : 'Not enabled on this device.'}
                  </span>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                {!pushOn ? (
                  <Button icon={BellRing} onClick={async () => {
                    const r = await requestPush();
                    if (r === 'granted') { setPushOn(true); toast.success('Push notifications enabled on this device'); } else toast.error(r);
                  }}>Enable push notifications</Button>
                ) : (
                  <Button variant="secondary" icon={BellOff} onClick={async () => { await disablePush(); setPushOn(false); toast.info('Push notifications turned off'); }}>Turn off on this device</Button>
                )}
                {canInstall && <Button variant="secondary" icon={Smartphone} onClick={install}>Install UniLab app</Button>}
              </div>
              {!canInstall && !isStandalone() && (
                <p className="text-xs text-slate-500">On phones, open UniLab in Chrome (Android) or Safari (iPhone) and choose “Add to Home Screen” to install it as an app.</p>
              )}
              {isStandalone() && <p className="text-xs font-medium text-emerald-700">You're using the installed UniLab app.</p>}
              <p className="text-xs text-slate-500">Email notifications are sent too when the server has an SMTP mail server configured.</p>
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          {user.student_id && (
            <Card className="p-5 text-center">
              <p className="text-sm font-semibold">Digital ID</p>
              <p className="text-xs text-slate-500">Lab staff can scan this to find your bookings</p>
              <div className="mx-auto mt-3 inline-block rounded-xl border border-slate-200 bg-white p-3"><QRCodeSVG value={user.student_id} size={140} /></div>
              <p className="mt-2 font-mono text-sm font-semibold">{user.student_id}</p>
            </Card>
          )}
          <Card className="p-5">
            <p className="mb-3 text-sm font-semibold">Booking standing</p>
            {restricted ? (
              <Alert tone="red" icon={ShieldAlert} title="Restricted">You can't make new bookings until {fmtDateTime(user.restricted_until)}.</Alert>
            ) : (
              <Alert tone="emerald" icon={ShieldCheck} title="Good standing">You can book labs and equipment.</Alert>
            )}
            <p className="mt-3 text-sm text-slate-600">Late returns on record: <b>{user.late_return_count}</b></p>
            <p className="text-xs text-slate-500">Repeated late returns lead to a temporary booking restriction.</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
