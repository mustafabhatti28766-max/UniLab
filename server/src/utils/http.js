export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details);
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
export const forbidden = (msg = 'You do not have permission to perform this action') => new HttpError(403, msg);
export const conflict = (msg, details) => new HttpError(409, msg, details);

export function requireFields(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || String(body[f]).trim() === '');
  if (missing.length) throw badRequest(`Missing required field(s): ${missing.join(', ')}`);
}

export const toInt = (v, def = null) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
};

export function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) throw badRequest(`Invalid ${field}. Allowed: ${allowed.join(', ')}`);
  return value;
}

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export const isEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
