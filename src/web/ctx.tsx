import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Api, SessionInfo, UserState } from './api/types.ts';
import { friendlyError } from './api/errors.ts';

// ---------- router a hash (compatibile con GitHub Pages) ------------------------------------
export function currentPath(): string {
  const h = location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h.split('?')[0]! : '/';
}
export function navigate(path: string): void { location.hash = path; }
export function usePath(): string {
  const [p, setP] = useState(currentPath());
  useEffect(() => {
    const on = () => setP(currentPath());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return p;
}

// ---------- notifiche -------------------------------------------------------------------------
export interface Toast { id: number; text: string; kind: 'ok' | 'error' }
export interface AppCtx {
  api: Api;
  session: SessionInfo | null;
  state: UserState | null;
  reload: () => Promise<void>;
  notify: (text: string, kind?: 'ok' | 'error') => void;
  fail: (e: unknown) => void;
  signedOut: () => void;
}
const Ctx = createContext<AppCtx | null>(null);
export const useApp = (): AppCtx => { const c = useContext(Ctx); if (!c) throw new Error('contesto mancante'); return c; };

export function AppProvider({ api, children }: { api: Api; children: (c: AppCtx & { loading: boolean; toasts: Toast[] }) => ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [state, setState] = useState<UserState | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const notify = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  const fail = useCallback((e: unknown) => notify(friendlyError(e), 'error'), [notify]);

  const reload = useCallback(async () => {
    try { setState(await api.loadState()); } catch (e) { fail(e); }
  }, [api, fail]);

  useEffect(() => {
    let live = true;
    (async () => {
      const s = await api.getSession().catch(() => null);
      if (!live) return;
      setSession(s);
      if (s) { try { setState(await api.loadState()); } catch (e) { fail(e); } }
      setLoading(false);
    })();
    const off = api.onAuthChange(async (s, event) => {
      setSession(s);
      if (!s) setState(null);
      else if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION') {
        try { setState(await api.loadState()); } catch { /* il profilo può non essere ancora pronto */ }
      }
      if (event === 'PASSWORD_RECOVERY') navigate('/reset');
    });
    return () => { live = false; off(); };
  }, [api, fail]);

  const signedOut = useCallback(() => { setSession(null); setState(null); }, []);
  return <Ctx.Provider value={{ api, session, state, reload, notify, fail, signedOut }}>{children({ api, session, state, reload, notify, fail, signedOut, loading, toasts })}</Ctx.Provider>;
}
