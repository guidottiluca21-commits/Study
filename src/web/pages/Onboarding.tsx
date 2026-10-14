import { useEffect, useState } from 'react';
import { PageHead, Chip, Priority, Field, Note, MailFrame } from '../components.tsx';
import { navigate, useApp } from '../ctx.tsx';
import { useAsync } from '../hooks.ts';
import { buildPreview } from '../preview.ts';
import type { StudyType } from '../../core/types.ts';
import type { Prefs, UserState } from '../api/types.ts';

export const CONSENT_VERSION = '2026-10-v1';
export const CONSENT_TEXT = 'Acconsento a ricevere ogni lunedì mattina la newsletter scientifica personalizzata all\'indirizzo e-mail del mio account. So che posso revocare il consenso in qualsiasi momento dal link in ogni e-mail o dalle preferenze.';

export const GROUPS: { key: 'icu' | 'anesthesia' | 'cross'; label: string }[] = [
  { key: 'icu', label: 'Terapia intensiva' }, { key: 'anesthesia', label: 'Anestesia' }, { key: 'cross', label: 'Aree trasversali' },
];
export const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
export const STUDY_TYPES: { key: StudyType; label: string }[] = [
  { key: 'guideline', label: 'Linee guida e consensus' }, { key: 'meta_analysis', label: 'Meta-analisi' }, { key: 'systematic_review', label: 'Revisioni sistematiche' },
  { key: 'rct', label: 'Trial randomizzati' }, { key: 'observational', label: 'Studi osservazionali' }, { key: 'review', label: 'Revisioni narrative' },
];

export function TopicPicker({ state, topics, setTopics }: { state: UserState; topics: Record<string, number>; setTopics: (t: Record<string, number>) => void }) {
  const toggle = (id: string) => { const t = { ...topics }; if (t[id]) delete t[id]; else t[id] = 3; setTopics(t); };
  return (<>
    {GROUPS.map((g) => (
      <section key={g.key} aria-labelledby={`g-${g.key}`}>
        <h3 id={`g-${g.key}`}>{g.label}</h3>
        <div className="chips">
          {state.categories.filter((c) => c.group_key === g.key).map((c) => <Chip key={c.id} pressed={!!topics[c.id]} onClick={() => toggle(c.id)}>{c.name_it}</Chip>)}
        </div>
      </section>
    ))}
  </>);
}

export function PriorityList({ state, topics, setTopics }: { state: UserState; topics: Record<string, number>; setTopics: (t: Record<string, number>) => void }) {
  const ids = Object.keys(topics);
  if (!ids.length) return <Note>Non hai ancora scelto argomenti. Torna al passo precedente, oppure prosegui: riceverai solo le evidenze practice-changing e l'articolo fondamentale.</Note>;
  return (
    <ul className="list">
      {state.categories.filter((c) => topics[c.id]).map((c) => (
        <li key={c.id} className="row between">
          <span id={`pl-${c.id}`}>{c.name_it}</span>
          <Priority name={`prio-${c.id}`} value={topics[c.id]!} label={`Priorità per ${c.name_it}`} onChange={(v) => setTopics({ ...topics, [c.id]: v })} />
        </li>
      ))}
    </ul>
  );
}

export function TimeFields({ prefs, setPrefs }: { prefs: Prefs; setPrefs: (p: Prefs) => void }) {
  const num = (v: string, lo: number, hi: number, fallback: number) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback; };
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (<>
    <Field label="Tempo di studio a settimana (minuti)" hint="Include l'articolo fondamentale. Da 15 a 1200.">
      {(p) => <input {...p} type="number" min={15} max={1200} step={15} value={prefs.weekly_minutes} onChange={(e) => setPrefs({ ...prefs, weekly_minutes: num(e.target.value, 15, 1200, 120) })} />}
    </Field>
    <Field label="Numero massimo di letture a settimana" hint="Da 1 a 21.">
      {(p) => <input {...p} type="number" min={1} max={21} value={prefs.max_weekly_reads} onChange={(e) => setPrefs({ ...prefs, max_weekly_reads: num(e.target.value, 1, 21, 6) })} />}
    </Field>
    <fieldset className="field" style={{ border: 0, padding: 0 }}>
      <legend className="label">Giorni liberi o di recupero</legend>
      <p className="hint">Nei giorni selezionati non verranno pianificate letture.</p>
      {DAYS.map((d, i) => (
        <label key={d} className="check"><input type="checkbox" checked={prefs.rest_days.includes(i)} onChange={() => setPrefs({ ...prefs, rest_days: toggle(prefs.rest_days, i).sort() })} />{d}</label>
      ))}
    </fieldset>
    <fieldset className="field" style={{ border: 0, padding: 0 }}>
      <legend className="label">Tipologie di studio preferite</legend>
      <p className="hint">Facoltativo. Se non selezioni nulla, nessuna tipologia è favorita.</p>
      {STUDY_TYPES.map((t) => (
        <label key={t.key} className="check"><input type="checkbox" checked={prefs.study_types.includes(t.key)} onChange={() => setPrefs({ ...prefs, study_types: toggle(prefs.study_types, t.key) })} />{t.label}</label>
      ))}
    </fieldset>
  </>);
}

export function CorePicker({ state, ids, setIds, enabled, setEnabled }: { state: UserState; ids: string[]; setIds: (i: string[]) => void; enabled: boolean; setEnabled: (b: boolean) => void }) {
  const all = ids.length === 0;
  const toggle = (id: string) => {
    const base = all ? state.coreTopics.map((t) => t.id) : ids;
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    setIds(next.length === state.coreTopics.length ? [] : next);
  };
  return (<>
    <label className="check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />Voglio ricevere un articolo fondamentale ogni settimana</label>
    {enabled && (<>
      <p className="hint">Argomenti da approfondire. Se non ne escludi nessuno, il percorso li alterna tutti, dando precedenza a quelli a cui hai dato più priorità.</p>
      <div className="chips">
        {state.coreTopics.map((t) => <Chip key={t.id} pressed={all || ids.includes(t.id)} onClick={() => toggle(t.id)}>{t.title_it}</Chip>)}
      </div>
    </>)}
  </>);
}

export function Onboarding() {
  const { api, state, session, reload, notify, fail } = useApp();
  const [step, setStep] = useState(Math.min(state?.profile.onboarding_step ?? 0, 5) + 1);
  const [topics, setTopics] = useState<Record<string, number>>(state?.topics ?? {});
  const [prefs, setPrefs] = useState<Prefs | null>(state?.prefs ?? null);
  const [coreIds, setCoreIds] = useState<string[]>(state?.coreTopicIds ?? []);
  const [consent, setConsent] = useState(false);
  const [name, setName] = useState(state?.profile.display_name ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (state && !prefs) setPrefs(state.prefs); }, [state, prefs]);
  if (!state || !prefs) return null;

  const live: UserState = { ...state, topics, prefs, coreTopicIds: coreIds };
  const total = 6;

  async function persist(n: number) {
    setBusy(true);
    try {
      if (n === 1) await api.saveName(name);
      if (n === 1 || n === 2) await api.saveTopics(topics);
      if (n === 3) await api.savePrefs(prefs!);
      if (n === 4) { await api.savePrefs(prefs!); await api.saveCoreTopics(coreIds); }
      await api.setOnboarding(n, false);
      await reload();
    } catch (e) { fail(e); throw e; } finally { setBusy(false); }
  }
  async function next() { try { await persist(step); setStep((s) => Math.min(total, s + 1)); } catch { /* notificato */ } }
  async function finish() {
    setBusy(true);
    try {
      if (consent && state!.profile.newsletter_status !== 'active') await api.giveConsent(CONSENT_VERSION);
      await api.setOnboarding(6, true);
      await reload();
      notify(consent ? 'Configurazione completata: riceverai il primo digest lunedì alle 06:00.' : 'Configurazione salvata. La newsletter si attiva quando dai il consenso, dalle preferenze.');
      navigate('/');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  return (
    <div className="prose">
      <PageHead eyebrow={`Passo ${step} di ${total}`} title={['Cosa ti interessa?', 'Quanto è importante ciascun argomento?', 'Quanto tempo vuoi dedicare?', 'Percorso Core Knowledge', 'Conferma e consenso', 'Anteprima della tua newsletter'][step - 1]!} />
      <ol className="steps" aria-hidden="true">{Array.from({ length: total }, (_, i) => <li key={i} data-done={i < step} />)}</ol>

      {step === 1 && (<>
        <Field label="Come vuoi essere chiamato? (facoltativo)" hint="Appare nella newsletter. Puoi lasciarlo vuoto.">{(p) => <input {...p} type="text" maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <p>Seleziona gli argomenti che vuoi seguire. Puoi cambiarli quando vuoi.</p>
        <TopicPicker state={live} topics={topics} setTopics={setTopics} />
      </>)}
      {step === 2 && (<><p>Da 1 (marginale) a 5 (essenziale). Le priorità più alte hanno più peso nella selezione.</p><PriorityList state={live} topics={topics} setTopics={setTopics} /></>)}
      {step === 3 && <TimeFields prefs={prefs} setPrefs={setPrefs} />}
      {step === 4 && <CorePicker state={live} ids={coreIds} setIds={setCoreIds} enabled={prefs.core_enabled} setEnabled={(b) => setPrefs({ ...prefs, core_enabled: b })} />}
      {step === 5 && (<>
        <p>Il digest verrà inviato a <strong>{session?.email}</strong>.</p>
        {session && !session.emailConfirmed ? (
          <Note kind="error">Questo indirizzo non è ancora verificato: senza conferma non riceverai e-mail. <button className="btn quiet small" onClick={() => api.resendConfirmation(session.email).then(() => notify('E-mail di conferma inviata.')).catch(fail)}>Invia di nuovo il link</button></Note>
        ) : <p className="muted">Indirizzo verificato.</p>}
        <label className="check"><input type="checkbox" checked={consent || state.profile.newsletter_status === 'active'} disabled={state.profile.newsletter_status === 'active'} onChange={(e) => setConsent(e.target.checked)} /><span>{CONSENT_TEXT} <a href="#/privacy">Informativa privacy</a></span></label>
        <p className="hint">Senza consenso puoi comunque usare l'applicazione, ma non riceverai e-mail.</p>
      </>)}
      {step === 6 && <PreviewStep state={live} />}

      <div className="row" style={{ marginTop: 20 }}>
        {step > 1 && <button className="btn secondary" onClick={() => setStep(step - 1)} disabled={busy}>Indietro</button>}
        {step < total ? <button className="btn" onClick={next} disabled={busy}>Avanti</button> : <button className="btn" onClick={finish} disabled={busy}>Fine</button>}
        <button className="btn quiet" onClick={() => navigate('/')}>Completa più tardi</button>
      </div>
    </div>
  );
}

function PreviewStep({ state }: { state: UserState }) {
  const { api } = useApp();
  const { data, loading } = useAsync(() => buildPreview(api, state), [state.topics, state.prefs, state.coreTopicIds]);
  if (loading) return <p>Calcolo l'anteprima…</p>;
  if (!data) return <Note kind="error">Impossibile calcolare l'anteprima.</Note>;
  return (<>
    {data.out.empty && <Note>Con le preferenze attuali e le novità disponibili oggi non ci sarebbe nulla da inviare: non aggiungiamo contenuti di riempimento. Prova ad aggiungere argomenti.</Note>}
    <p className="muted small">Così apparirebbe la tua newsletter con le preferenze e le novità di oggi. Non viene inviata.</p>
    <MailFrame html={data.out.html} title="Anteprima della newsletter" />
  </>);
}
