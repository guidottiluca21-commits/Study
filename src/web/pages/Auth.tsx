import { useState, type FormEvent } from 'react';
import { PageHead, Field, Note, Turnstile, turnstileEnabled } from '../components.tsx';
import { navigate, useApp } from '../ctx.tsx';
import { friendlyError, isEmail, validatePassword } from '../api/errors.ts';

export function Landing({ mode }: { mode: 'signin' | 'signup' }) {
  const { api } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<{ email?: string; password?: string }>({});
  const [sent, setSent] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const signup = mode === 'signup';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const fe: typeof fieldErr = {};
    if (!isEmail(email)) fe.email = 'Inserisci un indirizzo e-mail valido.';
    if (signup) { const pe = validatePassword(password, email); if (pe) fe.password = pe; } else if (!password) fe.password = 'Inserisci la password.';
    setFieldErr(fe);
    if (fe.email || fe.password) return;
    setBusy(true);
    try {
      if (signup) {
        const r = await api.signUp(email.trim(), password, captcha ?? undefined);
        if (r.needsConfirmation) setSent(true); else navigate('/welcome');
      } else {
        await api.signIn(email.trim(), password, captcha ?? undefined);
        navigate('/');
      }
    } catch (err) { setError(friendlyError(err)); } finally { setBusy(false); }
  }

  if (sent) {
    return (
      <div className="auth"><div className="prose">
        <PageHead title="Controlla la tua posta" />
        <p>Se l'indirizzo <strong>{email}</strong> è valido, riceverai un'e-mail con il link per confermarlo. Dopo la conferma potrai accedere e configurare il tuo digest.</p>
        <p className="muted">Non la vedi? Controlla lo spam. Per motivi di sicurezza non indichiamo se un indirizzo è già registrato.</p>
        <div className="row"><button className="btn secondary" onClick={() => api.resendConfirmation(email).catch(() => undefined)}>Invia di nuovo</button><a className="btn quiet" href="#/signin">Vai all'accesso</a></div>
      </div></div>
    );
  }

  return (
    <div className="auth">
      <div>
        <p className="eyebrow">Anesthesia &amp; Critical Care</p>
        <h1>Una selezione di letteratura pensata per te, ogni lunedì alle 06:00.</h1>
        <p className="lede">Le novità più rilevanti per i tuoi interessi, un articolo fondamentale alla settimana per costruire solide basi cliniche. Gratuito, senza pubblicità.</p>
        <ul className="muted" style={{ paddingLeft: '1.1rem' }}>
          <li>Fonti verificabili: ogni articolo rimanda a PubMed.</li>
          <li>Tu scegli argomenti, priorità e quante novità ricevere.</li>
          <li>Puoi sospendere o annullare l'iscrizione in qualsiasi momento.</li>
        </ul>
      </div>
      <form onSubmit={submit} noValidate className="card" aria-labelledby="auth-title">
        <h2 id="auth-title">{signup ? 'Crea il tuo account' : 'Accedi'}</h2>
        {api.mode === 'demo' && <Note>Modalità demo: i dati restano solo in questo browser e non viene inviata alcuna e-mail.</Note>}
        {error && <Note kind="error">{error}</Note>}
        <Field label="Indirizzo e-mail" error={fieldErr.email}>{(p) => <input {...p} type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
        <Field label="Password" hint={signup ? 'Almeno 10 caratteri.' : undefined} error={fieldErr.password}>
          {(p) => <input {...p} type="password" autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required />}
        </Field>
        <Turnstile onToken={setCaptcha} />
        {signup && <p className="small muted">Registrandoti accetti l'<a href="#/privacy">informativa sulla privacy</a>. Il consenso a ricevere la newsletter si dà separatamente, durante la configurazione.</p>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" type="submit" disabled={busy || (turnstileEnabled() && !captcha)}>{busy ? 'Attendi…' : signup ? 'Registrati' : 'Accedi'}</button>
          {signup ? <a href="#/signin">Ho già un account</a> : <><a href="#/signup">Crea un account</a><a href="#/forgot">Password dimenticata?</a></>}
        </div>
      </form>
    </div>
  );
}

export function Forgot() {
  const { api } = useApp();
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!isEmail(email)) { setErr('Inserisci un indirizzo e-mail valido.'); return; }
    setErr(null);
    try { await api.requestPasswordReset(email.trim(), captcha ?? undefined); setDone(true); } catch (x) { setErr(friendlyError(x)); }
  }
  return (
    <div className="prose" style={{ paddingTop: 24 }}>
      <PageHead title="Recupera la password" />
      {done ? <Note>Se l'indirizzo è registrato, riceverai a breve un'e-mail con il link per scegliere una nuova password.</Note> : (
        <form onSubmit={submit} noValidate>
          <Field label="Indirizzo e-mail" error={err}>{(p) => <input {...p} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Turnstile onToken={setCaptcha} />
          <div className="row"><button className="btn" type="submit" disabled={turnstileEnabled() && !captcha}>Invia il link</button><a href="#/signin">Torna all'accesso</a></div>
        </form>
      )}
    </div>
  );
}

export function Reset() {
  const { api, session, notify, fail } = useApp();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const pe = validatePassword(pw, session?.email ?? '');
    if (pe) { setErr(pe); return; }
    try { await api.updatePassword(pw); notify('Password aggiornata.'); navigate('/'); } catch (x) { fail(x); }
  }
  if (!session) return <div className="prose" style={{ paddingTop: 24 }}><PageHead title="Nuova password" /><Note kind="error">Il link non è valido o è scaduto. Richiedine uno nuovo dalla pagina di <a href="#/forgot">recupero password</a>.</Note></div>;
  return (
    <div className="prose" style={{ paddingTop: 24 }}>
      <PageHead title="Scegli una nuova password" />
      <form onSubmit={submit} noValidate>
        <Field label="Nuova password" hint="Almeno 10 caratteri." error={err}>{(p) => <input {...p} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
        <button className="btn" type="submit">Salva la password</button>
      </form>
    </div>
  );
}

export function UnsubscribePage({ token }: { token: string }) {
  const { api, fail } = useApp();
  const [done, setDone] = useState<boolean | null>(null);
  return (
    <div className="prose" style={{ paddingTop: 24 }}>
      <PageHead title="Annulla l'iscrizione" />
      {done === null && (<>
        <p>Confermi di voler smettere di ricevere il digest settimanale? Non riceverai altre e-mail editoriali. Potrai riattivare l'iscrizione in qualsiasi momento accedendo al tuo account.</p>
        <button className="btn" onClick={async () => { try { setDone(await api.unsubscribeByToken(token)); } catch (e) { fail(e); } }}>Conferma e annulla l'iscrizione</button>
      </>)}
      {done === true && <Note>Iscrizione annullata. Non riceverai ulteriori newsletter.</Note>}
      {done === false && <Note kind="error">Il link non è valido. Accedi al tuo account per gestire l'iscrizione dalle preferenze.</Note>}
    </div>
  );
}
