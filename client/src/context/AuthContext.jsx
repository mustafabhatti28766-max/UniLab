import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, tokenStore } from '../lib/api';
import { isManagerRole } from '../lib/format';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    tokenStore.set(null);
    setUser(null);
  }, []);

  useEffect(() => {
    if (!tokenStore.get()) {
      setReady(true);
      return;
    }
    api
      .get('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => tokenStore.set(null))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    const onUnauthorized = () => logout();
    window.addEventListener('unilab:unauthorized', onUnauthorized);
    return () => window.removeEventListener('unilab:unauthorized', onUnauthorized);
  }, [logout]);

  const login = useCallback(async (email, password) => {
    const r = await api.post('/auth/login', { email, password });
    tokenStore.set(r.token);
    setUser(r.user);
    return r.user;
  }, []);

  const register = useCallback(async (payload) => {
    const r = await api.post('/auth/register', payload);
    tokenStore.set(r.token);
    setUser(r.user);
    return r.user;
  }, []);

  const refresh = useCallback(async () => {
    const r = await api.get('/auth/me');
    setUser(r.user);
    return r.user;
  }, []);

  const value = useMemo(
    () => ({
      user,
      ready,
      login,
      register,
      logout,
      refresh,
      setUser,
      isManager: isManagerRole(user?.role),
      hasRole: (...roles) => roles.includes(user?.role),
      /** Permission from the admin-controlled role/permission matrix. */
      can: (perm) => user?.role === 'admin' || (user?.permissions || []).includes(perm),
    }),
    [user, ready, login, register, logout, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
