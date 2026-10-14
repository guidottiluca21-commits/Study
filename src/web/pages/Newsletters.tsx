import { useState } from 'react';
import { PageHead, Note, MailFrame, fmtDate } from '../components.tsx';
import { navigate, useApp } from '../ctx.tsx';
import { useAsync } from '../hooks.ts';
import { buildPreview } from '../preview.ts';

export function Newsletters() {
  const { api, state, notify, fail } = useApp();
  const list = useAsync(() => api.listIssues(), []);
  const [busy, setBusy] = useState(false);
  if (!state) return null;
  const canTest = state.profile.role === 'admin' || state.profile.test_authorized;
  async function test() {
    setBusy(true);
    try { await api.requestTestSend(); notify(api.mode === 'demo' ? 'Newsletter generata (demo).' : 'Richiesta registrata: l\'invio di prova verrà elaborato alla prossima esecuzione dell\'automazione.'); list.reload(); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  return (
    <div>
      <PageHead eyebrow="Newsletter" title="Le tue newsletter" />
      <div className="row" style={{ marginBottom: 16 }}>
        <a className="btn" href="#/preview">Anteprima di oggi</a>
        {canTest && <button className="btn secondary" onClick={test} disabled={busy}>{api.mode === 'demo' ? 'Genera la newsletter della settimana' : 'Richiedi un invio di prova'}</button>}
      </div>
      {list.loading && <p>Caricamento…</p>}
      {!list.loading && !list.data?.length && <p className="muted">Non hai ancora ricevuto nessuna newsletter. Puoi vedere in anteprima come sarebbe quella di oggi.</p>}
      <ul className="list">
        {list.data?.map((i) => (
          <li key={i.id}>
            <p className="item-title"><a href={`#/newsletters/${i.id}`}>Settimana del {fmtDate(i.week_start + 'T12:00:00Z')}</a></p>
            <p className="meta">{i.items} letture · circa {i.minutes} minuti · {i.status === 'sent' ? `inviata il ${i.sent_at ? fmtDate(i.sent_at) : ''}` : i.status === 'failed' ? 'invio non riuscito (disponibile qui)' : 'in coda di invio'}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NewsletterView({ id }: { id: string }) {
  const { api } = useApp();
  const q = useAsync(() => api.getIssue(id), [id]);
  return (
    <div>
      <PageHead eyebrow="Newsletter" title={q.data ? `Settimana del ${fmtDate(q.data.week_start + 'T12:00:00Z')}` : 'Newsletter'} />
      <p><a href="#/newsletters">← Tutte le newsletter</a></p>
      {q.loading && <p>Caricamento…</p>}
      {q.error && <Note kind="error">Impossibile caricare la newsletter.</Note>}
      {q.data && <MailFrame html={q.data.html} title={q.data.subject} />}
    </div>
  );
}

export function Preview() {
  const { api, state } = useApp();
  const q = useAsync(() => (state ? buildPreview(api, state) : Promise.resolve(null)), [state?.topics, state?.prefs, state?.coreTopicIds]);
  return (
    <div>
      <PageHead eyebrow="Anteprima" title="La tua newsletter, se fosse oggi">Calcolata ora con le tue preferenze e il catalogo disponibile, con lo stesso codice usato per l'invio. Non viene inviata né salvata.</PageHead>
      <div className="row" style={{ marginBottom: 12 }}><button className="btn secondary" onClick={() => navigate('/preferences')}>Modifica le preferenze</button></div>
      {q.loading && <p>Calcolo in corso…</p>}
      {q.data?.out.empty && <Note>Con le preferenze attuali non c'è nulla di sufficientemente rilevante: non aggiungiamo riempitivi. Prova ad ampliare gli argomenti.</Note>}
      {q.data && <MailFrame html={q.data.out.html} title="Anteprima newsletter" />}
    </div>
  );
}
