import { useState, type FormEvent } from 'react';
import { PageHead, Field, Note, download, fmtDate } from '../components.tsx';
import { navigate, useApp } from '../ctx.tsx';
import { CONSENT_TEXT, CONSENT_VERSION } from './Onboarding.tsx';
import { isEmail } from '../api/errors.ts';

export function Account() {
  const { api, state, session, reload, notify, fail, signedOut } = useApp();
  const [name, setName] = useState(state?.profile.display_name ?? '');
  const [newEmail, setNewEmail] = useState('');
  const [emailErr, setEmailErr] = useState<string | null>(null);
  const [until, setUntil] = useState('');
  const [consent, setConsent] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  if (!state || !session) return null;
  const p = state.profile;

  const run = (fn: () => Promise<void>, ok: string) => async () => { try { await fn(); await reload(); notify(ok); } catch (e) { fail(e); } };

  async function changeEmail(e: FormEvent) {
    e.preventDefault();
    if (!isEmail(newEmail)) { setEmailErr('Inserisci un indirizzo e-mail valido.'); return; }
    setEmailErr(null);
    try { await api.requestEmailChange(newEmail.trim()); notify(api.mode === 'demo' ? 'Indirizzo aggiornato (demo).' : 'Ti abbiamo inviato un link di conferma: l\'indirizzo cambia solo dopo la conferma.'); setNewEmail(''); } catch (x) { fail(x); }
  }

  return (
    <div className="prose">
      <PageHead eyebrow="Account" title="Il tuo account" />

      <section className="section" aria-labelledby="a-profile">
        <h2 id="a-profile">Profilo</h2>
        <form onSubmit={(e) => { e.preventDefault(); void run(() => api.saveName(name), 'Nome salvato.')(); }}>
          <Field label="Nome (facoltativo)" hint="Appare nella newsletter.">{(x) => <input {...x} type="text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <button className="btn secondary" type="submit">Salva il nome</button>
        </form>
      </section>

      <section className="section" aria-labelledby="a-email">
        <h2 id="a-email">Indirizzo e-mail</h2>
        <p>Indirizzo attuale: <strong>{session.email}</strong> {session.emailConfirmed ? <span className="muted">(verificato)</span> : <span className="muted">(non verificato)</span>}</p>
        <form onSubmit={changeEmail} noValidate>
          <Field label="Nuovo indirizzo" hint="Per sicurezza riceverai un link di conferma." error={emailErr}>{(x) => <input {...x} type="email" autoComplete="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />}</Field>
          <button className="btn secondary" type="submit">Cambia indirizzo</button>
        </form>
      </section>

      <section className="section" aria-labelledby="a-news">
        <h2 id="a-news">Newsletter</h2>
        <p>Stato: <strong>{{ pending: 'non ancora attivata', active: 'attiva', paused: 'in pausa', unsubscribed: 'annullata' }[p.newsletter_status]}</strong>{p.paused_until ? ` (fino al ${fmtDate(p.paused_until + 'T12:00:00Z')})` : ''}{p.consent_at ? <span className="muted"> · consenso del {fmtDate(p.consent_at)}</span> : null}</p>
        {p.newsletter_status === 'active' && (<div className="stack">
          <Field label="Sospendi fino al (facoltativo)" hint="Lascia vuoto per una pausa senza data.">{(x) => <input {...x} type="date" value={until} onChange={(e) => setUntil(e.target.value)} min={new Date().toISOString().slice(0, 10)} />}</Field>
          <div className="row"><button className="btn secondary" onClick={run(() => api.pause(until || null), 'Invii sospesi.')}>Sospendi gli invii</button><button className="btn danger" onClick={run(() => api.unsubscribe(), 'Iscrizione annullata.')}>Annulla l'iscrizione</button></div>
        </div>)}
        {p.newsletter_status === 'paused' && <div className="row"><button className="btn" onClick={run(() => api.resume(), 'Invii riattivati.')}>Riprendi gli invii</button><button className="btn danger" onClick={run(() => api.unsubscribe(), 'Iscrizione annullata.')}>Annulla l'iscrizione</button></div>}
        {(p.newsletter_status === 'unsubscribed' || p.newsletter_status === 'pending') && (<div>
          <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>{CONSENT_TEXT}</span></label>
          <button className="btn" disabled={!consent} onClick={run(() => api.giveConsent(CONSENT_VERSION), 'Newsletter attivata.')}>Attiva la newsletter</button>
        </div>)}
      </section>

      <section className="section" aria-labelledby="a-data">
        <h2 id="a-data">I tuoi dati</h2>
        <p>Puoi scaricare una copia dei tuoi dati personali in formato JSON (profilo, preferenze, libreria, progressi, newsletter, consensi).</p>
        <button className="btn secondary" onClick={async () => { try { download(`i-miei-dati-${new Date().toISOString().slice(0, 10)}.json`, await api.exportData()); notify('Esportazione completata.'); } catch (e) { fail(e); } }}>Scarica i miei dati</button>
      </section>

      <section className="section" aria-labelledby="a-del">
        <h2 id="a-del">Elimina l'account</h2>
        <Note kind="error">L'eliminazione è definitiva: profilo, preferenze, libreria, progressi, newsletter e consensi vengono cancellati. Non può essere annullata.</Note>
        <Field label="Per confermare scrivi ELIMINA">{(x) => <input {...x} type="text" autoComplete="off" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />}</Field>
        <button className="btn danger" disabled={confirmText !== 'ELIMINA'} onClick={async () => { try { await api.deleteAccount(); signedOut(); notify('Account eliminato.'); navigate('/'); } catch (e) { fail(e); } }}>Elimina definitivamente il mio account</button>
      </section>
    </div>
  );
}
