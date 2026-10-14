import { PageHead, Note, Progress, fmtDate } from '../components.tsx';
import { navigate, useApp } from '../ctx.tsx';
import { useAsync } from '../hooks.ts';
import { nextSend } from '../preview.ts';
import { STUDY_TYPE_LABEL_IT } from '../../core/types.ts';

export function Dashboard() {
  const { api, state, session } = useApp();
  const { data } = useAsync(async () => {
    const [issues, library] = await Promise.all([api.listIssues(), api.library()]);
    return { issues, library };
  }, []);
  if (!state) return null;
  const p = state.profile;
  const latest = data?.issues[0];
  const allowed = new Set(state.coreTopicIds.length ? state.coreTopicIds : state.coreTopics.map((t) => t.id));
  const coreItems = state.coreItems.filter((i) => allowed.has(i.topic_id));
  const done = state.coreProgress.filter((c) => (c.status === 'completed' || c.status === 'to_review') && coreItems.some((i) => i.id === c.item_id)).length;
  const completed = (data?.library ?? []).filter((l) => l.status === 'completed').slice(0, 5);
  const next = nextSend();
  const active = p.newsletter_status === 'active';

  return (
    <div>
      <PageHead eyebrow="Home" title={p.display_name ? `Buongiorno, ${p.display_name}` : 'Il tuo digest'} />
      {!p.onboarding_completed && <Note>La configurazione non è completa. <a href="#/welcome">Riprendi la procedura guidata</a> (2 minuti).</Note>}
      {session && !session.emailConfirmed && <Note kind="error">L'indirizzo e-mail non è verificato: non riceverai la newsletter finché non confermi il link che ti abbiamo inviato.</Note>}

      <div className="grid2">
        <section className="section" aria-labelledby="h-next">
          <h2 id="h-next">Prossima newsletter</h2>
          {active ? (<>
            <p className="stat" style={{ fontSize: '1.4rem' }}>{fmtDate(next.toISOString(), { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <p className="muted">ore 06:00 (Europe/Rome). L'orario può variare di qualche decina di minuti.</p>
          </>) : p.newsletter_status === 'paused' ? (
            <p>Invii in pausa{p.paused_until ? ` fino al ${fmtDate(p.paused_until + 'T12:00:00Z')}` : ''}. <a href="#/account">Gestisci</a></p>
          ) : p.newsletter_status === 'unsubscribed' ? (
            <p>Iscrizione annullata. <a href="#/account">Riattivala dalle impostazioni dell'account</a></p>
          ) : <p>La newsletter non è ancora attiva: serve il tuo consenso. <a href="#/welcome">Attivala</a></p>}
          <div className="row" style={{ marginTop: 8 }}>
            {latest && <button className="btn" onClick={() => navigate(`/newsletters/${latest.id}`)}>Apri l'ultima newsletter</button>}
            <a className="btn secondary" href="#/preview">Anteprima di oggi</a>
          </div>
        </section>

        <section className="section" aria-labelledby="h-week">
          <h2 id="h-week">Questa settimana</h2>
          {latest ? (<>
            <p><span className="stat">{latest.items}</span> <span className="muted">letture selezionate</span></p>
          </>) : <p className="muted">Nessuna newsletter ancora ricevuta. La prima arriverà lunedì alle 06:00, se la newsletter è attiva.</p>}
        </section>
      </div>

      <div className="grid2">
        <section className="section" aria-labelledby="h-core">
          <h2 id="h-core">Core Knowledge</h2>
          {state.prefs.core_enabled ? (<>
            <p><span className="stat">{done}</span> <span className="muted">di {coreItems.length} articoli fondamentali completati</span></p>
            <Progress value={done} max={coreItems.length} label="Avanzamento del percorso Core Knowledge" />
            <p><a href="#/library">Vedi il percorso</a></p>
          </>) : <p className="muted">Il percorso è disattivato. <a href="#/preferences">Attivalo dalle preferenze</a>.</p>}
        </section>

        <section className="section" aria-labelledby="h-last">
          <h2 id="h-last">Ultime letture completate</h2>
          {completed.length ? (
            <ul className="list">{completed.map((l) => <li key={l.article_id}><p className="item-title">{l.title}</p><p className="meta">{STUDY_TYPE_LABEL_IT[l.study_type]} · {l.journal}</p></li>)}</ul>
          ) : <p className="muted">Quando segnerai un articolo come completato apparirà qui.</p>}
        </section>
      </div>

      <p><a href="#/preferences">Modifica le tue preferenze</a></p>
    </div>
  );
}
