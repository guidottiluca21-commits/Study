import { type ReactNode } from 'react';
import { AppProvider, navigate, usePath, type AppCtx, type Toast } from './ctx.tsx';
import type { Api } from './api/types.ts';
import { Forgot, Landing, Reset, UnsubscribePage } from './pages/Auth.tsx';
import { Onboarding } from './pages/Onboarding.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Preferences } from './pages/Preferences.tsx';
import { Library } from './pages/Library.tsx';
import { NewsletterView, Newsletters, Preview } from './pages/Newsletters.tsx';
import { Account } from './pages/Account.tsx';
import { Admin } from './pages/Admin.tsx';
import { Privacy } from './pages/Privacy.tsx';

function Nav({ ctx, path }: { ctx: AppCtx; path: string }) {
  const admin = ctx.state?.profile.role === 'admin';
  const items: [string, string][] = [['/', 'Home'], ['/library', 'Letture'], ['/newsletters', 'Newsletter'], ['/preferences', 'Preferenze']];
  const cur = (p: string) => (p === '/' ? path === '/' : path.startsWith(p));
  return (<>
    <nav className="nav-desktop" aria-label="Principale">
      {items.map(([p, l]) => <a key={p} href={`#${p}`} aria-current={cur(p) ? 'page' : undefined}>{l}</a>)}
      <a href="#/account" aria-current={cur('/account') ? 'page' : undefined}>Account</a>
      {admin && <a href="#/admin" aria-current={cur('/admin') ? 'page' : undefined}>Admin</a>}
      <button className="btn quiet small" onClick={async () => { await ctx.api.signOut(); ctx.signedOut(); navigate('/'); }}>Esci</button>
    </nav>
    <nav className="nav-bottom" aria-label="Principale (mobile)">
      {items.map(([p, l]) => <a key={p} href={`#${p}`} aria-current={cur(p) ? 'page' : undefined}>{l}</a>)}
      <a href="#/account" aria-current={cur('/account') ? 'page' : undefined}>Account</a>
    </nav>
  </>);
}

function Shell({ ctx, path, loading, toasts, children }: { ctx: AppCtx; path: string; loading: boolean; toasts: Toast[]; children: ReactNode }) {
  return (<>
    <a className="skip" href="#main">Vai al contenuto</a>
    <header className="topbar"><div className="shell">
      <a className="brand" href="#/">Anesthesia <span>&amp;</span> Critical Care Digest</a>
      {ctx.session ? <Nav ctx={ctx} path={path} /> : <nav className="nav-desktop" aria-label="Accesso" style={{ display: 'flex' }}><a href="#/signin">Accedi</a><a href="#/signup">Registrati</a></nav>}
    </div></header>
    <main id="main" tabIndex={-1}><div className="shell">{loading ? <p role="status">Caricamento…</p> : children}</div></main>
    <footer className="foot"><div className="shell">
      Supporto allo studio personale: non sostituisce linee guida, articoli completi né il giudizio clinico. · <a href="#/privacy">Privacy</a>
      {ctx.api.mode === 'demo' && <> · <strong>MODALITÀ DEMO</strong></>}
    </div></footer>
    <div className="toasts" aria-live="polite" role="status">{toasts.map((t) => <div key={t.id} className={`toast${t.kind === 'error' ? ' error' : ''}`}>{t.text}</div>)}</div>
  </>);
}

function Routes({ ctx }: { ctx: AppCtx }) {
  const path = usePath();
  const authed = !!ctx.session && !!ctx.state;
  if (path === '/privacy') return <Privacy />;
  if (path.startsWith('/unsubscribe/')) return <UnsubscribePage token={path.split('/')[2] ?? ''} />;
  if (path === '/forgot') return <Forgot />;
  if (path === '/reset') return <Reset />;
  if (!ctx.session) return <Landing mode={path === '/signup' ? 'signup' : 'signin'} />;
  if (!authed) return <p role="status">Caricamento del profilo…</p>;
  if (path === '/welcome') return <Onboarding />;
  if (path === '/preferences') return <Preferences />;
  if (path === '/library') return <Library />;
  if (path === '/newsletters') return <Newsletters />;
  if (path.startsWith('/newsletters/')) return <NewsletterView id={path.split('/')[2] ?? ''} />;
  if (path === '/preview') return <Preview />;
  if (path === '/account') return <Account />;
  if (path === '/admin') return <Admin />;
  return <Dashboard />;
}

export function App({ api }: { api: Api }) {
  const path = usePath();
  return (
    <AppProvider api={api}>
      {(c) => <Shell ctx={c} path={path} loading={c.loading} toasts={c.toasts}><Routes ctx={c} /></Shell>}
    </AppProvider>
  );
}
