import { useState } from 'react';
import { PageHead, Note } from '../components.tsx';
import { useApp } from '../ctx.tsx';
import { CorePicker, PriorityList, TimeFields, TopicPicker } from './Onboarding.tsx';
import type { Prefs } from '../api/types.ts';

export function Preferences() {
  const { api, state, reload, notify, fail } = useApp();
  const [topics, setTopics] = useState<Record<string, number>>(state?.topics ?? {});
  const [prefs, setPrefs] = useState<Prefs | null>(state?.prefs ?? null);
  const [coreIds, setCoreIds] = useState<string[]>(state?.coreTopicIds ?? []);
  const [busy, setBusy] = useState(false);
  if (!state || !prefs) return null;
  const live = { ...state, topics, prefs, coreTopicIds: coreIds };

  async function save() {
    setBusy(true);
    try {
      await api.saveTopics(topics); await api.savePrefs(prefs!); await api.saveCoreTopics(coreIds);
      await reload(); notify('Preferenze salvate. Valgono dalla prossima newsletter.');
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  return (
    <div className="prose">
      <PageHead eyebrow="Personalizzazione" title="Preferenze">Le tue scelte riguardano solo il tuo digest.</PageHead>
      <section className="section" aria-labelledby="p-topics"><h2 id="p-topics">Argomenti</h2><TopicPicker state={live} topics={topics} setTopics={setTopics} /></section>
      <section className="section" aria-labelledby="p-prio"><h2 id="p-prio">Priorità</h2><PriorityList state={live} topics={topics} setTopics={setTopics} /></section>
      <section className="section" aria-labelledby="p-time"><h2 id="p-time">Numero di letture</h2><TimeFields prefs={prefs} setPrefs={setPrefs} /></section>
      <section className="section" aria-labelledby="p-core"><h2 id="p-core">Core Knowledge</h2><CorePicker state={live} ids={coreIds} setIds={setCoreIds} enabled={prefs.core_enabled} setEnabled={(b) => setPrefs({ ...prefs, core_enabled: b })} /></section>
      <Note>Per sospendere gli invii, annullare l'iscrizione, cambiare e-mail, esportare o eliminare i tuoi dati vai a <a href="#/account">Account</a>.</Note>
      <div className="row savebar"><button className="btn" onClick={save} disabled={busy}>{busy ? 'Salvo…' : 'Salva le preferenze'}</button><a className="btn secondary" href="#/preview">Vedi l'anteprima</a></div>
    </div>
  );
}
