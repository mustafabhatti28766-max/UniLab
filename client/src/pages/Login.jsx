import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { FlaskConical, GraduationCap, BookOpen, Wrench, Briefcase, ShieldCheck, CalendarCheck, Sparkles, ScanLine } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Alert, Button, Field, Input } from '../components/ui';
import { useTitle } from '../lib/hooks';

const DEMO = [
  { email: 'student@uni.edu', label: 'Student', who: 'Ali Raza · CSE', icon: GraduationCap },
  { email: 'faculty@uni.edu', label: 'Faculty', who: 'Dr. Lina Sultana · EEE', icon: BookOpen },
  { email: 'staff@uni.edu', label: 'Lab staff', who: 'Tania Akter · EEE', icon: Wrench },
  { email: 'coordinator@uni.edu', label: 'Coordinator', who: 'Prof. Farah Ahmed · EEE', icon: Briefcase },
  { email: 'admin@uni.edu', label: 'Administrator', who: 'Nadia Karim', icon: ShieldCheck },
];

export function AuthShell({ children }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-brand-950 p-12 text-white lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5">
          <span className="rounded-xl bg-accent-500 p-2 text-slate-950">
            <FlaskConical className="size-6" />
          </span>
          <span className="text-xl font-extrabold">UniLab</span>
        </div>
        <div className="my-auto max-w-md">
          <h1 className="text-4xl leading-tight font-extrabold">
            One place for every lab, kit and instrument on <span className="text-accent-400">campus</span>.
          </h1>
          <p className="mt-4 leading-relaxed text-blue-100">
            Check live availability, get smart alternatives when a slot is taken, track approvals, and issue and return equipment with a QR scan.
          </p>
          <ul className="mt-8 space-y-4 text-sm text-brand-50">
            {[
              [CalendarCheck, 'Conflict-free bookings with instant availability checks'],
              [Sparkles, 'Smart recommendations for labs, equipment and time slots'],
              [ScanLine, 'QR checkout and return with damage tracking'],
            ].map(([Icon, text]) => (
              <li key={text} className="flex items-center gap-3">
                <span className="rounded-lg bg-white/10 p-2 text-accent-400">
                  <Icon className="size-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-blue-200">Request → Availability check → Approval → Reservation → Usage → Return → Analytics</p>
      </div>
      <div className="flex items-center justify-center px-4 py-10 sm:px-8">{children}</div>
    </div>
  );
}

export default function Login() {
  useTitle('Sign in');
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={location.state?.from || '/'} replace />;

  const submit = async (e, creds) => {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(creds?.email || email, creds?.password || password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <div className="w-full max-w-md">
        <div className="mb-8 lg:hidden">
          <span className="inline-flex items-center gap-2 text-lg font-semibold">
            <FlaskConical className="size-6 text-brand-700" /> UniLab
          </span>
        </div>
        <h2 className="text-3xl font-extrabold text-brand-950">Sign in</h2>
        <p className="mt-1 text-sm text-slate-600">Use your university account to book labs and equipment.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          {error && <Alert tone="red">{error}</Alert>}
          <Field label="University email">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@uni.edu" />}</Field>
          <Field label="Password">{(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Sign in
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-500">
          New here?{' '}
          <Link to="/register" className="font-medium text-brand-700 hover:underline">
            Create a student or faculty account
          </Link>
        </p>

        <div className="mt-8">
          <p className="mb-2 text-xs font-bold tracking-wider text-slate-500 uppercase">Demo accounts · password123</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {DEMO.map((d) => (
              <button
                key={d.email}
                onClick={() => submit(null, { email: d.email, password: 'password123' })}
                disabled={busy}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition-colors duration-150 hover:border-brand-400 hover:bg-brand-50/60 disabled:opacity-60"
              >
                <span className="rounded-lg bg-brand-50 p-2 text-brand-700">
                  <d.icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-900">{d.label}</span>
                  <span className="block truncate text-xs text-slate-500">{d.who}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </AuthShell>
  );
}
