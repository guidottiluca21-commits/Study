import { buildIssue, type BuiltIssue } from '../core/issue.ts';
import { nextWeekStart, nextSendInstant, romeParts } from '../core/schedule.ts';
import type { UserPrefs } from '../core/types.ts';
import type { Api, UserState } from './api/types.ts';

export function toUserPrefs(s: UserState): UserPrefs {
  return {
    topics: s.topics, study_types: s.prefs.study_types, max_weekly_reads: s.prefs.max_weekly_reads, weekly_minutes: s.prefs.weekly_minutes,
    rest_days: s.prefs.rest_days, core_enabled: s.prefs.core_enabled, core_topic_ids: s.coreTopicIds,
  };
}

/** Anteprima calcolata nel browser con lo STESSO codice della pipeline di invio (src/core/issue.ts). */
export async function buildPreview(api: Api, state: UserState, now = new Date()): Promise<BuiltIssue> {
  const [candidates, received] = await Promise.all([api.recentCandidates(21), api.receivedPmids()]);
  const p = romeParts(now);
  return buildIssue({
    weekStart: nextWeekStart(now), now, todayRome: `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`,
    userName: state.profile.display_name, prefs: toUserPrefs(state), candidates,
    curriculum: { topics: state.coreTopics, items: state.coreItems }, alreadyReceived: received, coreProgress: state.coreProgress,
    categoryNames: Object.fromEntries(state.categories.map((c) => [c.id, c.name_it])),
    window: { from: new Date(now.getTime() - 10 * 86_400_000).toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) }, searchedAt: now,
    links: { site: location.origin + location.pathname, manage: '#/preferences', privacy: '#/privacy', unsubscribe: '#/account' },
    preview: true,
  });
}

export const nextSend = (now = new Date()) => nextSendInstant(now);
