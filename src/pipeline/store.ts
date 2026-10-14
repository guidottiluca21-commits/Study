/** Accesso ai dati della pipeline (SQL identico su Postgres reale e PGlite). */
import type { Queryable } from './db.ts';
import type { ArticleRecord, Candidate, Category, CategoryMatch, CoreItem, CoreProgressRow, CoreTopic, ImportanceResult, UserPrefs } from '../core/types.ts';
import { scoreImportance } from '../core/scoring.ts';

// ---------- categorie, stato di ricerca ---------------------------------------------------
export async function getActiveCategories(q: Queryable): Promise<Category[]> {
  const r = await q.query<Category>(`select id, group_key, name_it, name_en, description, pubmed_query, keywords, sort_order, active from public.categories where active order by sort_order, id`);
  return r.rows;
}

export async function getState<T = any>(q: Queryable, key: string): Promise<T | null> {
  const r = await q.query<{ value: T }>(`select value from public.search_state where key = $1`, [key]);
  return r.rows[0]?.value ?? null;
}
export async function setState(q: Queryable, key: string, value: unknown): Promise<void> {
  await q.query(
    `insert into public.search_state (key, value) values ($1, $2::jsonb)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

// ---------- articoli ----------------------------------------------------------------------
export async function knownPmids(q: Queryable, pmids: string[]): Promise<Set<string>> {
  if (!pmids.length) return new Set();
  const r = await q.query<{ pmid: string }>(`select pmid from public.articles where pmid = any($1::text[])`, [pmids]);
  return new Set(r.rows.map((x) => x.pmid));
}

export async function pmidsToRefresh(q: Queryable, now: Date, days: number, limit: number): Promise<string[]> {
  const r = await q.query<{ pmid: string }>(
    `select pmid from public.articles where acquired_at > $1::timestamptz order by refreshed_at asc limit $2`,
    [new Date(now.getTime() - days * 86_400_000).toISOString(), limit],
  );
  return r.rows.map((x) => x.pmid);
}

export async function previousQueryCategories(q: Queryable, pmids: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (!pmids.length) return out;
  const r = await q.query<{ pmid: string; category_id: string }>(
    `select a.pmid, ac.category_id from public.article_categories ac join public.articles a on a.id = ac.article_id
      where a.pmid = any($1::text[]) and ac.source in ('query','query+keyword')`, [pmids]);
  for (const row of r.rows) (out.get(row.pmid) ?? out.set(row.pmid, new Set()).get(row.pmid)!).add(row.category_id);
  return out;
}

export type UpsertOutcome = 'inserted' | 'updated' | 'duplicate_doi';

export async function upsertArticle(q: Queryable, a: ArticleRecord, score: ImportanceResult, matches: CategoryMatch[], now: Date): Promise<UpsertOutcome> {
  // deduplicazione per DOI: stesso DOI con PMID diverso => si tiene il primo
  if (a.doi) {
    const d = await q.query<{ pmid: string }>(`select pmid from public.articles where doi = $1`, [a.doi]);
    if (d.rows[0] && d.rows[0].pmid !== a.pmid) return 'duplicate_doi';
  }
  const ex = await q.query<{ id: number }>(`select id from public.articles where pmid = $1`, [a.pmid]);
  let id: number;
  let outcome: UpsertOutcome;
  if (ex.rows[0]) {
    id = ex.rows[0].id;
    outcome = 'updated';
    await q.query(
      `update public.articles set doi=$2, title=$3, authors=$4, journal=$5, pub_date=$6, pub_date_text=$7, entrez_date=$8, abstract=$9,
              mesh_terms=$10, pub_types=$11, study_type=$12, study_type_basis=$13, retracted=$14, refreshed_at=$15 where id=$1`,
      [id, a.doi, a.title, a.authors, a.journal, a.pub_date, a.pub_date_text, a.entrez_date, a.abstract, a.mesh_terms, a.pub_types, a.study_type, a.study_type_basis, a.retracted, now.toISOString()],
    );
  } else {
    outcome = 'inserted';
    const ins = await q.query<{ id: number }>(
      `insert into public.articles (pmid, doi, title, authors, journal, pub_date, pub_date_text, entrez_date, abstract, mesh_terms, pub_types,
                                    study_type, study_type_basis, retracted, acquired_at, refreshed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) returning id`,
      [a.pmid, a.doi, a.title, a.authors, a.journal, a.pub_date, a.pub_date_text, a.entrez_date, a.abstract, a.mesh_terms, a.pub_types, a.study_type, a.study_type_basis, a.retracted, now.toISOString()],
    );
    id = ins.rows[0]!.id;
  }
  await q.query(`delete from public.article_categories where article_id = $1`, [id]);
  for (const m of matches) {
    await q.query(`insert into public.article_categories (article_id, category_id, match_score, source) values ($1,$2,$3,$4)`, [id, m.category_id, m.match_score, m.source]);
  }
  const { components, ...rest } = score;
  const meta = { limitations: rest.limitations, discordance_hint: rest.discordance_hint, uncertainty_reasons: rest.uncertainty_reasons, sample_size: rest.sample_size, excluded_reason: rest.excluded_reason };
  await q.query(
    `insert into public.article_scores (article_id, formula_version, scored_at, importance, components, uncertainty, override_applied, override_reasons)
     values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb)
     on conflict (article_id) do update set formula_version=excluded.formula_version, scored_at=excluded.scored_at, importance=excluded.importance,
       components=excluded.components, uncertainty=excluded.uncertainty, override_applied=excluded.override_applied, override_reasons=excluded.override_reasons`,
    [id, score.formula_version, now.toISOString(), score.importance, JSON.stringify({ ...components, _meta: meta }), score.uncertainty, score.override_applied, JSON.stringify(score.override_reasons)],
  );
  return outcome;
}

/** Candidati per il ranking: articoli recenti del catalogo, con categorie; l'importanza è ricalcolata con la data odierna. */
export async function loadCandidates(q: Queryable, since: Date, now: Date): Promise<Candidate[]> {
  const r = await q.query<any>(
    `select a.id, a.pmid, a.doi, a.title, a.authors, a.journal, a.pub_date::text as pub_date, a.pub_date_text, a.entrez_date::text as entrez_date,
            a.abstract, a.mesh_terms, a.pub_types, a.study_type, a.study_type_basis, a.retracted,
            coalesce((select json_agg(json_build_object('category_id', ac.category_id, 'match_score', ac.match_score, 'source', ac.source))
                        from public.article_categories ac where ac.article_id = a.id), '[]'::json) as cats
       from public.articles a
      where not a.retracted and coalesce(a.entrez_date, a.acquired_at::date) >= $1::date
      order by a.id`,
    [since.toISOString().slice(0, 10)],
  );
  return r.rows.map((row) => {
    const article = { ...row, id: Number(row.id) } as ArticleRecord & { id: number };
    delete (article as any).cats;
    const cats: CategoryMatch[] = (typeof row.cats === 'string' ? JSON.parse(row.cats) : row.cats).map((c: any) => ({ ...c, match_score: Number(c.match_score) }));
    return { article, categories: cats, importance: scoreImportance(article, now) };
  });
}

// ---------- utenti ------------------------------------------------------------------------
export interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  unsubscribe_token: string;
  prefs: UserPrefs;
}

export async function loadEligibleUsers(q: Queryable, today: string): Promise<UserRow[]> {
  const r = await q.query<any>(
    `select p.id, u.email, p.display_name, p.unsubscribe_token::text as unsubscribe_token,
            pr.max_weekly_reads, pr.weekly_minutes, pr.study_types, pr.rest_days, pr.core_enabled,
            coalesce((select jsonb_object_agg(t.category_id, t.priority) from public.user_topics t where t.user_id = p.id), '{}'::jsonb) as topics,
            coalesce((select array_agg(c.topic_id) from public.user_core_topics c where c.user_id = p.id), '{}'::text[]) as core_topic_ids
       from public.profiles p
       join auth.users u on u.id = p.id
       join public.preferences pr on pr.user_id = p.id
      where not p.blocked and u.email is not null and u.email_confirmed_at is not null
        and (p.newsletter_status = 'active'
             or (p.newsletter_status = 'paused' and p.paused_until is not null and p.paused_until <= $1::date))
      order by p.created_at, p.id`,
    [today],
  );
  return r.rows.map((x) => ({
    id: x.id, email: x.email, display_name: x.display_name, unsubscribe_token: x.unsubscribe_token,
    prefs: {
      topics: Object.fromEntries(Object.entries(typeof x.topics === 'string' ? JSON.parse(x.topics) : x.topics).map(([k, v]) => [k, Number(v)])),
      study_types: x.study_types, max_weekly_reads: Number(x.max_weekly_reads), weekly_minutes: Number(x.weekly_minutes),
      rest_days: (x.rest_days as unknown[]).map(Number), core_enabled: x.core_enabled, core_topic_ids: x.core_topic_ids,
    },
  }));
}

export async function resumeExpiredPauses(q: Queryable, today: string): Promise<number> {
  const r = await q.query<{ id: string }>(
    `update public.profiles set newsletter_status = 'active', paused_until = null
      where newsletter_status = 'paused' and paused_until is not null and paused_until <= $1::date returning id`, [today]);
  for (const row of r.rows) await q.query(`insert into public.consent_log (user_id, event, meta) values ($1,'resume','{"auto":true}'::jsonb)`, [row.id]);
  return r.rowCount;
}

export async function loadUserProgress(q: Queryable, userId: string): Promise<{ alreadyReceived: Set<string>; coreProgress: CoreProgressRow[] }> {
  const a = await q.query<{ pmid: string }>(`select a.pmid from public.user_articles ua join public.articles a on a.id = ua.article_id where ua.user_id = $1`, [userId]);
  const c = await q.query<any>(`select item_id, status, next_review_at::text as next_review_at from public.user_core_progress where user_id = $1`, [userId]);
  return { alreadyReceived: new Set(a.rows.map((x) => x.pmid)), coreProgress: c.rows };
}

export async function loadCurriculum(q: Queryable): Promise<{ topics: CoreTopic[]; items: CoreItem[] }> {
  const t = await q.query<CoreTopic>(`select id, category_id, title_it, title_en, sort_order, active from public.core_topics`);
  const i = await q.query<any>(`select id, topic_id, position, pmid, doi, title, authors, journal, pub_year, item_type, rationale, prerequisites, objectives, reading_minutes, verification, superseded_by, update_note, active from public.core_items`);
  return { topics: t.rows, items: i.rows.map((x) => ({ ...x, position: Number(x.position), reading_minutes: Number(x.reading_minutes), pub_year: x.pub_year == null ? null : Number(x.pub_year) })) };
}

export async function existingIssue(q: Queryable, userId: string, weekStart: string): Promise<string | null> {
  const r = await q.query<{ id: string }>(`select id from public.newsletter_issues where user_id = $1 and week_start = $2::date`, [userId, weekStart]);
  return r.rows[0]?.id ?? null;
}

// ---------- creazione newsletter + invio (idempotenti) -----------------------------------
export interface IssueItemInput {
  position: number; kind: 'recent' | 'core'; article_id?: number | null; core_item_id?: string | null; planned_day: number | null; minutes: number;
  reason: string; personal: number | null; importance: number | null; final: number | null; override: boolean;
}

export async function createIssue(
  q: Queryable,
  p: { userId: string; weekStart: string; subject: string; html: string; text: string; payload: unknown; items: IssueItemInput[]; coreReason?: 'new' | 'review' | 'update'; now: Date },
): Promise<{ created: boolean; issueId: string }> {
  const ins = await q.query<{ id: string }>(
    `insert into public.newsletter_issues (user_id, week_start, subject, html, text_body, language, payload)
     values ($1, $2::date, $3, $4, $5, 'it', $6::jsonb) on conflict (user_id, week_start) do nothing returning id`,
    [p.userId, p.weekStart, p.subject, p.html, p.text, JSON.stringify(p.payload)],
  );
  if (!ins.rows[0]) {
    const id = await existingIssue(q, p.userId, p.weekStart);
    return { created: false, issueId: id! };
  }
  const issueId = ins.rows[0].id;
  for (const it of p.items) {
    await q.query(
      `insert into public.newsletter_items (issue_id, position, kind, article_id, core_item_id, planned_day, minutes, reason, personal_score, importance, final_score, override_applied)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [issueId, it.position, it.kind, it.article_id ?? null, it.core_item_id ?? null, it.planned_day, it.minutes, it.reason, it.personal, it.importance, it.final, it.override],
    );
    if (it.kind === 'recent' && it.article_id) {
      await q.query(`insert into public.user_articles (user_id, article_id, status, received_at) values ($1,$2,'received',$3) on conflict (user_id, article_id) do nothing`, [p.userId, it.article_id, p.now.toISOString()]);
    }
    if (it.kind === 'core' && it.core_item_id) {
      if (p.coreReason === 'review') {
        await q.query(`update public.user_core_progress set status='sent', sent_at=$3, next_review_at=null, review_count=review_count+1, updated_at=now() where user_id=$1 and item_id=$2`, [p.userId, it.core_item_id, p.now.toISOString()]);
      } else {
        await q.query(`insert into public.user_core_progress (user_id, item_id, status, sent_at) values ($1,$2,'sent',$3) on conflict (user_id, item_id) do nothing`, [p.userId, it.core_item_id, p.now.toISOString()]);
      }
    }
  }
  await q.query(
    `insert into public.email_deliveries (issue_id, user_id, kind, idempotency_key, status) values ($1,$2,'newsletter',$3,'pending') on conflict (idempotency_key) do nothing`,
    [issueId, p.userId, `${p.userId}:${p.weekStart}:newsletter`],
  );
  return { created: true, issueId };
}

export interface PendingDelivery {
  id: string; issue_id: string; user_id: string; email: string; unsubscribe_token: string; subject: string; html: string; text_body: string;
  attempts: number; idempotency_key: string; week_start: string;
}

export const MAX_ATTEMPTS = 5;

/** Annulla gli invii in coda degli utenti che nel frattempo si sono disiscritti, hanno messo in pausa o sono bloccati. */
export async function cancelDeliveriesOfInactiveUsers(q: Queryable, weekStart: string): Promise<number> {
  const r = await q.query(
    `update public.email_deliveries d set status = 'failed', attempts = $2, last_error = 'annullato: utente non più iscritto o bloccato', updated_at = now()
      from public.newsletter_issues i, public.profiles p
     where d.issue_id = i.id and i.week_start = $1::date and p.id = d.user_id and d.status in ('pending','failed') and d.kind = 'newsletter'
       and (p.blocked or p.newsletter_status <> 'active')`,
    [weekStart, MAX_ATTEMPTS + 1],
  );
  return r.rowCount;
}

export async function listPendingDeliveries(q: Queryable, weekStart: string): Promise<PendingDelivery[]> {
  const r = await q.query<any>(
    `select d.id, d.issue_id, d.user_id, u.email, p.unsubscribe_token::text as unsubscribe_token, i.subject, i.html, i.text_body, d.attempts, d.idempotency_key, i.week_start::text as week_start
       from public.email_deliveries d
       join public.newsletter_issues i on i.id = d.issue_id
       join public.profiles p on p.id = d.user_id
       join auth.users u on u.id = d.user_id
      where d.kind = 'newsletter' and d.status in ('pending','failed') and d.attempts < $2 and i.week_start = $1::date
      order by d.created_at, d.id`,
    [weekStart, MAX_ATTEMPTS],
  );
  return r.rows.map((x) => ({ ...x, attempts: Number(x.attempts) }));
}

export async function markDeliverySent(q: Queryable, d: { id: string; issue_id: string | null }, providerMessageId: string | undefined, now: Date): Promise<void> {
  await q.query(`update public.email_deliveries set status='sent', attempts=attempts+1, provider_message_id=$2, sent_at=$3, last_error=null, updated_at=now() where id=$1`, [d.id, providerMessageId ?? null, now.toISOString()]);
  if (d.issue_id) await q.query(`update public.newsletter_issues set status='sent', sent_at=$2 where id=$1`, [d.issue_id, now.toISOString()]);
}
export async function markDeliveryFailed(q: Queryable, id: string, error: string, permanent: boolean): Promise<void> {
  await q.query(
    `update public.email_deliveries set status='failed', attempts = case when $3 then $4 else attempts+1 end, last_error=$2, updated_at=now() where id=$1`,
    [id, error.slice(0, 500), permanent, MAX_ATTEMPTS],
  );
}

// ---------- quote e log ------------------------------------------------------------------
export async function getQuotaUsed(q: Queryable, provider: string, period: string): Promise<number> {
  const r = await q.query<{ used: number }>(`select used from public.quota_usage where provider=$1 and period_key=$2`, [provider, period]);
  return Number(r.rows[0]?.used ?? 0);
}
export async function bumpQuota(q: Queryable, provider: string, period: string, n = 1): Promise<void> {
  await q.query(`insert into public.quota_usage (provider, period_key, used) values ($1,$2,$3) on conflict (provider, period_key) do update set used = public.quota_usage.used + $3`, [provider, period, n]);
}

export async function startRun(q: Queryable, kind: 'weekly' | 'search' | 'requests', mode: 'live' | 'simulate', githubRunId?: string): Promise<string> {
  const r = await q.query<{ id: string }>(`insert into public.automation_runs (kind, mode, github_run_id) values ($1,$2,$3) returning id`, [kind, mode, githubRunId ?? null]);
  return r.rows[0]!.id;
}
export async function finishRun(q: Queryable, id: string, status: 'success' | 'partial' | 'failed', stats: unknown, error?: string): Promise<void> {
  await q.query(`update public.automation_runs set status=$2, finished_at=now(), stats=$3::jsonb, error=$4 where id=$1`, [id, status, JSON.stringify(stats), error?.slice(0, 1000) ?? null]);
}

export async function housekeeping(q: Queryable, now: Date): Promise<void> {
  await q.query(`delete from public.rate_events where at < $1::timestamptz`, [new Date(now.getTime() - 7 * 86_400_000).toISOString()]);
  await q.query(`delete from public.quota_usage where period_key < $1`, [new Date(now.getTime() - 40 * 86_400_000).toISOString().slice(0, 10)]);
  await q.query(`delete from public.automation_runs where id in (select id from public.automation_runs order by started_at desc offset 300)`);
}
