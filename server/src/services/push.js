import fs from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { DATA_DIR } from '../config.js';
import { all, run } from '../db.js';

// VAPID keys identify this server to browser push services. They are generated
// once and persisted (or supplied via VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).
function loadKeys() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const file = path.join(DATA_DIR, 'vapid.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  return keys;
}

const keys = loadKeys();
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@unilab.local', keys.publicKey, keys.privateKey);

export const vapidPublicKey = keys.publicKey;

export function saveSubscription(userId, sub) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return false;
  run(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    userId,
    sub.endpoint,
    sub.keys.p256dh,
    sub.keys.auth,
  );
  return true;
}

export const removeSubscription = (endpoint) => run('DELETE FROM push_subscriptions WHERE endpoint = ?', endpoint);

/** Fire-and-forget push to every device the user subscribed. */
export function sendPush(userId, payload) {
  const subs = all('SELECT * FROM push_subscriptions WHERE user_id = ?', userId);
  for (const s of subs) {
    webpush
      .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 })
      .catch((err) => {
        if (err.statusCode === 404 || err.statusCode === 410) removeSubscription(s.endpoint); // expired subscription
      });
  }
}
