/**
 * Orchestratore settimanale.
 *
 *  1. ricerca bibliografica CONDIVISA (una query per categoria, non per utente);
 *  2. catalogo: deduplicazione (PMID/DOI), classificazione, punteggio; rinfresco dei record recenti
 *     (tag PubMed e MeSH arrivano in ritardo);
 *  3. per ogni utente attivo: ranking personalizzato, Core Knowledge, piano, newsletter;
 *  4. invio idempotente con quote, retry e log.
 *
 * Modalità `simulate`: l'intera elaborazione avviene in una transazione che viene ANNULLATA;
 * nessuna e-mail reale, nessuno stato utente modificato. Resta solo il registro dell'esecuzione.
 */
import type { Db, Queryable } from './db.ts';
import { PubmedClient } from '../core/pubmed-client.ts';
import { buildCategoryTerm, computeSearchWindow, excludedPubType } from '../core/pubmed.ts';
import { classifyArticle } from '../core/classify.ts';
import { FORMULA_VERSION, scoreImportance } from '../core/scoring.ts';
import { buildIssue } from '../core/issue.ts';
import type { CorePick } from '../core/curriculum.ts';
import { romeParts, weekStartRome } from '../core/schedule.ts';
import { defaultSleep } from '../core/retry.ts';
import type { RankedItem } from '../core/types.ts';
import type { Mailer, MailMessage } from './mailer.ts';
import { MailError } from './mailer.ts';
import * as S from './store.ts';

export interface RunOptions {
  db: Db;
  pubmed: PubmedClient;
  mailer: Mailer;
  config: { siteUrl: string; emailDailyLimit: number; allowlist: string[] };
  now: Date;
  mode: 'live' | 'simulate';
  weekStart?: string;
  sendAt?: Date; // se nel futuro, si attende prima di inviare
  sleep?: (ms: number) => Promise<void>;
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void;
  userIds?: string[];
  githubRunId?: string;
  skipSearch?: boolean;
  candidateWindowDays?: number;
}

export interface Preview { userId: string; email: string; subject: string; empty: boolean; html?: string; text?: string; selected: number; core: string | null; overrides: number }

export interface RunResult {
  runId: string;
  status: 'success' | 'partial' | 'failed';
  weekStart: string;
  stats: Record<string, number | string | boolean | null>;
  previews: Preview[];
  errors: string[];
  warnings: string[];
}

class Rollback<T> extends Error { constructor(public result: T) { super('rollback'); } }

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function runWeekly(o: RunOptions): Promise<RunResult> {
  const log = o.log ?? (() => undefined);
  const live = o.mode === 'live';
  const runId = await S.startRun(o.db, 'weekly', o.mode, o.githubRunId);
  const weekStart = o.weekStart ?? weekStartRome(o.now);
  try {
    let result: Omit<RunResult, 'runId'>;
    if (live) {
      result = await pipeline(o, o.db, (fn) => o.db.tx(fn), weekStart, log);
    } else {
      try {
        await o.db.tx(async (q) => {
          const r = await pipeline(o, q, (fn) => fn(q), weekStart, log);
          throw new Rollback(r);
        });
        throw new Error('unreachable');
      } catch (e) {
        if (e instanceof Rollback) result = e.result as Omit<RunResult, 'runId'>;
        else throw e;
      }
    }
    await S.finishRun(o.db, runId, result.status, { ...result.stats, errors: result.errors.slice(0, 20), warnings: result.warnings.slice(0, 20) });
    return { runId, ...result };
  } catch (e) {
    const msg = (e as Error).message;
    log('error', `Esecuzione fallita: ${msg}`);
    await S.finishRun(o.db, runId, 'failed', {}, msg).catch(() => undefined);
    return { runId, status: 'failed', weekStart, stats: {}, previews: [], errors: [msg], warnings: [] };
  }
}

type TxRunner = <T>(fn: (q: Queryable) => Promise<T>) => Promise<T>;

async function pipeline(o: RunOptions, q: Queryable, tx: TxRunner, weekStart: string, log: NonNullable<RunOptions['log']>): Promise<Omit<RunResult, 'runId'>> {
  const live = o.mode === 'live';
  const now = o.now;
  const sleep = o.sleep ?? defaultSleep;
  const errors: string[] = [];
  const warnings: string[] = [];
  const st: Record<string, number | string | boolean | null> = {
    mode: o.mode, formula_version: FORMULA_VERSION, categories: 0, categories_failed: 0, pubmed_ids: 0, new_articles: 0, refreshed: 0,
    duplicates_doi: 0, skipped_excluded: 0, skipped_no_abstract: 0, users_eligible: 0, issues_created: 0, issues_reused: 0,
    skipped_no_content: 0, user_errors: 0, emails_sent: 0, emails_failed: 0, emails_pending: 0, emails_cancelled: 0, quota_exceeded: false,
    pubmed_requests: 0, pubmed_retries: 0, search_from: null, search_to: null,
  };

  // ---------- 1-2. ricerca condivisa e catalogo -----------------------------------------
  const categories = await S.getActiveCategories(q);
  st.categories = categories.length;
  const lastState = await S.getState<{ last_success_at?: string }>(q, 'weekly_search');
  const win = computeSearchWindow(now, lastState?.last_success_at ? new Date(lastState.last_success_at) : null);
  st.search_from = ymd(win.from);
  st.search_to = ymd(win.to);
  let searchComplete = true;

  if (!o.skipSearch) {
    const hits = new Map<string, Set<string>>();
    for (const c of categories) {
      try {
        const ids = await o.pubmed.search(buildCategoryTerm(c), win, 300);
        for (const id of ids) (hits.get(id) ?? hits.set(id, new Set()).get(id)!).add(c.id);
        log('info', `PubMed «${c.id}»: ${ids.length} risultati`);
      } catch (e) {
        st.categories_failed = (st.categories_failed as number) + 1;
        searchComplete = false;
        warnings.push(`ricerca fallita per la categoria ${c.id}: ${(e as Error).message}`);
      }
    }
    if ((st.categories_failed as number) === categories.length && categories.length > 0) {
      throw new Error('PubMed non raggiungibile: tutte le ricerche sono fallite');
    }
    st.pubmed_ids = hits.size;

    const found = [...hits.keys()];
    const known = await S.knownPmids(q, found);
    const refresh = (await S.pmidsToRefresh(q, now, 60, 200)).filter((p) => !hits.has(p));
    const toFetch = [...new Set([...found, ...refresh])];
    const prevQuery = await S.previousQueryCategories(q, refresh);
    const records = toFetch.length ? await o.pubmed.fetchArticles(toFetch) : [];
    for (const rec of records) {
      if (excludedPubType(rec.pub_types)) { st.skipped_excluded = (st.skipped_excluded as number) + 1; continue; }
      if (!rec.abstract) { st.skipped_no_abstract = (st.skipped_no_abstract as number) + 1; continue; }
      const queryHits = hits.get(rec.pmid) ?? prevQuery.get(rec.pmid) ?? new Set<string>();
      const matches = classifyArticle(rec, categories, queryHits);
      if (!matches.length) { st.skipped_excluded = (st.skipped_excluded as number) + 1; continue; }
      const score = scoreImportance(rec, now);
      const outcome = await S.upsertArticle(q, rec, score, matches, now);
      if (outcome === 'duplicate_doi') st.duplicates_doi = (st.duplicates_doi as number) + 1;
      else if (outcome === 'inserted') st.new_articles = (st.new_articles as number) + 1;
      else if (known.has(rec.pmid) || refresh.includes(rec.pmid)) st.refreshed = (st.refreshed as number) + 1;
    }
    log('info', `Catalogo: ${st.new_articles} nuovi, ${st.refreshed} aggiornati, ${st.duplicates_doi} duplicati per DOI`);
  }
  st.pubmed_requests = o.pubmed.stats.requests;
  st.pubmed_retries = o.pubmed.stats.retries;
  const searchedAt = now;

  // ---------- 3. utenti -----------------------------------------------------------------
  const todayRome = (() => { const p = romeParts(now); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; })();
  if (live) await S.resumeExpiredPauses(q, todayRome);
  let users = await S.loadEligibleUsers(q, todayRome);
  if (o.userIds?.length) users = users.filter((u) => o.userIds!.includes(u.id));
  if (o.config.allowlist.length) {
    const before = users.length;
    users = users.filter((u) => o.config.allowlist.includes(u.email.toLowerCase()));
    warnings.push(`SEND_ALLOWLIST attiva: ${users.length} utenti su ${before} (fase di test: gli altri non ricevono nulla)`);
  }
  st.users_eligible = users.length;

  const candidates = await S.loadCandidates(q, new Date(now.getTime() - (o.candidateWindowDays ?? 21) * 86_400_000), now);
  const curriculum = await S.loadCurriculum(q);
  const catNames = Object.fromEntries(categories.map((c) => [c.id, c.name_it]));
  const previews: Preview[] = [];

  for (const user of users) {
    try {
      if (await S.existingIssue(q, user.id, weekStart)) { st.issues_reused = (st.issues_reused as number) + 1; continue; }
      const prog = await S.loadUserProgress(q, user.id);
      const built = buildIssue({
        weekStart, now, todayRome, userName: user.display_name, prefs: user.prefs, candidates, curriculum,
        alreadyReceived: prog.alreadyReceived, coreProgress: prog.coreProgress, categoryNames: catNames,
        window: { from: ymd(win.from), to: ymd(win.to) }, searchedAt,
        notes: searchComplete ? [] : ['Alcune ricerche per categoria non sono andate a buon fine: la selezione potrebbe essere incompleta.'],
        links: {
          site: o.config.siteUrl, manage: `${o.config.siteUrl}#/preferences`, privacy: `${o.config.siteUrl}#/privacy`,
          unsubscribe: `${o.config.siteUrl}#/unsubscribe/${user.unsubscribe_token}`,
        },
      });
      const { out, recent, core, plan, dayOf } = built;
      if (!recent.length && !core) { st.skipped_no_content = (st.skipped_no_content as number) + 1; continue; }

      const items = buildItems(recent, core, dayOf);
      const created = await tx((t) => S.createIssue(t, {
        userId: user.id, weekStart, subject: out.subject, html: out.html, text: out.text, items, coreReason: core?.reason, now,
        payload: { scoring_version: FORMULA_VERSION, executive_summary: out.executiveSummary, total_minutes: out.totalMinutes, plan: plan.days.map((d) => ({ day: d.day, rest: d.rest, items: d.items })) },
      }));
      if (created.created) st.issues_created = (st.issues_created as number) + 1; else st.issues_reused = (st.issues_reused as number) + 1;
      previews.push({ userId: user.id, email: user.email, subject: out.subject, empty: out.empty, html: live ? undefined : out.html, text: live ? undefined : out.text, selected: recent.length, core: core?.item.id ?? null, overrides: recent.filter((r) => r.override_applied).length });
    } catch (e) {
      st.user_errors = (st.user_errors as number) + 1;
      errors.push(`utente ${user.id}: ${(e as Error).message}`);
      log('error', `Errore sull'utente ${user.id}: ${(e as Error).message}`);
    }
  }

  // ---------- 4. invio -------------------------------------------------------------------
  await sendPending(o, q, weekStart, st, errors, warnings, log, sleep);

  if (live && searchComplete && !o.skipSearch) await S.setState(q, 'weekly_search', { last_success_at: now.toISOString(), window: [st.search_from, st.search_to] });
  if (live) await S.housekeeping(q, now);

  const failed = (st.emails_failed as number) > 0 || (st.user_errors as number) > 0 || st.quota_exceeded === true || !searchComplete;
  return { status: failed ? 'partial' : 'success', weekStart, stats: st, previews, errors, warnings };
}

function buildItems(recent: RankedItem[], core: CorePick | null, dayOf: Map<string, number>): S.IssueItemInput[] {
  const items: S.IssueItemInput[] = [];
  let pos = 1;
  if (core) {
    items.push({ position: pos++, kind: 'core', core_item_id: core.item.id, planned_day: dayOf.get('core') ?? null, minutes: core.item.reading_minutes, reason: core.note, personal: null, importance: null, final: null, override: false });
  }
  for (const r of recent) {
    items.push({
      position: pos++, kind: 'recent', article_id: (r.article as { id?: number }).id ?? null, planned_day: dayOf.get(r.article.pmid) ?? null,
      minutes: r.minutes, reason: r.reason, personal: r.personal_score, importance: r.importance, final: r.final_score, override: r.override_applied,
    });
  }
  return items;
}

function messageFor(siteUrl: string, d: { email: string; subject: string; html: string; text_body: string; unsubscribe_token: string; idempotency_key: string }): MailMessage {
  const host = (() => { try { return new URL(siteUrl).hostname; } catch { return 'localhost'; } })();
  const safe = d.idempotency_key.replace(/[^a-zA-Z0-9.-]/g, '.');
  const unsub = `${siteUrl}#/unsubscribe/${d.unsubscribe_token}`;
  return {
    to: d.email, subject: d.subject, html: d.html, text: d.text_body, messageId: `<digest.${safe}@${host}>`,
    headers: { 'List-Unsubscribe': `<${unsub}>`, 'X-Entity-Ref-ID': d.idempotency_key, 'Auto-Submitted': 'auto-generated' },
  };
}

async function sendPending(
  o: RunOptions, q: Queryable, weekStart: string, st: Record<string, number | string | boolean | null>,
  errors: string[], warnings: string[], log: NonNullable<RunOptions['log']>, sleep: (ms: number) => Promise<void>,
): Promise<void> {
  st.emails_cancelled = await S.cancelDeliveriesOfInactiveUsers(q, weekStart);
  let pending = await S.listPendingDeliveries(q, weekStart);
  if (o.userIds?.length) pending = pending.filter((d) => o.userIds!.includes(d.user_id));
  if (o.config.allowlist.length) pending = pending.filter((d) => o.config.allowlist.includes(d.email.toLowerCase()));
  if (!pending.length) return;

  // attesa fino all'orario di invio (06:00 a Roma), se richiesto
  if (o.sendAt) {
    const wait = o.sendAt.getTime() - Date.now();
    if (o.mode === 'live' && wait > 0) { log('info', `Attendo ${Math.round(wait / 1000)} s fino all'orario di invio`); await sleep(wait); }
  }

  const period = ymd(o.now); // quota giornaliera del provider, in UTC
  let used = await S.getQuotaUsed(q, 'email', period);
  const limit = o.config.emailDailyLimit;
  if (used >= limit * 0.8) warnings.push(`quota e-mail giornaliera all'${Math.round((used / limit) * 100)}% (${used}/${limit})`);

  for (const d of pending) {
    if (used >= limit) {
      st.quota_exceeded = true;
      st.emails_pending = (st.emails_pending as number) + 1;
      continue;
    }
    try {
      const res = await o.mailer.send(messageFor(o.config.siteUrl, d));
      await S.markDeliverySent(q, d, res.providerMessageId, o.now);
      await S.bumpQuota(q, 'email', period, 1);
      used++;
      st.emails_sent = (st.emails_sent as number) + 1;
    } catch (e) {
      const err = e instanceof MailError ? e : new MailError(String((e as Error).message), 'transient');
      if (err.kind === 'quota') {
        st.quota_exceeded = true;
        st.emails_pending = (st.emails_pending as number) + 1;
        warnings.push(`il provider segnala il superamento dei limiti: ${err.message.slice(0, 160)}`);
        used = limit; // si ferma l'invio per oggi
        continue;
      }
      await S.markDeliveryFailed(q, d.id, err.message, err.kind === 'permanent');
      st.emails_failed = (st.emails_failed as number) + 1;
      errors.push(`invio a utente ${d.user_id} fallito (${err.kind}): ${err.message.slice(0, 200)}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Richieste di invio di prova (utenti autorizzati)
// ---------------------------------------------------------------------------------------------
export async function processTestRequests(o: Omit<RunOptions, 'weekStart'>): Promise<{ processed: number; sent: number; failed: number }> {
  const log = o.log ?? (() => undefined);
  const q = o.db;
  const runId = await S.startRun(q, 'requests', o.mode, o.githubRunId);
  const weekStart = weekStartRome(o.now);
  const todayRome = (() => { const p = romeParts(o.now); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; })();
  let processed = 0, sent = 0, failed = 0;
  try {
    const reqs = await q.query<{ id: string; user_id: string }>(`select id, user_id from public.test_requests where status = 'queued' order by requested_at limit 50`);
    if (!reqs.rows.length) { await S.finishRun(q, runId, 'success', { processed: 0 }); return { processed, sent, failed }; }
    const categories = await S.getActiveCategories(q);
    const candidates = await S.loadCandidates(q, new Date(o.now.getTime() - 21 * 86_400_000), o.now);
    const curriculum = await S.loadCurriculum(q);
    const catNames = Object.fromEntries(categories.map((c) => [c.id, c.name_it]));
    const users = await S.loadEligibleUsers(q, todayRome).catch(() => []);
    const period = ymd(o.now);

    for (const r of reqs.rows) {
      processed++;
      const finish = async (status: 'done' | 'failed', result: unknown) => {
        if (o.mode === 'live') await q.query(`update public.test_requests set status=$2, processed_at=now(), result=$3::jsonb where id=$1`, [r.id, status, JSON.stringify(result)]);
      };
      try {
        const auth = await q.query<{ ok: boolean; email: string | null; confirmed: boolean; token: string }>(
          `select (p.test_authorized or p.role = 'admin') and not p.blocked as ok, u.email, u.email_confirmed_at is not null as confirmed, p.unsubscribe_token::text as token
             from public.profiles p join auth.users u on u.id = p.id where p.id = $1`, [r.user_id]);
        const a = auth.rows[0];
        if (!a || !a.ok || !a.email || !a.confirmed) { await finish('failed', { error: 'non autorizzato o indirizzo non verificato' }); failed++; continue; }
        if (o.config.allowlist.length && !o.config.allowlist.includes(a.email.toLowerCase())) { await finish('failed', { error: 'indirizzo non presente in SEND_ALLOWLIST' }); failed++; continue; }
        const key = `${r.user_id}:${weekStart}:test:${todayRome}`;
        const dup = await q.query(`select 1 from public.email_deliveries where idempotency_key = $1 and status = 'sent'`, [key]);
        if (dup.rows[0]) { await finish('done', { skipped: 'e-mail di prova già inviata oggi' }); continue; }
        if (await S.getQuotaUsed(q, 'email', period) >= o.config.emailDailyLimit) { log('warn', 'quota e-mail esaurita: richiesta lasciata in coda'); continue; }

        const u = users.find((x) => x.id === r.user_id);
        const prefs = u?.prefs ?? { topics: {}, study_types: [], max_weekly_reads: 6, weekly_minutes: 120, rest_days: [], core_enabled: true, core_topic_ids: [] };
        const prog = await S.loadUserProgress(q, r.user_id);
        const win = computeSearchWindow(o.now, null);
        const built = buildIssue({
          weekStart, now: o.now, todayRome, userName: null, prefs, candidates, curriculum,
          alreadyReceived: prog.alreadyReceived, coreProgress: prog.coreProgress, categoryNames: catNames,
          window: { from: ymd(win.from), to: ymd(win.to) }, searchedAt: o.now,
          notes: ['E-mail di PROVA: non modifica la tua libreria né il percorso Core Knowledge.'],
          links: { site: o.config.siteUrl, manage: `${o.config.siteUrl}#/preferences`, privacy: `${o.config.siteUrl}#/privacy`, unsubscribe: `${o.config.siteUrl}#/unsubscribe/${a.token}` },
        });
        const { out, recent: testRecent, core } = built;
        const msg = messageFor(o.config.siteUrl, { email: a.email, subject: `[TEST] ${out.subject}`, html: out.html, text_body: out.text, unsubscribe_token: a.token, idempotency_key: key });
        const res = await o.mailer.send(msg);
        if (o.mode === 'live') {
          await q.query(`insert into public.email_deliveries (issue_id, user_id, kind, idempotency_key, status, attempts, provider_message_id, sent_at) values (null,$1,'test',$2,'sent',1,$3,now()) on conflict (idempotency_key) do nothing`, [r.user_id, key, res.providerMessageId ?? null]);
          await S.bumpQuota(q, 'email', period, 1);
        }
        await finish('done', { sent: true, recent: testRecent.length, core: core?.item.id ?? null });
        sent++;
      } catch (e) {
        failed++;
        await finish('failed', { error: (e as Error).message.slice(0, 300) });
      }
    }
    await S.finishRun(q, runId, failed ? 'partial' : 'success', { processed, sent, failed });
  } catch (e) {
    await S.finishRun(q, runId, 'failed', { processed, sent, failed }, (e as Error).message);
    throw e;
  }
  return { processed, sent, failed };
}

