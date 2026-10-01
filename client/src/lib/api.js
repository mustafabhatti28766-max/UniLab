// When the web app is hosted separately (e.g. Vercel), VITE_API_URL points at the backend (e.g. Render).
export const API_ORIGIN = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const BASE = `${API_ORIGIN}/api`;
/** Absolute URL for server-hosted files such as damage photos (/uploads/...). */
export const fileUrl = (p) => (p && p.startsWith('/') ? `${API_ORIGIN}${p}` : p);
const TOKEN_KEY = 'unilab_token';

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t) => {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body, form, signal } = {}) {
  const token = tokenStore.get();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: payload, signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the server. Check your connection.', 0);
  }
  if (res.status === 401 && token) window.dispatchEvent(new Event('unilab:unauthorized'));
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError((isJson && data?.error) || `Request failed (${res.status})`, res.status, isJson ? data?.details : undefined);
  return data;
}

api.get = (path, opts) => api(path, opts);
api.post = (path, body) => api(path, { method: 'POST', body: body ?? {} });
api.put = (path, body) => api(path, { method: 'PUT', body });
api.patch = (path, body) => api(path, { method: 'PATCH', body });
api.del = (path) => api(path, { method: 'DELETE' });
api.form = (path, form, method = 'POST') => api(path, { method, form });

/** Download an authenticated file (e.g. .ics) without exposing the token in a URL. */
export async function downloadFile(path, filename) {
  const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${tokenStore.get()}` } });
  if (!res.ok) throw new ApiError('Download failed', res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
