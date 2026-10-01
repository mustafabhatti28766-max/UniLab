import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from './AuthContext';
import { useInterval } from '../lib/hooks';
import { enablePush } from '../lib/pwa';

const NotificationContext = createContext(null);
const LAST_SEEN_KEY = 'unilab_last_notification';

/** Polls for new notifications and surfaces them as browser (push-style) notifications. */
export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(null);
  const [version, setVersion] = useState(0);
  const lastSeen = useRef(0);
  if (lastSeen.current === 0) {
    try {
      lastSeen.current = Number(localStorage.getItem(LAST_SEEN_KEY) || 0);
    } catch {
      /* storage unavailable */
    }
  }

  const poll = useCallback(async () => {
    if (!user) return;
    try {
      const r = await api.get('/notifications/unread-count');
      setUnread(r.unread);
      setPendingApprovals(r.pending_approvals);
      if (r.latest && r.latest.id > lastSeen.current) {
        if (lastSeen.current && 'Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
          const n = new Notification(r.latest.title, { body: r.latest.message, icon: '/favicon.svg', tag: `unilab-${r.latest.id}` });
          n.onclick = () => {
            window.focus();
            if (r.latest.link) window.location.assign(r.latest.link);
          };
        }
        lastSeen.current = r.latest.id;
        try {
          localStorage.setItem(LAST_SEEN_KEY, String(r.latest.id));
        } catch {
          /* ignore */
        }
        setVersion((v) => v + 1);
      }
    } catch {
      /* offline — try again on next tick */
    }
  }, [user]);

  useEffect(() => {
    poll();
  }, [poll]);
  useInterval(poll, 30000, !!user);

  /** Subscribe this device to Web Push (notifications arrive even when the app is closed). */
  const requestPush = useCallback(async () => {
    try {
      await enablePush();
      return 'granted';
    } catch (err) {
      return err.message;
    }
  }, []);

  return (
    <NotificationContext.Provider value={{ unread, pendingApprovals, version, refresh: poll, setUnread, requestPush }}>
      {children}
    </NotificationContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationContext);
