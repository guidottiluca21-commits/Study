/**
 * Costruzione di una newsletter per un utente (selezione + Core + piano + HTML/testo).
 * Usata IDENTICA dalla pipeline (invio) e dall'interfaccia web (anteprima), così ciò che
 * l'utente vede in anteprima è ciò che riceverebbe con le stesse preferenze e lo stesso catalogo.
 */
import type { Candidate, CoreItem, CoreProgressRow, CoreTopic, RankedItem, UserPrefs } from './types.ts';
import { rankForUser, type RankResult } from './rank.ts';
import { pickCoreItem, type CorePick } from './curriculum.ts';
import { composeNewsletter, type NewsletterOutput } from './newsletter.ts';
import { FORMULA_VERSION } from './scoring.ts';

export interface IssueContext {
  weekStart: string;
  now: Date;
  todayRome: string; // YYYY-MM-DD
  userName?: string | null;
  prefs: UserPrefs;
  candidates: Candidate[];
  curriculum: { topics: CoreTopic[]; items: CoreItem[] };
  alreadyReceived: ReadonlySet<string>;
  coreProgress: CoreProgressRow[];
  categoryNames: Record<string, string>;
  window: { from: string; to: string };
  searchedAt: Date;
  links: { site: string; unsubscribe: string; manage: string; privacy: string };
  notes?: string[];
  preview?: boolean; // anteprima: i testi lo dichiarano
}

export interface BuiltIssue {
  out: NewsletterOutput;
  recent: RankedItem[];
  core: CorePick | null;
  ranking: RankResult;
}

export function buildIssue(ctx: IssueContext): BuiltIssue {
  const core = pickCoreItem({ topics: ctx.curriculum.topics, items: ctx.curriculum.items, progress: ctx.coreProgress, prefs: ctx.prefs, today: ctx.todayRome });
  const ranking = rankForUser(ctx.candidates, ctx.prefs, {
    alreadyReceived: ctx.alreadyReceived, coreMinutes: core?.item.reading_minutes ?? 0, coreCount: core ? 1 : 0, categoryNames: ctx.categoryNames,
  });
  const recent = ranking.selected;
  const prereqTitles = core
    ? (core.item.prerequisites.map((id) => ctx.curriculum.items.find((i) => i.id === id)?.title).filter(Boolean) as string[])
    : [];
  const out = composeNewsletter({
    weekStart: ctx.weekStart, userName: ctx.userName, recent,
    core: core ? { pick: core, topicTitle: core.topic.title_it, prerequisiteTitles: prereqTitles } : null,
    transparency: {
      searchedAt: ctx.searchedAt, windowFrom: ctx.window.from, windowTo: ctx.window.to, overlapDays: 3,
      candidatesConsidered: ranking.considered, alreadyReceived: ranking.excluded.already_received, belowThreshold: ranking.excluded.below_threshold,
      notes: [...(ctx.preview ? ['ANTEPRIMA: calcolata ora con le tue preferenze attuali e il catalogo disponibile; non viene inviata né salvata.'] : []), ...ranking.notes, ...(ctx.notes ?? [])],
      scoringVersion: FORMULA_VERSION,
    },
    categoryNames: ctx.categoryNames, links: ctx.links, now: ctx.now,
  });
  return { out, recent, core, ranking };
}
