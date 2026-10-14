import { useState } from 'react';
import { PageHead, Note, Field, fmtDate } from '../components.tsx';
import { useApp } from '../ctx.tsx';
import { useAsync } from '../hooks.ts';
import type { Category } from '../../core/types.ts';

export function Admin() {
  const { api, state, notify, fail } = useApp();
  const ov = useAsync(() => api.admin.overview(), []);
  const users = useAsync(() => api.admin.users(), []);
  const [edit, setEdit] = useState<(Category & { isNew?: boolean }) | null>(null);
  if (!state || state.profile.role !== 'admin') return <div className="prose"><PageHead title="Amministrazione" /><Note kind="error">Questa sezione è riservata agli amministratori.</Note></div>;
  const o = ov.data;

  async function flags(id: string, blocked: boolean | null, test: boolean | null) {
    try { await api.admin.setUserFlags(id, blocked, test); users.reload(); notify('Aggiornato.'); } catch (e) { fail(e); }
  }
  async function saveCat() {
    if (!edit) return;
    try { await api.admin.saveCategory(edit); notify('Categoria salvata.'); setEdit(null); } catch (e) { fail(e); }
  }

  return (
    <div>
      <PageHead eyebrow="Amministrazione" title="Stato del sistema">L'amministratore vede aggregati e indirizzi mascherati: non può leggere password, preferenze o libreria degli utenti.</PageHead>

      <section className="section" aria-labelledby="ad-sum">
        <h2 id="ad-sum">Riepilogo</h2>
        {o ? (
          <table className="plain stack-table"><thead><tr><th>Voce</th><th>Valore</th></tr></thead><tbody>
            <tr><td data-label="Voce">Utenti (totale / attivi / in pausa / disiscritti / in attesa / bloccati)</td><td data-label="Valore">{o.users.total} / {o.users.active} / {o.users.paused} / {o.users.unsubscribed} / {o.users.pending} / {o.users.blocked}</td></tr>
            <tr><td data-label="Voce">Articoli nel catalogo (ultimi 7 giorni)</td><td data-label="Valore">{o.articles.total} ({o.articles.last_7_days})</td></tr>
            <tr><td data-label="Voce">Letture fondamentali verificate / non verificate</td><td data-label="Valore">{o.core_items.verified} / {o.core_items.unverified}</td></tr>
            <tr><td data-label="Voce">Invii negli ultimi 7 giorni (riusciti / falliti / in coda)</td><td data-label="Valore">{o.deliveries_7d.sent} / {o.deliveries_7d.failed} / {o.deliveries_7d.pending}</td></tr>
            <tr><td data-label="Voce">Quota e-mail oggi</td><td data-label="Valore">{o.quota_today.length ? o.quota_today.map((q) => `${q.provider}: ${q.used}`).join(', ') : '0'}</td></tr>
          </tbody></table>
        ) : <p>Caricamento…</p>}
        {o && o.deliveries_7d.failed > 0 && <Note kind="error">Ci sono invii falliti negli ultimi 7 giorni: controlla le esecuzioni qui sotto.</Note>}
      </section>

      <section className="section" aria-labelledby="ad-runs">
        <h2 id="ad-runs">Ultime esecuzioni dell'automazione</h2>
        {o?.recent_runs.length ? <ul className="list">{o.recent_runs.map((r) => (
          <li key={r.id}><p className="item-title">{r.kind} · {r.mode} · <strong>{r.status}</strong></p>
            <p className="meta">{fmtDate(r.started_at, { dateStyle: 'medium', timeStyle: 'short' })}{r.error ? ` · errore: ${r.error}` : ''}</p></li>))}</ul> : <p className="muted">Nessuna esecuzione registrata. Se il workflow settimanale non gira, vedi docs/RUNBOOK.md.</p>}
      </section>

      <section className="section" aria-labelledby="ad-users">
        <h2 id="ad-users">Utenti</h2>
        <table className="plain stack-table"><thead><tr><th>Indirizzo</th><th>Stato</th><th>Ruolo</th><th>Azioni</th></tr></thead><tbody>
          {users.data?.map((u) => (
            <tr key={u.id}><td data-label="Indirizzo">{u.email_masked}</td><td data-label="Stato">{u.newsletter_status}{u.blocked ? ' · bloccato' : ''}</td><td data-label="Ruolo">{u.role}</td>
              <td data-label="Azioni"><div className="row">
                <button className="btn small secondary" onClick={() => flags(u.id, !u.blocked, null)}>{u.blocked ? 'Sblocca' : 'Blocca'}</button>
                <button className="btn small secondary" onClick={() => flags(u.id, null, !u.test_authorized)}>{u.test_authorized ? 'Revoca test' : 'Autorizza test'}</button>
              </div></td></tr>))}
        </tbody></table>
      </section>

      <section className="section" aria-labelledby="ad-cat">
        <h2 id="ad-cat">Categorie</h2>
        <p className="muted">Modificabili senza toccare il codice. Le modifiche valgono dalla prossima ricerca.</p>
        <ul className="list">{state.categories.map((c) => <li key={c.id} className="row between"><span>{c.name_it} <span className="meta">({c.id}{c.active ? '' : ', disattivata'})</span></span><button className="btn small secondary" onClick={() => setEdit(c)}>Modifica</button></li>)}</ul>
        <button className="btn secondary" onClick={() => setEdit({ id: '', group_key: 'cross', name_it: '', name_en: '', pubmed_query: '', keywords: [], sort_order: 500, active: true, isNew: true })}>Nuova categoria</button>
        {edit && (
          <form className="card" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); void saveCat(); }}>
            <h3>{edit.isNew ? 'Nuova categoria' : `Modifica: ${edit.name_it}`}</h3>
            <Field label="Identificativo (minuscole, cifre, trattini)">{(x) => <input {...x} type="text" value={edit.id} disabled={!edit.isNew} onChange={(e) => setEdit({ ...edit, id: e.target.value })} />}</Field>
            <Field label="Nome (italiano)">{(x) => <input {...x} type="text" value={edit.name_it} onChange={(e) => setEdit({ ...edit, name_it: e.target.value })} />}</Field>
            <Field label="Nome (inglese)">{(x) => <input {...x} type="text" value={edit.name_en} onChange={(e) => setEdit({ ...edit, name_en: e.target.value })} />}</Field>
            <Field label="Query PubMed (MeSH e parole chiave)">{(x) => <textarea {...x} value={edit.pubmed_query} onChange={(e) => setEdit({ ...edit, pubmed_query: e.target.value })} />}</Field>
            <Field label="Parole chiave per la classificazione (separate da virgola)">{(x) => <input {...x} type="text" value={edit.keywords.join(', ')} onChange={(e) => setEdit({ ...edit, keywords: e.target.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) })} />}</Field>
            <label className="check"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />Attiva</label>
            <div className="row"><button className="btn" type="submit">Salva</button><button className="btn quiet" type="button" onClick={() => setEdit(null)}>Annulla</button></div>
          </form>
        )}
      </section>
    </div>
  );
}
