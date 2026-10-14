import { useMemo, useState } from 'react';
import { PageHead, Progress, fmtDate } from '../components.tsx';
import { useApp } from '../ctx.tsx';
import { useAsync } from '../hooks.ts';
import { STUDY_TYPE_LABEL_IT } from '../../core/types.ts';
import type { ArticleStatus, LibraryRow } from '../api/types.ts';

const TABS: { key: 'all' | ArticleStatus; label: string }[] = [
  { key: 'all', label: 'Ricevuti' }, { key: 'saved', label: 'Salvati' }, { key: 'to_read', label: 'Da leggere' }, { key: 'completed', label: 'Completati' }, { key: 'to_review', label: 'Da ripassare' },
];
const ACTIONS: { key: ArticleStatus; label: string }[] = [
  { key: 'saved', label: 'Salva' }, { key: 'to_read', label: 'Da leggere' }, { key: 'completed', label: 'Completato' }, { key: 'to_review', label: 'Da ripassare' },
];
const pubmed = (pmid: string) => `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;

export function Library() {
  const { api, state, reload, notify, fail } = useApp();
  const [tab, setTab] = useState<'all' | ArticleStatus>('all');
  const lib = useAsync(() => api.library(), []);
  const issues = useAsync(() => api.listIssues(), []);
  const rows = useMemo(() => (lib.data ?? []).filter((r) => tab === 'all' || r.status === tab), [lib.data, tab]);
  if (!state) return null;

  async function setStatus(r: LibraryRow, status: ArticleStatus) {
    try { await api.setArticleStatus(r.article_id, status); lib.reload(); notify(status === 'completed' ? 'Segnato come completato.' : 'Stato aggiornato.'); } catch (e) { fail(e); }
  }
  async function setCore(id: string, status: 'completed' | 'to_review' | 'reading' | 'skipped') {
    try { await api.setCoreStatus(id, status); await reload(); notify('Percorso aggiornato.'); } catch (e) { fail(e); }
  }
  const progress = new Map(state.coreProgress.map((p) => [p.item_id, p]));
  const allowed = new Set(state.coreTopicIds.length ? state.coreTopicIds : state.coreTopics.map((t) => t.id));

  return (
    <div>
      <PageHead eyebrow="Libreria personale" title="Le tue letture">Persistente tra sessioni e dispositivi.</PageHead>

      <section className="section" aria-labelledby="l-art">
        <h2 id="l-art">Articoli</h2>
        <div role="tablist" aria-label="Filtra per stato" className="tabs">
          {TABS.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>{t.label}{lib.data ? ` (${t.key === 'all' ? lib.data.length : lib.data.filter((r) => r.status === t.key).length})` : ''}</button>)}
        </div>
        {lib.loading && <p>Caricamento…</p>}
        {!lib.loading && !rows.length && <p className="muted">Nessun articolo in questa sezione.</p>}
        <ul className="list">
          {rows.map((r) => (
            <li key={r.article_id}>
              <p className="item-title"><a href={pubmed(r.pmid)} target="_blank" rel="noopener noreferrer">{r.title}</a></p>
              <p className="meta">{STUDY_TYPE_LABEL_IT[r.study_type]} · {r.journal} · ricevuto il {fmtDate(r.received_at)}</p>
              <div className="row actions" role="group" aria-label={`Cambia stato: ${r.title}`}>
                {ACTIONS.map((a) => <button key={a.key} className={`btn small ${r.status === a.key ? '' : 'secondary'}`} aria-pressed={r.status === a.key} onClick={() => setStatus(r, a.key)}>{a.label}</button>)}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="section" aria-labelledby="l-core">
        <h2 id="l-core">Avanzamento nel curriculum fondamentale</h2>
        {state.coreTopics.filter((t) => allowed.has(t.id)).map((t) => {
          const items = state.coreItems.filter((i) => i.topic_id === t.id);
          const done = items.filter((i) => ['completed', 'to_review'].includes(progress.get(i.id)?.status ?? '')).length;
          return (
            <details key={t.id} className="card" style={{ marginBottom: 8 }}>
              <summary><strong>{t.title_it}</strong> <span className="muted small">· {done}/{items.length}</span></summary>
              <Progress value={done} max={items.length} label={`Avanzamento: ${t.title_it}`} />
              <ul className="list">
                {items.map((i) => {
                  const st = progress.get(i.id)?.status;
                  return (
                    <li key={i.id}>
                      <p className="item-title">{i.pmid ? <a href={pubmed(i.pmid)} target="_blank" rel="noopener noreferrer">{i.title}</a> : i.title}</p>
                      <p className="meta">{[i.journal, i.pub_year].filter(Boolean).join(' · ')} · {st ? { sent: 'inviato', reading: 'in lettura', completed: 'completato', to_review: 'da ripassare', skipped: 'saltato' }[st] : 'non ancora proposto'}</p>
                      <div className="row">
                        <button className="btn small secondary" onClick={() => setCore(i.id, 'completed')} aria-pressed={st === 'completed'}>Completato</button>
                        <button className="btn small secondary" onClick={() => setCore(i.id, 'to_review')} aria-pressed={st === 'to_review'}>Da ripassare tra 30 giorni</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
      </section>

      <section className="section" aria-labelledby="l-hist">
        <h2 id="l-hist">Storico delle newsletter</h2>
        {issues.data?.length ? <ul className="list">{issues.data.map((i) => <li key={i.id}><a href={`#/newsletters/${i.id}`}>{fmtDate(i.week_start + 'T12:00:00Z')}</a> <span className="muted">· {i.items} letture, {i.minutes} min</span></li>)}</ul> : <p className="muted">Nessuna newsletter ancora.</p>}
      </section>
    </div>
  );
}
