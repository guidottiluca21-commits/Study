/**
 * Ranking personalizzato: combina RILEVANZA PERSONALE (priorità scelte dall'utente) e
 * IMPORTANZA SCIENTIFICA (scoring.ts), con override per gli studi potenzialmente
 * practice-changing. Punteggi indicativi, non validati scientificamente (docs/PUNTEGGIO.md).
 */
import type { Candidate, RankedItem, StudyType, UserPrefs } from './types.ts';
import { STUDY_TYPE_LABEL_IT } from './types.ts';

export const RANK_CONFIG = {
  weightPersonal: 0.5,
  weightImportance: 0.5,
  minImportance: 35,
  minPersonal: 30,
  /** peso della priorità scelta dall'utente (1..5) */
  priorityWeight: { 1: 0.3, 2: 0.5, 3: 0.7, 4: 0.85, 5: 1 } as Record<number, number>,
  studyTypeBonus: 10,
  studyTypeMismatch: -5,
  perCategoryCap: 2,
  maxOverrides: 2,
  recentCap: 12,
  /** tempo di lettura stimato per tipo di studio (minuti): euristica, modificabile */
  minutesByType: {
    guideline: 40, meta_analysis: 25, systematic_review: 25, rct: 20, observational: 15, review: 20, other: 10,
  } as Record<StudyType, number>,
};

export function estimateMinutes(type: StudyType): number {
  return RANK_CONFIG.minutesByType[type];
}

export interface RankContext {
  /** PMID già ricevuti da questo utente (mai riproposti) */
  alreadyReceived: ReadonlySet<string>;
  coreMinutes: number;
  coreCount: number;
  categoryNames: Record<string, string>;
}

export interface RankResult {
  selected: RankedItem[];
  considered: number;
  excluded: { already_received: number; not_eligible: number; below_threshold: number; budget_or_cap: number };
  notes: string[];
}

function personalScore(c: Candidate, prefs: UserPrefs): { score: number; primary: string | null } {
  let best = 0;
  let primary: string | null = null;
  for (const m of c.categories) {
    const p = prefs.topics[m.category_id];
    if (!p) continue;
    const s = (RANK_CONFIG.priorityWeight[p] ?? 0.7) * m.match_score * 100;
    if (s > best) { best = s; primary = m.category_id; }
  }
  if (!primary) primary = c.categories[0]?.category_id ?? null;
  if (best > 0 && prefs.study_types.length) {
    best += prefs.study_types.includes(c.article.study_type) ? RANK_CONFIG.studyTypeBonus : RANK_CONFIG.studyTypeMismatch;
  }
  return { score: Math.max(0, Math.min(100, best)), primary };
}

export function rankForUser(cands: Candidate[], prefs: UserPrefs, ctx: RankContext): RankResult {
  const C = RANK_CONFIG;
  const excluded = { already_received: 0, not_eligible: 0, below_threshold: 0, budget_or_cap: 0 };
  const notes: string[] = [];

  type Scored = { c: Candidate; personal: number; primary: string | null; final: number; override: boolean };
  const pool: Scored[] = [];
  for (const c of cands) {
    if (ctx.alreadyReceived.has(c.article.pmid)) { excluded.already_received++; continue; }
    if (c.article.retracted || c.importance.excluded_reason) { excluded.not_eligible++; continue; }
    const { score, primary } = personalScore(c, prefs);
    const final = C.weightPersonal * score + C.weightImportance * c.importance.importance;
    const isOverride = c.importance.override_applied && c.importance.importance >= C.minImportance;
    if (!isOverride && (score < C.minPersonal || c.importance.importance < C.minImportance)) { excluded.below_threshold++; continue; }
    pool.push({ c, personal: Math.round(score * 10) / 10, primary, final: Math.round(final * 10) / 10, override: isOverride });
  }

  // ordine deterministico: override (per importanza), poi per punteggio finale
  const cmp = (a: Scored, b: Scored) =>
    b.final - a.final || b.c.importance.importance - a.c.importance.importance || a.c.article.pmid.localeCompare(b.c.article.pmid);
  const overrides = pool.filter((s) => s.override).sort((a, b) => b.c.importance.importance - a.c.importance.importance || cmp(a, b));
  const topOverrides = overrides.slice(0, C.maxOverrides);
  const overflowOverrides = new Set(overrides.slice(C.maxOverrides).map((s) => s.c.article.pmid));
  const rest = pool.filter((s) => !topOverrides.includes(s)).sort(cmp);
  // gli override in eccesso competono come articoli normali, ma solo se superano le soglie personali
  const ordered = [
    ...topOverrides,
    ...rest.filter((s) => !overflowOverrides.has(s.c.article.pmid) || s.personal >= C.minPersonal),
  ];

  const limit = Math.max(0, Math.min(prefs.max_weekly_reads - ctx.coreCount, C.recentCap));
  let budget = Math.max(0, prefs.weekly_minutes - ctx.coreMinutes);
  const perCat = new Map<string, number>();
  const selected: RankedItem[] = [];

  for (const s of ordered) {
    if (selected.length >= limit) { excluded.budget_or_cap++; continue; }
    const minutes = estimateMinutes(s.c.article.study_type);
    if (minutes > budget) { excluded.budget_or_cap++; continue; }
    const cat = s.primary ?? '_';
    if (!s.override && (perCat.get(cat) ?? 0) >= C.perCategoryCap) { excluded.budget_or_cap++; continue; }
    perCat.set(cat, (perCat.get(cat) ?? 0) + 1);
    budget -= minutes;
    selected.push({
      article: s.c.article,
      primary_category: s.primary,
      personal_score: s.personal,
      importance: s.c.importance.importance,
      final_score: s.final,
      override_applied: s.override,
      override_reasons: s.c.importance.override_reasons,
      reason: buildReason(s, prefs, ctx),
      minutes,
      uncertainty: s.c.importance.uncertainty,
      limitations: s.c.importance.limitations,
      discordance_hint: s.c.importance.discordance_hint,
      sample_size: s.c.importance.sample_size,
    });
  }

  if (!selected.length) notes.push('Nessun articolo recente ha superato le soglie di rilevanza e importanza per le tue preferenze.');
  return { selected, considered: cands.length, excluded, notes };
}

function buildReason(s: { c: Candidate; personal: number; primary: string | null; override: boolean }, prefs: UserPrefs, ctx: RankContext): string {
  const catName = s.primary ? ctx.categoryNames[s.primary] ?? s.primary : null;
  const type = STUDY_TYPE_LABEL_IT[s.c.article.study_type].toLowerCase();
  if (s.override) {
    return `Evidenza potenzialmente practice-changing, proposta indipendentemente dalle tue priorità (criteri verificabili elencati sotto). Argomento: ${catName ?? 'n/d'}; ${type}.`;
  }
  const p = s.primary ? prefs.topics[s.primary] : undefined;
  const parts: string[] = [];
  if (catName && p) parts.push(`Argomento «${catName}» (tua priorità ${p}/5)`);
  parts.push(type);
  parts.push(`importanza scientifica stimata ${s.c.importance.importance}/100`);
  return parts.join('; ') + '.';
}
