import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Alert, Button, Field, Input, Select } from '../components/ui';
import { api } from '../lib/api';
import { useTitle } from '../lib/hooks';
import { AuthShell } from './Login';

export default function Register() {
  useTitle('Create account');
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [departments, setDepartments] = useState([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'student', department_id: '', student_id: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/departments').then(setDepartments).catch(() => {});
  }, []);

  if (user) return <Navigate to="/" replace />;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) return setError('Password must be at least 8 characters.');
    setBusy(true);
    try {
      await register(form);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <div className="w-full max-w-md">
        <h2 className="text-2xl font-semibold tracking-tight">Create your account</h2>
        <p className="mt-1 text-sm text-slate-500">Students and faculty can register. Staff accounts are created by the administrator.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          {error && <Alert tone="red">{error}</Alert>}
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
            {['student', 'faculty'].map((r) => (
              <button
                type="button"
                key={r}
                onClick={() => setForm((f) => ({ ...f, role: r }))}
                className={`rounded-lg py-2 text-sm font-medium capitalize ${form.role === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                {r}
              </button>
            ))}
          </div>
          <Field label="Full name" required>{(id) => <Input id={id} required value={form.name} onChange={set('name')} />}</Field>
          <Field label="University email" required>{(id) => <Input id={id} type="email" required value={form.email} onChange={set('email')} placeholder="you@uni.edu" />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Department" required>
              {(id) => (
                <Select id={id} required value={form.department_id} onChange={set('department_id')}>
                  <option value="">Select…</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="University ID" hint="Printed on your ID card (used for scanning)">
              {(id) => <Input id={id} value={form.student_id} onChange={set('student_id')} placeholder="2024-1-60-001" />}
            </Field>
          </div>
          <Field label="Password" hint="At least 8 characters" required>
            {(id) => <Input id={id} type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} />}
          </Field>
          <Button type="submit" className="w-full" loading={busy}>
            Create account
          </Button>
        </form>
        <p className="mt-4 text-center text-sm text-slate-500">
          Already registered?{' '}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
