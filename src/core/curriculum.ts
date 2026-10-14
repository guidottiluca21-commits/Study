/** Selezione dell'articolo Core Knowledge per un utente: continuità, prerequisiti, nessuna ripetizione. */
import type { CoreItem, CoreProgressRow, CoreTopic, UserPrefs } from './types.ts';

export type CoreReason = 'new' | 'review' | 'update';

export interface CorePick {
  item: CoreItem;
  topic: CoreTopic;
  reason: CoreReason;
  note: string;
  unmetPrerequisites: string[]; // sempre vuoto per una scelta valida (i prerequisiti sono soddisfatti)
}

export function pickCoreItem(input: {
  topics: CoreTopic[];
  items: CoreItem[];
  progress: CoreProgressRow[];
  prefs: UserPrefs;
  today: string; // YYYY-MM-DD
  topicPriorities?: Record<string, number>; // core_topic_id -> priorità 1..5 (derivata dagli interessi)
}): CorePick | null {
  const { topics, items, progress, prefs, today } = input;
  if (!prefs.core_enabled) return null;

  const topicById = new Map(topics.filter((t) => t.active).map((t) => [t.id, t]));
  const allowed = (id: string) => topicById.has(id) && (prefs.core_topic_ids.length === 0 || prefs.core_topic_ids.includes(id));
  const prog = new Map(progress.map((p) => [p.item_id, p]));
  const usable = (i: CoreItem) => i.active && i.verification === 'verified' && allowed(i.topic_id);
  const byId = new Map(items.map((i) => [i.id, i]));

  const done = (id: string) => {
    const s = prog.get(id)?.status;
    return s === 'completed' || s === 'to_review';
  };

  // 1) ripasso motivato: l'utente ha chiesto di ripassare e la data è arrivata
  const dueReviews = items
    .filter((i) => usable(i) && prog.get(i.id)?.status === 'to_review' && (prog.get(i.id)!.next_review_at ?? '9999') <= today)
    .sort((a, b) => (prog.get(a.id)!.next_review_at ?? '').localeCompare(prog.get(b.id)!.next_review_at ?? '') || a.id.localeCompare(b.id));
  if (dueReviews[0]) {
    const item = dueReviews[0];
    return { item, topic: topicById.get(item.topic_id)!, reason: 'review', note: 'Ripasso richiesto da te: la data di revisione è arrivata.', unmetPrerequisites: [] };
  }

  // 2) aggiornamento: l'utente ha completato un articolo poi superseduto da uno più recente
  for (const old of items) {
    if (!old.superseded_by || !done(old.id)) continue;
    const next = byId.get(old.superseded_by);
    if (next && usable(next) && !prog.has(next.id)) {
      return { item: next, topic: topicById.get(next.topic_id)!, reason: 'update', note: next.update_note ?? `Aggiorna «${old.title}», che avevi già completato.`, unmetPrerequisites: [] };
    }
  }

  // 3) nuovo articolo: prerequisiti soddisfatti, nessun duplicato, equilibrio tra argomenti
  const completedPerTopic = new Map<string, number>();
  for (const i of items) if (done(i.id)) completedPerTopic.set(i.topic_id, (completedPerTopic.get(i.topic_id) ?? 0) + 1);

  const prereqOk = (i: CoreItem) =>
    i.prerequisites.every((pid) => {
      const p = byId.get(pid);
      if (!p || !p.active || p.verification !== 'verified') return true; // non può bloccare il percorso
      return done(pid);
    });

  const candidates = items.filter((i) => {
    if (!usable(i) || prog.has(i.id)) return false;
    // se esiste un successore verificato, si propone quello
    if (i.superseded_by && byId.get(i.superseded_by)?.verification === 'verified') return false;
    return prereqOk(i);
  });
  if (!candidates.length) return null;

  const priority = (i: CoreItem) => {
    const t = topicById.get(i.topic_id)!;
    return input.topicPriorities?.[t.id] ?? (t.category_id ? prefs.topics[t.category_id] : undefined) ?? 3;
  };
  const score = (i: CoreItem) => priority(i) * 10 - (completedPerTopic.get(i.topic_id) ?? 0) * 3 - i.position / 1000;
  candidates.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  const item = candidates[0]!;
  const t = topicById.get(item.topic_id)!;
  return {
    item,
    topic: t,
    reason: 'new',
    note: `Prossimo passo del percorso «${t.title_it}»${(completedPerTopic.get(t.id) ?? 0) ? ` (già completati ${completedPerTopic.get(t.id)})` : ' (primo articolo)'}.`,
    unmetPrerequisites: [],
  };
}
