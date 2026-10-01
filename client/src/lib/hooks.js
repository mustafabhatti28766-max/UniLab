import { useCallback, useEffect, useRef, useState } from 'react';

/** Load data from an async function; re-runs when deps change. */
export function useAsync(fn, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const counter = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(
    async (silent = false) => {
      const id = ++counter.current;
      if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await fnRef.current();
        if (id === counter.current) setState({ data, error: null, loading: false });
        return data;
      } catch (error) {
        if (error.name === 'AbortError') return undefined;
        if (id === counter.current) setState((s) => ({ ...s, error, loading: false }));
        return undefined;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  useEffect(() => {
    if (enabled) load();
  }, [load, enabled]);

  const setData = useCallback((updater) => setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater })), []);
  return { ...state, reload: load, setData };
}

export function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useInterval(fn, ms, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
}

export function useTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · UniLab` : 'UniLab — Lab & Equipment Booking';
  }, [title]);
}
