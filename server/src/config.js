import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.join(__dirname, '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const CLIENT_DIST = path.join(ROOT, '..', 'client', 'dist');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const PORT = Number(process.env.PORT) || 4000;
export const TOKEN_TTL = process.env.TOKEN_TTL || '7d';
export const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

/** Minutes after the due time before a return counts as late. */
export const LATE_GRACE_MINUTES = 15;
/** How early before the start time staff may issue equipment / grant access. */
export const EARLY_CHECKIN_MINUTES = 60;
/** Approved bookings become "Reserved" (locked + confirmed) this many hours before start. */
export const RESERVE_LEAD_HOURS = 24;

// The JWT secret is taken from the environment, or generated once and persisted
// so that sessions survive server restarts without shipping a hard-coded secret.
function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, '.jwt_secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export const JWT_SECRET = loadSecret();

export const SMTP = {
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  from: process.env.SMTP_FROM || 'UniLab <no-reply@unilab.local>',
};
