import { describe, it, expect } from 'vitest';
import { rankForUser, estimateMinutes } from '../src/core/rank';
import { pickCoreItem } from '../src/core/curriculum';
import { classifyArticle } from '../src/core/classify';
import { scoreImportance } from '../src/core/scoring';
import type { Candidate, CoreItem, CoreTopic, UserPrefs } from '../src/core/types';
import { mk, NOW, BIG_RCT } from './helpers/make';

const prefs = (o: Partial<UserPrefs> = {}): UserPrefs => ({
  topics: {}, study_types: [], max_weekly_reads: 6, weekly_minutes: 120, rest_days: [], core_enabled: true, core_topic_ids: [], ...o,
});
const ctx = (o = {}) => ({ alreadyReceived: new Set<string>(), coreMinutes: 0, coreCount: 0, categoryNames: { sepsis: 'Sepsi', airway: 'Vie aeree', pain: 'Dolore' }, ...o });

function cand(overrides: Partial<ReturnType<typeof mk>>, cats: Record<string, number>): Candidate {
  const article = mk(overrides);
  return {
    article,
    categories: Object.entries(cats).map(([id, s]) => ({ category_id: id, match_score: s, source: 'query' as const })),
    importance: scoreImportance(article, NOW),
  };
}
const rctText = (n: number, outcome = 'mortality') =>
  `METHODS: This multicenter randomized trial (NCT09999999) randomized ${n} patients. The primary outcome was ${outcome}. RESULTS: ${outcome} was lower (hazard ratio 0.9; 95% CI 0.8 to 1.0; P=0.04). CONCLUSIONS: The intervention reduced ${outcome}. ` + 'x'.repeat(250);
const rct = (title: string) => ({ title, study_type: 'rct' as const, study_type_basis: 'pubmed_tag' as const, pub_types: ['Randomized Controlled Trial'], abstract: rctText(900) });

describe('ranking personalizzato', () => {
  const sepsisPaper = cand(rct('Sepsis trial A'), { sepsis: 0.9 });
  const airwayPaper = cand(rct('Airway trial B'), { airway: 0.9 });

  it('due utenti con interessi diversi ricevono selezioni diverse', () => {
    const u1 = rankForUser([sepsisPaper, airwayPaper], prefs({ topics: { sepsis: 5 } }), ctx());
    const u2 = rankForUser([sepsisPaper, airwayPaper], prefs({ topics: { airway: 5 } }), ctx());
    expect(u1.selected.map((s) => s.article.title)).toEqual(['Sepsis trial A']);
    expect(u2.selected.map((s) => s.article.title)).toEqual(['Airway trial B']);
  });

  it('la priorità incide sul punteggio personale e sull\'ordine', () => {
    const hi = rankForUser([sepsisPaper], prefs({ topics: { sepsis: 5 } }), ctx()).selected[0]!;
    const lo = rankForUser([sepsisPaper], prefs({ topics: { sepsis: 2 } }), ctx()).selected[0]!;
    expect(hi.personal_score).toBeGreaterThan(lo.personal_score);
    const both = rankForUser([sepsisPaper, airwayPaper], prefs({ topics: { sepsis: 5, airway: 2 } }), ctx()).selected;
    expect(both[0]!.article.title).toBe('Sepsis trial A');
  });

  it('articoli già ricevuti non vengono riproposti', () => {
    const r = rankForUser([sepsisPaper], prefs({ topics: { sepsis: 5 } }), ctx({ alreadyReceived: new Set([sepsisPaper.article.pmid]) }));
    expect(r.selected).toHaveLength(0);
    expect(r.excluded.already_received).toBe(1);
  });

  it('rispetta il numero massimo di letture e il budget di tempo', () => {
    const many = Array.from({ length: 8 }, (_, i) => cand(rct(`Sepsis trial ${i}`), { sepsis: 0.9 }));
    const cap = rankForUser(many, prefs({ topics: { sepsis: 5 }, max_weekly_reads: 3 }), ctx());
    expect(cap.selected.length).toBeLessThanOrEqual(3);
    const budget = rankForUser(many, prefs({ topics: { sepsis: 5 }, weekly_minutes: 45, max_weekly_reads: 10 }), ctx());
    const minutes = budget.selected.reduce((a, s) => a + s.minutes, 0);
    expect(minutes).toBeLessThanOrEqual(45);
    expect(budget.selected.length).toBe(2); // 2 × 20 min = 40
  });

  it('il numero scelto riguarda le novità: il Core si aggiunge a parte e non c\'è alcun budget di tempo', () => {
    const many = Array.from({ length: 8 }, (_, i) => cand(rct(`Sepsis trial ${i}`), { sepsis: 0.9 }));
    const r = rankForUser(many, prefs({ topics: { sepsis: 5 }, weekly_minutes: 15, max_weekly_reads: 6 }), ctx({ coreMinutes: 60, coreCount: 1 }));
    // con il vecchio budget (15 − 60 minuti) non sarebbe stato selezionato nulla; resta solo il tetto per categoria
    expect(r.selected).toHaveLength(2);
  });

  it('un tetto per categoria evita la monocultura', () => {
    const many = Array.from({ length: 6 }, (_, i) => cand(rct(`Sepsis trial ${i}`), { sepsis: 0.9 }));
    const r = rankForUser(many, prefs({ topics: { sepsis: 5 }, weekly_minutes: 600, max_weekly_reads: 12 }), ctx());
    expect(r.selected).toHaveLength(2);
  });

  it('l\'override include un\'evidenza practice-changing anche su un argomento NON selezionato', () => {
    const big = cand({ ...BIG_RCT, pmid: '5000' }, { sepsis: 0.9 });
    expect(big.importance.override_applied).toBe(true);
    const r = rankForUser([big, airwayPaper], prefs({ topics: { airway: 5 } }), ctx());
    expect(r.selected.map((s) => s.article.pmid)).toContain('5000');
    const o = r.selected.find((s) => s.article.pmid === '5000')!;
    expect(o.override_applied).toBe(true);
    expect(o.override_reasons.length).toBeGreaterThanOrEqual(4);
    expect(o.reason).toMatch(/practice-changing/);
    // senza override lo stesso articolo non verrebbe incluso per questo utente
    const noOverride = cand({ ...BIG_RCT, pmid: '5001', abstract: BIG_RCT.abstract!.replace('NCT01234567', 'a registry') }, { sepsis: 0.9 });
    const r2 = rankForUser([noOverride], prefs({ topics: { airway: 5 } }), ctx());
    expect(r2.selected).toHaveLength(0);
  });

  it('al massimo 2 override per newsletter', () => {
    const bigs = [1, 2, 3].map((i) => cand({ ...BIG_RCT, pmid: String(6000 + i) }, { sepsis: 0.9 }));
    const r = rankForUser(bigs, prefs({ topics: { airway: 5 } }), ctx());
    expect(r.selected.filter((s) => s.override_applied)).toHaveLength(2);
  });

  it('non invia riempitivi: nessun articolo sopra soglia => selezione vuota', () => {
    const weak = cand({ title: 'Weak', study_type: 'other', abstract: 'Short.' }, { sepsis: 0.9 });
    const r = rankForUser([weak], prefs({ topics: { sepsis: 5 } }), ctx());
    expect(r.selected).toHaveLength(0);
    expect(r.notes.join(' ')).toMatch(/Nessun articolo/);
  });

  it('esclusi ritrattati e senza abstract', () => {
    const retr = cand({ ...rct('Retracted'), retracted: true }, { sepsis: 0.9 });
    expect(rankForUser([retr], prefs({ topics: { sepsis: 5 } }), ctx()).selected).toHaveLength(0);
  });

  it('il tipo di studio preferito aumenta il punteggio personale', () => {
    const plain = rankForUser([sepsisPaper], prefs({ topics: { sepsis: 4 } }), ctx()).selected[0]!;
    const pref = rankForUser([sepsisPaper], prefs({ topics: { sepsis: 4 }, study_types: ['rct'] }), ctx()).selected[0]!;
    expect(pref.personal_score).toBeGreaterThan(plain.personal_score);
  });

  it('è deterministico', () => {
    const many = Array.from({ length: 5 }, (_, i) => cand(rct(`Sepsis trial ${i}`), { sepsis: 0.9 }));
    const a = rankForUser(many, prefs({ topics: { sepsis: 5 } }), ctx()).selected.map((s) => s.article.pmid);
    const b = rankForUser([...many].reverse(), prefs({ topics: { sepsis: 5 } }), ctx()).selected.map((s) => s.article.pmid);
    expect(a).toEqual(b);
  });

  it('stima dei minuti per tipo', () => {
    expect(estimateMinutes('guideline')).toBeGreaterThan(estimateMinutes('rct'));
  });
});

describe('classificazione per categoria', () => {
  const cats = [
    { id: 'sepsis', keywords: ['sepsis', 'septic shock'], active: true },
    { id: 'airway', keywords: ['intubation', 'airway management'], active: true },
  ];
  it('combina provenienza dalla query e parole chiave', () => {
    const a = mk({ title: 'Vasopressors in septic shock', abstract: 'Patients with sepsis received norepinephrine.', mesh_terms: ['Shock, Septic'] });
    const m = classifyArticle(a, cats, new Set(['sepsis']));
    expect(m[0]).toMatchObject({ category_id: 'sepsis', source: 'query+keyword' });
    expect(m.find((x) => x.category_id === 'airway')).toBeUndefined();
  });
  it('categorie disattivate sono ignorate', () => {
    const a = mk({ title: 'Sepsis' });
    expect(classifyArticle(a, [{ id: 'sepsis', keywords: ['sepsis'], active: false }], new Set(['sepsis']))).toEqual([]);
  });
});


describe('percorso Core Knowledge', () => {
  const topics: CoreTopic[] = [
    { id: 't-ards', category_id: 'ards', title_it: 'ARDS', title_en: 'ARDS', sort_order: 1, active: true },
    { id: 't-sepsis', category_id: 'sepsis', title_it: 'Sepsi', title_en: 'Sepsis', sort_order: 2, active: true },
  ];
  const item = (id: string, topic: string, position: number, o: Partial<CoreItem> = {}): CoreItem => ({
    id, topic_id: topic, position, pmid: '1', doi: null, title: id, authors: [], journal: 'J', pub_year: 2000, item_type: 'landmark_trial',
    rationale: 'r', prerequisites: [], objectives: ['o'], reading_minutes: 25, verification: 'verified', superseded_by: null, update_note: null, active: true, ...o,
  });
  const items = [
    item('ards-1', 't-ards', 1), item('ards-2', 't-ards', 2, { prerequisites: ['ards-1'] }),
    item('sep-1', 't-sepsis', 1), item('sep-unv', 't-sepsis', 2, { verification: 'unverified' }),
  ];
  const base = { topics, items, today: '2026-10-12' };

  it('sceglie in base alle priorità dell\'utente', () => {
    const p = pickCoreItem({ ...base, progress: [], prefs: prefs({ topics: { sepsis: 5, ards: 2 } }) });
    expect(p!.item.id).toBe('sep-1');
    const q = pickCoreItem({ ...base, progress: [], prefs: prefs({ topics: { sepsis: 2, ards: 5 } }) });
    expect(q!.item.id).toBe('ards-1');
  });

  it('non propone articoli già completati/inviati e rispetta i prerequisiti', () => {
    const p = pickCoreItem({ ...base, progress: [{ item_id: 'ards-1', status: 'sent', next_review_at: null }, { item_id: 'sep-1', status: 'sent', next_review_at: null }], prefs: prefs() });
    // ards-2 richiede ards-1 COMPLETATO (solo "inviato" non basta); sep-unv non è verificato
    expect(p).toBeNull();
    const q = pickCoreItem({ ...base, progress: [{ item_id: 'ards-1', status: 'completed', next_review_at: null }, { item_id: 'sep-1', status: 'completed', next_review_at: null }], prefs: prefs() });
    expect(q!.item.id).toBe('ards-2');
  });

  it('mai articoli non verificati', () => {
    const p = pickCoreItem({ ...base, items: [item('x', 't-ards', 1, { verification: 'mismatch' })], progress: [], prefs: prefs() });
    expect(p).toBeNull();
  });

  it('continuità: l\'avanzamento persiste e alterna gli argomenti', () => {
    const first = pickCoreItem({ ...base, progress: [], prefs: prefs({ topics: { ards: 3, sepsis: 3 } }) })!;
    const progress = [{ item_id: first.item.id, status: 'completed' as const, next_review_at: null }];
    const second = pickCoreItem({ ...base, progress, prefs: prefs({ topics: { ards: 3, sepsis: 3 } }) })!;
    expect(second.item.topic_id).not.toBe(first.item.topic_id);
  });

  it('ripasso motivato solo se richiesto dall\'utente e scaduto', () => {
    const progress = [{ item_id: 'ards-1', status: 'to_review' as const, next_review_at: '2026-10-01' }];
    expect(pickCoreItem({ ...base, progress, prefs: prefs() })!.reason).toBe('review');
    const future = [{ item_id: 'ards-1', status: 'to_review' as const, next_review_at: '2026-12-01' }];
    expect(pickCoreItem({ ...base, progress: future, prefs: prefs() })!.reason).toBe('new');
  });

  it('aggiornamento: propone il successore di un articolo completato e superseduto', () => {
    const its = [item('old', 't-ards', 1, { superseded_by: 'new' }), item('new', 't-ards', 2, { update_note: 'Linea guida aggiornata.' })];
    const p = pickCoreItem({ ...base, items: its, progress: [{ item_id: 'old', status: 'completed', next_review_at: null }], prefs: prefs() })!;
    expect(p.item.id).toBe('new');
    expect(p.reason).toBe('update');
    expect(p.note).toMatch(/aggiornata/);
  });

  it('un articolo superseduto non completato viene sostituito dal successore', () => {
    const its = [item('old', 't-ards', 1, { superseded_by: 'new' }), item('new', 't-ards', 2)];
    expect(pickCoreItem({ ...base, items: its, progress: [], prefs: prefs() })!.item.id).toBe('new');
  });

  it('rispetta la selezione degli argomenti e il flag core_enabled', () => {
    expect(pickCoreItem({ ...base, progress: [], prefs: prefs({ core_topic_ids: ['t-ards'] }) })!.topic.id).toBe('t-ards');
    expect(pickCoreItem({ ...base, progress: [], prefs: prefs({ core_enabled: false }) })).toBeNull();
  });
});
