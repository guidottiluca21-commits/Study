import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, newUser } from './helpers/db';
import { FakePubmed } from './helpers/fake-pubmed';
import { startSink } from './helpers/smtp-sink';
import { mk } from './helpers/make';
import { pgliteDb, type Db } from '../src/pipeline/db';
import { seedCatalog } from '../src/pipeline/seed';
import { PubmedClient } from '../src/core/pubmed-client';
import { smtpMailer, simulateMailer, type Mailer } from '../src/pipeline/mailer';
import { processTestRequests, runWeekly, type RunOptions } from '../src/pipeline/run';

const cats = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', 'categories.json'), 'utf8')) as { id: string; pubmed_query: string }[];
const Q = (id: string) => cats.find((c) => c.id === id)!.pubmed_query;
const NOW = new Date('2026-10-12T04:00:00Z'); // lunedì 06:00 a Roma
const SITE = 'https://example.github.io/study/';
const nosleep = async () => undefined;

const PAD = ' The trial was conducted according to the protocol and reported following CONSORT recommendations. Outcomes were assessed by blinded personnel.'.repeat(3);
function rct(pmid: string, title: string, o: { n?: number; outcome?: string; doi?: string; entrez?: string; pub_date?: string; big?: boolean } = {}) {
  const n = o.n ?? 300, outcome = o.outcome ?? 'oxygenation score';
  return mk({
    pmid, title, doi: o.doi ?? `10.9999/synthetic.${pmid}`, journal: 'J Synthetic', authors: ['Rossi M', 'Bianchi L'],
    pub_date: o.pub_date ?? '2026-10-05', pub_date_text: '2026 Oct', entrez_date: o.entrez ?? '2026-10-09',
    study_type: 'rct', study_type_basis: 'pubmed_tag', pub_types: ['Randomized Controlled Trial', ...(o.big ? ['Multicenter Study'] : []), 'Journal Article'],
    abstract: [
      `BACKGROUND: Synthetic test record about ${title}.`,
      `METHODS: In this ${o.big ? 'multicenter, double-blind (NCT' + pmid.padStart(8, '0') + '), ' : ''}randomized trial we randomized ${n} adult patients. The primary outcome was ${outcome}.${PAD}`,
      `RESULTS: ${outcome} was significantly lower in the intervention group (hazard ratio 0.84; 95% CI 0.74 to 0.95; P=0.006).`,
      `CONCLUSIONS: The intervention reduced ${outcome} in this trial.`,
    ].join('\n'),
  });
}

interface World { raw: PGlite; db: Db; pubmed: FakePubmed; client: PubmedClient; users: Record<string, string> }

async function world(): Promise<World> {
  const raw = await createDb();
  const db = pgliteDb(raw);
  await seedCatalog(db);
  const mkUser = async (email: string, o: { status?: string; topics?: Record<string, number>; confirmed?: boolean; blocked?: boolean; minutes?: number; rest?: number[]; until?: string } = {}) => {
    const id = await newUser(raw, email);
    if (o.confirmed === false) await raw.query(`update auth.users set email_confirmed_at = null where id = $1`, [id]);
    await raw.query(`update public.profiles set newsletter_status=$2, consent_at=now(), consent_version='t', blocked=$3, paused_until=$4, onboarding_completed=true where id=$1`, [id, o.status ?? 'active', o.blocked ?? false, o.until ?? null]);
    await raw.query(`update public.preferences set weekly_minutes=$2, rest_days=$3 where user_id=$1`, [id, o.minutes ?? 240, o.rest ?? []]);
    for (const [c, p] of Object.entries(o.topics ?? {})) await raw.query(`insert into public.user_topics (user_id, category_id, priority) values ($1,$2,$3)`, [id, c, p]);
    return id;
  };
  const users: Record<string, string> = {
    alice: await mkUser('alice@example.org', { topics: { sepsis: 5 } }),
    bob: await mkUser('bob@example.org', { topics: { airway: 5 }, rest: [5, 6] }),
    carol: await mkUser('carol@example.org', { status: 'unsubscribed', topics: { sepsis: 5 } }),
    dave: await mkUser('dave@example.org', { status: 'paused', until: '2099-01-01', topics: { sepsis: 5 } }),
    erin: await mkUser('erin@example.org', { blocked: true, topics: { sepsis: 5 } }),
    frank: await mkUser('frank@example.org', { confirmed: false, topics: { sepsis: 5 } }),
  };
  const pubmed = new FakePubmed();
  pubmed.add(rct('1001', 'Synthetic sepsis trial one', { n: 450 }), Q('sepsis'));
  pubmed.add(rct('1002', 'Synthetic sepsis trial two', { n: 600, outcome: '28-day mortality' }), Q('sepsis'));
  pubmed.add(rct('2001', 'Synthetic airway videolaryngoscopy trial A', { n: 400 }), Q('airway'));
  pubmed.add(rct('2002', 'Synthetic airway intubation trial B', { n: 500 }), Q('airway'));
  pubmed.add(rct('7000', 'Synthetic large septic shock mortality trial', { n: 2500, outcome: '28-day all-cause mortality', big: true }), Q('sepsis'));
  pubmed.add(rct('1003', 'Synthetic duplicate DOI record of trial one', { doi: '10.9999/synthetic.1001', n: 450 }), Q('sepsis'));
  pubmed.add(mk({ pmid: '1004', title: 'An editorial about sepsis', pub_types: ['Editorial'], abstract: 'A short opinion about sepsis. '.repeat(30) }), Q('sepsis'));
  pubmed.add(rct('3001', 'Synthetic pediatric anesthesia trial', { n: 500 }), Q('pediatric-anesthesia'));
  const client = new PubmedClient({ fetchFn: pubmed.fetch, sleep: nosleep, minIntervalMs: 0, maxAttempts: 3 });
  return { raw, db, pubmed, client, users };
}

function opts(w: World, mailer: Mailer, extra: Partial<RunOptions> = {}): RunOptions {
  return { db: w.db, pubmed: w.client, mailer, config: { siteUrl: SITE, emailDailyLimit: 100, allowlist: [] }, now: NOW, mode: 'live', sleep: nosleep, ...extra };
}

const count = async (w: World, sql: string, p: unknown[] = []) => Number((await w.raw.query<{ n: number }>(`select count(*)::int n ${sql}`, p)).rows[0]!.n);
const titlesOf = async (w: World, userId: string) =>
  (await w.raw.query<{ title: string }>(`select a.title from public.newsletter_items ni join public.newsletter_issues i on i.id = ni.issue_id join public.articles a on a.id = ni.article_id where i.user_id = $1 order by ni.position`, [userId])).rows.map((r) => r.title);

let sink: Awaited<ReturnType<typeof startSink>>;
beforeAll(async () => { sink = await startSink(); });
afterAll(async () => { await sink.close(); });

describe('esecuzione settimanale: ricerca condivisa, catalogo, selezioni diverse, invio reale via SMTP', () => {
  let w: World;
  let result: Awaited<ReturnType<typeof runWeekly>>;
  beforeAll(async () => {
    w = await world();
    sink.reset();
    result = await runWeekly(opts(w, smtpMailer(sink.cfg, { sleep: nosleep })));
  });

  it('completa con successo e usa UNA ricerca per categoria (non per utente)', () => {
    expect(result.status).toBe('success');
    const searches = w.pubmed.calls.filter((c) => c.endpoint === 'esearch');
    expect(searches).toHaveLength(cats.length);
    expect(new Set(searches.map((s) => s.term)).size).toBe(cats.length); // nessuna ricerca duplicata
  });

  it('deduplica per PMID e DOI, scarta editoriali, registra le statistiche', async () => {
    expect(result.stats.duplicates_doi).toBe(1);
    expect(result.stats.skipped_excluded).toBeGreaterThanOrEqual(1);
    expect(await count(w, `from public.articles where pmid = '1003'`)).toBe(0); // doppione di DOI non inserito
    expect(await count(w, `from public.articles where pmid = '1004'`)).toBe(0); // editoriale non inserito
    expect(await count(w, `from public.articles where pmid = '1001'`)).toBe(1);
  });

  it('due utenti con interessi diversi ricevono newsletter diverse nella stessa esecuzione', async () => {
    const a = await titlesOf(w, w.users.alice!);
    const b = await titlesOf(w, w.users.bob!);
    expect(a.join(' ')).toMatch(/sepsis|septic/i);
    expect(a.join(' ')).not.toMatch(/airway/i);
    expect(b.join(' ')).toMatch(/airway/i);
    expect(a).not.toEqual(b);
  });

  it('l\'override raggiunge anche chi non ha selezionato l\'argomento', async () => {
    const b = await titlesOf(w, w.users.bob!);
    expect(b).toContain('Synthetic large septic shock mortality trial');
    const ov = await w.raw.query<{ override_applied: boolean }>(`select ni.override_applied from public.newsletter_items ni join public.newsletter_issues i on i.id=ni.issue_id where i.user_id=$1 and ni.override_applied`, [w.users.bob]);
    expect(ov.rows.length).toBeGreaterThanOrEqual(1);
    expect(b).not.toContain('Synthetic sepsis trial one'); // gli altri articoli di sepsi no
  });

  it('invia esclusivamente agli utenti attivi, iscritti, non bloccati e con e-mail verificata', () => {
    const to = sink.received.map((r) => r.to).sort();
    expect(to).toEqual(['alice@example.org', 'bob@example.org']);
  });

  it('oggetto, intestazioni e contenuto delle e-mail ricevute', () => {
    const m = sink.received.find((r) => r.to === 'alice@example.org')!.mail;
    expect(m.subject).toBe('Anesthesia & Critical Care — Weekly Digest | 12 October 2026');
    expect(m.html).toContain('Recent Evidence');
    expect(m.text).toContain('TRASPARENZA');
    const unsub = m.headerLines.find((h) => h.key === 'list-unsubscribe')?.line ?? '';
    expect(unsub).toMatch(/#\/unsubscribe\/[0-9a-f-]{36}/);
    expect(String(m.messageId)).toContain('digest.');
    expect(m.html).toContain('#/unsubscribe/');
  });

  it('la Core Knowledge è inclusa e il progresso individuale è salvato', async () => {
    expect(await count(w, `from public.user_core_progress where user_id = $1 and status = 'sent'`, [w.users.alice])).toBe(1);
    expect(await count(w, `from public.newsletter_items ni join public.newsletter_issues i on i.id=ni.issue_id where i.user_id=$1 and ni.kind='core'`, [w.users.alice])).toBe(1);
    expect(await count(w, `from public.user_articles where user_id = $1`, [w.users.alice])).toBeGreaterThan(0);
  });

  it('nessuna e-mail per carol/dave/erin/frank e nessuno stato creato per loro', async () => {
    for (const k of ['carol', 'dave', 'erin', 'frank']) {
      expect(await count(w, `from public.newsletter_issues where user_id = $1`, [w.users[k]]), k).toBe(0);
    }
  });

  it('è IDEMPOTENTE: rieseguire la stessa settimana non crea né invia duplicati', async () => {
    sink.received.length = 0;
    const again = await runWeekly(opts(w, smtpMailer(sink.cfg, { sleep: nosleep })));
    expect(again.status).toBe('success');
    expect(sink.received).toHaveLength(0);
    expect(again.stats.issues_created).toBe(0);
    expect(again.stats.issues_reused).toBe(2);
    expect(await count(w, `from public.newsletter_issues`)).toBe(2);
    expect(await count(w, `from public.email_deliveries where status = 'sent'`)).toBe(2);
  });

  it('registra l\'esecuzione e lo stato di ricerca', async () => {
    expect(await count(w, `from public.automation_runs where kind='weekly' and mode='live' and status='success'`)).toBeGreaterThanOrEqual(1);
    const st = await w.raw.query<{ value: { last_success_at: string } }>(`select value from public.search_state where key='weekly_search'`);
    expect(st.rows[0]!.value.last_success_at).toBe(NOW.toISOString());
  });
});

describe('affidabilità: retry, errori permanenti, quote, disiscrizione durante l\'invio', () => {
  it('errore SMTP temporaneo (451): ritenta con backoff e consegna una sola volta', async () => {
    const w = await world(); sink.reset();
    sink.setBehavior((rcpt, n) => (rcpt === 'alice@example.org' && n <= 2 ? { code: 451, message: '4.7.1 try again later' } : null));
    const r = await runWeekly(opts(w, smtpMailer(sink.cfg, { sleep: nosleep })));
    expect(r.status).toBe('success');
    expect(sink.received.filter((m) => m.to === 'alice@example.org')).toHaveLength(1);
    expect(sink.attempts.get('alice@example.org')).toBe(3);
  });

  it('errore permanente (550): segnalato, non riprovato, esecuzione "partial" (avviso)', async () => {
    const w = await world(); sink.reset();
    sink.setBehavior((rcpt) => (rcpt === 'bob@example.org' ? { code: 550, message: '5.1.1 mailbox unavailable' } : null));
    const r = await runWeekly(opts(w, smtpMailer(sink.cfg, { sleep: nosleep })));
    expect(r.status).toBe('partial');
    expect(r.stats.emails_failed).toBe(1);
    expect(r.stats.emails_sent).toBe(1);
    expect(r.errors.join(' ')).toMatch(/permanent/);
    const d = await w.raw.query<{ status: string; attempts: number }>(`select status, attempts from public.email_deliveries where user_id = $1`, [w.users.bob]);
    expect(d.rows[0]!.status).toBe('failed');
    // rieseguendo non si riprova un errore permanente
    sink.reset();
    const again = await runWeekly(opts(w, smtpMailer(sink.cfg, { sleep: nosleep })));
    expect(sink.received.map((m) => m.to)).toEqual([]);
    expect(again.stats.emails_failed).toBe(0);
  });

  it('un errore temporaneo che persiste lascia l\'invio in coda e un secondo run lo recupera', async () => {
    const w = await world(); sink.reset();
    sink.setBehavior((rcpt) => (rcpt === 'bob@example.org' ? { code: 451, message: '4.3.0 temporary' } : null));
    const r1 = await runWeekly(opts(w, smtpMailer(sink.cfg, { sleep: nosleep, attempts: 2 })));
    expect(r1.status).toBe('partial');
    expect(sink.received.map((m) => m.to)).toEqual(['alice@example.org']);
    sink.reset(); // il provider si riprende
    const r2 = await runWeekly(opts(w, smtpMailer(sink.cfg, { sleep: nosleep }), { now: new Date('2026-10-12T04:20:00Z') }));
    expect(r2.status).toBe('success');
    expect(sink.received.map((m) => m.to)).toEqual(['bob@example.org']); // solo chi mancava, nessun duplicato per alice
  });

  it('quota giornaliera: invia fino al limite, lascia il resto in coda e avvisa; il giorno dopo completa', async () => {
    const w = await world(); sink.reset();
    const r1 = await runWeekly(opts(w, smtpMailer(sink.cfg, { sleep: nosleep }), { config: { siteUrl: SITE, emailDailyLimit: 1, allowlist: [] } }));
    expect(r1.status).toBe('partial');
    expect(r1.stats.quota_exceeded).toBe(true);
    expect(r1.stats.emails_sent).toBe(1);
    expect(r1.stats.emails_pending).toBe(1);
    expect(sink.received).toHaveLength(1);
    const used = await w.raw.query<{ used: number }>(`select used from public.quota_usage where provider='email' and period_key='2026-10-12'`);
    expect(used.rows[0]!.used).toBe(1);
    const r2 = await runWeekly(opts(w, smtpMailer(sink.cfg, { sleep: nosleep }), { now: new Date('2026-10-13T04:00:00Z'), config: { siteUrl: SITE, emailDailyLimit: 1, allowlist: [] } }));
    expect(r2.stats.emails_sent).toBe(1);
    expect(sink.received).toHaveLength(2);
    expect(new Set(sink.received.map((m) => m.to)).size).toBe(2);
  });

  it('il provider segnala un limite (452 quota): si ferma senza segnare falliti e avvisa', async () => {
    const w = await world(); sink.reset();
    sink.setBehavior(() => ({ code: 452, message: '4.5.2 Daily user sending quota exceeded' }));
    const r = await runWeekly(opts(w, smtpMailer(sink.cfg, { sleep: nosleep })));
    expect(r.status).toBe('partial');
    expect(r.stats.quota_exceeded).toBe(true);
    expect(r.stats.emails_failed).toBe(0);
    expect(await count(w, `from public.email_deliveries where status = 'pending'`)).toBe(2);
  });

  it('chi si disiscrive tra la generazione e l\'invio NON riceve la newsletter', async () => {
    const w = await world(); sink.reset();
    sink.setBehavior(() => ({ code: 452, message: 'quota' })); // prima esecuzione: nulla viene inviato
    await runWeekly(opts(w, smtpMailer(sink.cfg, { sleep: nosleep })));
    sink.reset();
    await w.raw.query(`select set_config('request.jwt.claim.sub', $1, false)`, [w.users.bob]);
    await w.raw.query(`update public.profiles set newsletter_status='unsubscribed' where id = $1`, [w.users.bob]);
    const r = await runWeekly(opts(w, smtpMailer(sink.cfg, { sleep: nosleep }), { now: new Date('2026-10-12T04:30:00Z') }));
    expect(sink.received.map((m) => m.to)).toEqual(['alice@example.org']);
    expect(r.stats.emails_cancelled).toBe(1);
  });

  it('SEND_ALLOWLIST (fase di test): solo gli indirizzi autorizzati ricevono e-mail', async () => {
    const w = await world(); sink.reset();
    const r = await runWeekly(opts(w, smtpMailer(sink.cfg, { sleep: nosleep }), { config: { siteUrl: SITE, emailDailyLimit: 100, allowlist: ['alice@example.org'] } }));
    expect(sink.received.map((m) => m.to)).toEqual(['alice@example.org']);
    expect(await count(w, `from public.newsletter_issues where user_id = $1`, [w.users.bob])).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/SEND_ALLOWLIST/);
  });
});

describe('PubMed non disponibile e recupero dei ritardi', () => {
  it('errori temporanei di PubMed (429): ritenta con backoff e prosegue', async () => {
    const w = await world(); w.pubmed.failFirstN = 2; sink.reset(); // 3 tentativi per richiesta: 2 errori si assorbono
    const r = await runWeekly(opts(w, simulateMailer()));
    expect(r.status).toBe('success');
    expect(r.stats.pubmed_retries).toBeGreaterThanOrEqual(2);
  });

  it('PubMed completamente giù: esecuzione fallita, nessuna e-mail, nessun contenuto di riempimento', async () => {
    const w = await world(); w.pubmed.failAll = 503; sink.reset();
    const r = await runWeekly(opts(w, smtpMailer(sink.cfg, { sleep: nosleep })));
    expect(r.status).toBe('failed');
    expect(sink.received).toHaveLength(0);
    expect(await count(w, `from public.newsletter_issues`)).toBe(0);
    expect(await count(w, `from public.automation_runs where status='failed'`)).toBe(1);
  });

  it('una categoria che fallisce: esecuzione parziale e lo stato di ricerca NON avanza', async () => {
    const w = await world(); sink.reset();
    w.pubmed.failTerm = (t) => (t.includes(Q('pain')) ? 500 : null);
    const r = await runWeekly(opts(w, simulateMailer()));
    expect(r.status).toBe('partial');
    expect(r.stats.categories_failed).toBe(1);
    expect(await count(w, `from public.search_state where key='weekly_search'`)).toBe(0);
  });

  it('recupero dei ritardi: la finestra parte dall\'ultima ricerca con 3 giorni di sovrapposizione e include record "vecchi" appena indicizzati', async () => {
    const w = await world(); sink.reset();
    await runWeekly(opts(w, simulateMailer())); // simulazione: non scrive lo stato
    await runWeekly(opts(w, smtpMailer(sink.cfg, { sleep: nosleep })));
    // una settimana dopo compare un articolo con data di pubblicazione di settembre, indicizzato solo ora
    const late = rct('1500', 'Synthetic late-indexed sepsis trial', { n: 700, pub_date: '2026-09-02', entrez: '2026-10-17' });
    w.pubmed.add(late, Q('sepsis'));
    w.pubmed.calls.length = 0;
    const next = new Date('2026-10-19T04:00:00Z');
    const r = await runWeekly(opts(w, smtpMailer(sink.cfg, { sleep: nosleep }), { now: next }));
    const first = w.pubmed.calls.find((c) => c.endpoint === 'esearch')!;
    expect(first.mindate).toBe('2026/10/09'); // 12 ottobre - 3 giorni
    expect(first.maxdate).toBe('2026/10/19');
    expect(await count(w, `from public.articles where pmid = '1500'`)).toBe(1);
    expect(r.status).toBe('success');
  });
});

describe('simulazione: nessun effetto reale', () => {
  it('non invia e-mail, non modifica lo stato degli utenti, ma restituisce le anteprime e registra l\'esecuzione', async () => {
    const w = await world(); sink.reset();
    const before = {
      issues: await count(w, `from public.newsletter_issues`), arts: await count(w, `from public.articles`),
      ua: await count(w, `from public.user_articles`), del: await count(w, `from public.email_deliveries`), prog: await count(w, `from public.user_core_progress`),
    };
    const r = await runWeekly(opts(w, simulateMailer(), { mode: 'simulate' }));
    expect(r.status).toBe('success');
    expect(r.previews).toHaveLength(2);
    expect(r.previews[0]!.html).toContain('Recent Evidence');
    expect(sink.received).toHaveLength(0);
    expect(await count(w, `from public.newsletter_issues`)).toBe(before.issues);
    expect(await count(w, `from public.articles`)).toBe(before.arts);
    expect(await count(w, `from public.user_articles`)).toBe(before.ua);
    expect(await count(w, `from public.email_deliveries`)).toBe(before.del);
    expect(await count(w, `from public.user_core_progress`)).toBe(before.prog);
    expect(await count(w, `from public.automation_runs where mode='simulate'`)).toBe(1);
    // e dopo una simulazione l'invio reale funziona normalmente
    const live = await runWeekly(opts(w, smtpMailer(sink.cfg, { sleep: nosleep })));
    expect(live.stats.emails_sent).toBe(2);
  });
});

describe('continuità settimana dopo settimana', () => {
  it('nessuna ripetizione di articoli o di Core, il Core avanza e il numero di novità scelto è rispettato', async () => {
    const w = await world(); sink.reset();
    await raw(w, `update public.preferences set weekly_minutes = 60, max_weekly_reads = 4 where user_id = '${w.users.alice}'`);
    await runWeekly(opts(w, smtpMailer(sink.cfg, { sleep: nosleep })));
    const coreWeek1 = (await w.raw.query<{ core_item_id: string }>(`select ni.core_item_id from public.newsletter_items ni join public.newsletter_issues i on i.id=ni.issue_id where i.user_id=$1 and ni.kind='core'`, [w.users.alice])).rows[0]!.core_item_id;
    // l'utente completa la lettura Core
    await raw(w, `update public.user_core_progress set status='completed', completed_at=now() where user_id='${w.users.alice}' and item_id='${coreWeek1}'`);
    // nuova settimana con nuovi articoli
    w.pubmed.add(rct('1600', 'Synthetic sepsis trial of week two', { n: 520, entrez: '2026-10-15' }), Q('sepsis'));
    const wk2 = new Date('2026-10-19T04:00:00Z');
    await runWeekly(opts(w, smtpMailer(sink.cfg, { sleep: nosleep }), { now: wk2 }));
    const issues = (await w.raw.query<{ id: string; week_start: string }>(`select id, week_start::text from public.newsletter_issues where user_id=$1 order by week_start`, [w.users.alice])).rows;
    expect(issues.map((i) => i.week_start)).toEqual(['2026-10-12', '2026-10-19']);
    const core2 = (await w.raw.query<{ core_item_id: string }>(`select core_item_id from public.newsletter_items where issue_id=$1 and kind='core'`, [issues[1]!.id])).rows[0]!.core_item_id;
    expect(core2).not.toBe(coreWeek1);
    // nessun articolo recente ripetuto tra le due settimane
    const arts = (await w.raw.query<{ article_id: number }>(`select ni.article_id from public.newsletter_items ni join public.newsletter_issues i on i.id=ni.issue_id where i.user_id=$1 and ni.kind='recent'`, [w.users.alice])).rows.map((r) => r.article_id);
    expect(new Set(arts).size).toBe(arts.length);
    // il numero scelto (4) riguarda le novità; il Core si aggiunge a parte
    for (const iss of issues) {
      const n = Number((await w.raw.query<{ n: number }>(`select count(*)::int n from public.newsletter_items where issue_id=$1 and kind='recent'`, [iss.id])).rows[0]!.n);
      expect(n).toBeLessThanOrEqual(4);
    }
  });

  it('senza articoli rilevanti né Core non si invia nulla (nessun riempitivo)', async () => {
    const w = await world(); sink.reset();
    await raw(w, `update public.preferences set core_enabled = false where user_id = '${w.users.alice}'`);
    await raw(w, `delete from public.user_topics where user_id = '${w.users.alice}'`);
    await raw(w, `delete from public.articles`); // catalogo vuoto + PubMed senza risultati
    const empty = new FakePubmed();
    const client = new PubmedClient({ fetchFn: empty.fetch, sleep: nosleep, minIntervalMs: 0 });
    const r = await runWeekly({ ...opts(w, smtpMailer(sink.cfg, { sleep: nosleep })), pubmed: client, userIds: [w.users.alice!] });
    expect(r.stats.skipped_no_content).toBe(1);
    expect(sink.received).toHaveLength(0);
    expect(await count(w, `from public.newsletter_issues where user_id = $1`, [w.users.alice])).toBe(0);
  });
});

async function raw(w: World, sql: string) { await w.raw.exec(sql); }

describe('invio di prova richiesto da utenti autorizzati', () => {
  it('solo gli autorizzati; una sola e-mail di prova al giorno; non modifica libreria né Core', async () => {
    const w = await world(); sink.reset();
    await runWeekly(opts(w, simulateMailer())); // popola il catalogo (rollback) -> serve il catalogo reale:
    await runWeekly(opts(w, simulateMailer(), { mode: 'live' }));
    sink.reset();
    await raw(w, `update public.profiles set test_authorized = true where id = '${w.users.alice}'`);
    const before = await count(w, `from public.user_articles where user_id = $1`, [w.users.alice]);
    await raw(w, `insert into public.test_requests (user_id) values ('${w.users.alice}'), ('${w.users.alice}'), ('${w.users.bob}')`);
    const o = { ...opts(w, smtpMailer(sink.cfg, { sleep: nosleep })) } as Omit<RunOptions, 'weekStart'>;
    const r = await processTestRequests(o);
    expect(r.processed).toBe(3);
    expect(r.sent).toBe(1); // la seconda richiesta di alice è deduplicata, quella di bob non è autorizzata
    expect(r.failed).toBe(1);
    expect(sink.received).toHaveLength(1);
    expect(sink.received[0]!.mail.subject).toMatch(/^\[TEST\] Anesthesia & Critical Care — Weekly Digest/);
    expect(await count(w, `from public.user_articles where user_id = $1`, [w.users.alice])).toBe(before);
    const states = (await w.raw.query<{ status: string }>(`select status from public.test_requests order by requested_at, id`)).rows.map((x) => x.status).sort();
    expect(states).toEqual(['done', 'done', 'failed']);
    expect(await count(w, `from public.email_deliveries where kind='test' and status='sent'`)).toBe(1);
  });
});
