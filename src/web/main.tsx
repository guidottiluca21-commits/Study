import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App.tsx';
import { createSupabaseApi } from './api/supabase.ts';
import type { Api } from './api/types.ts';

async function pickApi(): Promise<Api | null> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (url && key) return createSupabaseApi(url, key);
  if (import.meta.env.VITE_ENABLE_DEMO === '1') {
    const { createDemoApi } = await import('./api/demo.ts'); // incluso solo nelle build demo
    return createDemoApi();
  }
  return null;
}

// Il primo progetto pubblicato su questo indirizzo registrava un service worker che può servire versioni vecchie del sito: lo si disattiva.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => void r.unregister())).catch(() => undefined);
  if ('caches' in window) caches.keys().then((ks) => ks.forEach((k) => void caches.delete(k))).catch(() => undefined);
}

pickApi().then((api) => {
  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      {api ? <App api={api} /> : (
        <main style={{ maxWidth: 640, margin: '48px auto', padding: 16 }}>
          <h1>Configurazione mancante</h1>
          <p>Questa installazione non è collegata a un backend. Imposta <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> (vedi docs/DEPLOY.md).</p>
        </main>
      )}
    </StrictMode>,
  );
});
