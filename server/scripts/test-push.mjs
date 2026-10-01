// Sends a test web push to every device a user subscribed: node scripts/test-push.mjs student@uni.edu
import webpush from 'web-push';
import { all, get } from '../src/db.js';
import '../src/services/push.js'; // configures VAPID keys

const email = process.argv[2] || 'student@uni.edu';
const user = get('SELECT id FROM users WHERE email = ?', email);
if (!user) throw new Error(`No user ${email}`);
const subs = all('SELECT * FROM push_subscriptions WHERE user_id = ?', user.id);
if (!subs.length) console.log('No subscribed devices for', email);
for (const s of subs) {
  try {
    const r = await webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      JSON.stringify({ title: 'UniLab test notification', body: 'Push notifications are working.', url: '/notifications' }),
    );
    console.log(`Delivered to ${new URL(s.endpoint).host} — HTTP ${r.statusCode}`);
  } catch (err) {
    console.log(`Failed for ${new URL(s.endpoint).host} — HTTP ${err.statusCode || ''} ${err.body || err.message}`);
  }
}
