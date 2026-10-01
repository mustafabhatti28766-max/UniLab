import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { UPLOAD_DIR } from '../config.js';
import { badRequest } from '../utils/http.js';

const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

export const imageUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ALLOWED[file.mimetype] || path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => (ALLOWED[file.mimetype] ? cb(null, true) : cb(badRequest('Only JPEG, PNG, WebP or GIF images are allowed'))),
});

export const uploadedPath = (req) => (req.file ? `/uploads/${req.file.filename}` : null);

/** Multipart forms send structured data as a JSON string in the `data` field. */
export function parseMultipartData(req) {
  if (typeof req.body?.data === 'string') {
    try {
      return JSON.parse(req.body.data);
    } catch {
      throw badRequest('Malformed form data');
    }
  }
  return req.body || {};
}
