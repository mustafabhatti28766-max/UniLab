import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Camera, CameraOff, ScanLine, Search, User, PackageCheck, LogIn, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { useTitle } from '../lib/hooks';
import { useToast } from '../context/ToastContext';
import { Alert, Badge, Button, Card, CardHeader, Input, PageHeader } from '../components/ui';
import { BookingRow, StatusBadge } from '../components/booking-ui';
import { ReturnModal } from '../components/BookingActions';
import { ROLE_LABELS, describeBooking, fmtRange } from '../lib/format';

/** Camera scanner using html5-qrcode (QR codes and common 1D barcodes on ID cards). */
function CameraScanner({ onResult }) {
  const regionId = 'qr-region';
  const scannerRef = useRef(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  const lastRef = useRef({ text: '', at: 0 });

  const stop = useCallback(async () => {
    try {
      if (scannerRef.current?.isScanning) await scannerRef.current.stop();
      scannerRef.current?.clear();
    } catch {
      /* already stopped */
    }
    scannerRef.current = null;
    setActive(false);
  }, []);

  const start = async () => {
    setError('');
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats: F } = await import('html5-qrcode');
      // QR (booking passes, equipment labels) + the 1D/2D barcodes printed on university ID cards.
      const scanner = new Html5Qrcode(regionId, {
        verbose: false,
        formatsToSupport: [F.QR_CODE, F.CODE_128, F.CODE_39, F.CODE_93, F.EAN_13, F.EAN_8, F.UPC_A, F.ITF, F.CODABAR, F.PDF_417, F.DATA_MATRIX],
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      });
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: (w, h) => ({ width: Math.floor(Math.min(w, h) * 0.85), height: Math.floor(Math.min(w, h) * 0.6) }) },
        (text) => {
          const now = Date.now();
          if (text === lastRef.current.text && now - lastRef.current.at < 3000) return;
          lastRef.current = { text, at: now };
          onResult(text);
        },
        () => {},
      );
      setActive(true);
    } catch (err) {
      setError(err?.message?.includes('Permission') ? 'Camera permission was denied.' : 'Could not start the camera. Use manual entry below.');
      setActive(false);
    }
  };

  useEffect(() => () => void stop(), [stop]);

  return (
    <div>
      <div id={regionId} className="mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-xl bg-slate-900/90 [&_video]:object-cover">
        {!active && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-slate-300">
            <ScanLine className="size-10" />
            <p className="text-sm">Scan a booking QR code, an equipment label or a student ID card barcode.</p>
          </div>
        )}
      </div>
      {error && <Alert tone="amber" className="mt-3">{error}</Alert>}
      <div className="mt-3 flex justify-center">
        {active ? (
          <Button variant="secondary" icon={CameraOff} onClick={stop}>Stop camera</Button>
        ) : (
          <Button icon={Camera} onClick={start}>Start camera</Button>
        )}
      </div>
    </div>
  );
}

export default function Scan() {
  useTitle('Scan');
  const toast = useToast();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [booking, setBooking] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [returning, setReturning] = useState(false);

  const lookup = useCallback(
    async (raw) => {
      const value = String(raw || '').trim();
      if (!value) return;
      setError('');
      setResult(null);
      setBooking(null);
      try {
        const r = await api.get(`/scan/${encodeURIComponent(value)}`);
        if (r.type === 'equipment') return navigate(`/equipment/${r.id}`);
        setResult(r);
        if (r.type === 'booking') setBooking(await api.get(`/bookings/${r.id}`));
      } catch (err) {
        setError(err.status === 404 ? `No booking, equipment or user matches “${value}”.` : err.message);
      }
    },
    [navigate],
  );

  const act = async (path, msg) => {
    setBusy(true);
    try {
      await api.post(`/bookings/${booking.id}/${path}`);
      toast.success(msg);
      setBooking(await api.get(`/bookings/${booking.id}`));
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Scan QR / ID card" subtitle="QR-based check-out and return. Scan a booking pass to issue or receive equipment, or a student ID to see their active bookings." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <CameraScanner onResult={lookup} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              lookup(code);
            }}
            className="mt-5 flex gap-2"
          >
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Or type a booking ref (BK-…), equipment code or university ID" aria-label="Code" />
            <Button type="submit" icon={Search}>Look up</Button>
          </form>
          <p className="mt-2 text-xs text-slate-500">Try: <button className="underline" onClick={() => lookup('2022-1-60-101')}>2022-1-60-101</button> (student ID) or <button className="underline" onClick={() => lookup('EQ-ARD-UNO')}>EQ-ARD-UNO</button> (equipment)</p>
        </Card>

        <div className="space-y-4">
          {error && <Alert tone="red">{error}</Alert>}
          {!result && !error && (
            <Card className="p-8 text-center text-sm text-slate-500">Scan results appear here.</Card>
          )}

          {result?.type === 'user' && (
            <Card>
              <CardHeader title={result.user.name} subtitle={`${ROLE_LABELS[result.user.role]} · ID ${result.user.student_id} · ${result.user.email}`} icon={User} />
              {result.user.restricted_until && <Alert tone="red" className="m-4">Booking privileges restricted ({result.user.late_return_count} late returns).</Alert>}
              {result.bookings.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">No active bookings in your department.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {result.bookings.map((b) => (
                    <li key={b.id}>
                      <BookingRow b={b} actions={<Button size="xs" variant="soft" onClick={() => lookup(b.ref_code)}>Open</Button>} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {booking && (
            <Card>
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
                <div className="min-w-0">
                  <Link to={`/bookings/${booking.id}`} className="font-mono font-semibold hover:text-brand-700">{booking.ref_code}</Link>
                  <p className="mt-0.5 text-sm text-slate-700">{describeBooking(booking)}</p>
                  <p className="text-xs text-slate-500">{fmtRange(booking)} · {booking.user_name} ({booking.user_student_id || booking.user_email})</p>
                </div>
                <StatusBadge status={booking.status} />
              </div>
              <div className="space-y-3 p-5">
                {booking.items.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {booking.items.map((i) => (
                      <li key={i.id} className="flex justify-between">
                        <span>{i.name}</span>
                        <Badge tone="slate">× {i.quantity}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
                {!booking.permissions.is_manager && <Alert tone="amber">This booking belongs to another department.</Alert>}
                <div className="flex flex-wrap gap-2">
                  {booking.permissions.can_check_in && (
                    <Button icon={booking.items.length ? PackageCheck : LogIn} loading={busy} onClick={() => act('check-in', booking.items.length ? 'Equipment issued' : 'Lab access granted')}>
                      {booking.items.length ? 'Issue equipment' : 'Grant lab access'}
                    </Button>
                  )}
                  {booking.permissions.can_return && <Button icon={PackageCheck} onClick={() => setReturning(true)}>Confirm return</Button>}
                  {booking.permissions.can_complete && <Button variant="success" icon={CheckCircle2} loading={busy} onClick={() => act('complete', 'Lab checked out')}>Check out</Button>}
                  {booking.status === 'pending' && <Alert tone="amber">This request has not been approved yet.</Alert>}
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
      {booking && returning && (
        <ReturnModal
          booking={booking}
          issues={booking.issues}
          open
          onClose={() => setReturning(false)}
          onDone={async () => setBooking(await api.get(`/bookings/${booking.id}`))}
        />
      )}
    </div>
  );
}
