import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createDb, as, newUser, expectDenied } from './helpers/db';

let db: PGlite;
let alice: string;
let bob: string;
let admin: string;

beforeAll(async () => {
  db = await createDb();
  alice = await newUser(db, 'alice@example.org');
  bob = await newUser(db, 'bob@example.org');
  admin = await newUser(db, 'admin@example.org');
  await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
  await db.exec(`
    insert into public.categories (id, group_key, name_it, name_en, pubmed_query)
      values ('sepsis','icu','Sepsi','Sepsis','sepsis[tiab]'), ('airway','anesthesia','Vie aeree','Airway','airway[tiab]');
    insert into public.articles (pmid, title, study_type) values ('111', 'Articolo condiviso', 'rct');
    insert into public.core_topics (id, title_it, title_en) values ('t1','Tema','Topic');
  `);
});

describe('registrazione', () => {
  it('crea automaticamente profilo e preferenze (senza consenso: stato pending)', async () => {
    const p = await db.query<{ newsletter_status: string; role: string }>(
      `select newsletter_status, role from public.profiles where id = $1`, [alice]);
    expect(p.rows[0]).toEqual({ newsletter_status: 'pending', role: 'user' });
    const pr = await db.query(`select 1 from public.preferences where user_id = $1`, [alice]);
    expect(pr.rows).toHaveLength(1);
  });
});

describe('separazione dei dati tra utenti (RLS)', () => {
  it('un utente vede solo il proprio profilo', async () => {
    const rows = await as<{ id: string }>(db, alice, `select id from public.profiles`);
    expect(rows.map((r) => r.id)).toEqual([alice]);
  });

  it('un utente non può leggere né modificare le preferenze di un altro', async () => {
    const own = await as(db, alice, `select * from public.preferences`);
    expect(own).toHaveLength(1);
    const upd = await as(db, alice,
      `update public.preferences set max_weekly_reads = 21 where user_id = $1 returning user_id`, [bob]);
    expect(upd).toHaveLength(0);
    const bobPref = await db.query<{ max_weekly_reads: number }>(
      `select max_weekly_reads from public.preferences where user_id = $1`, [bob]);
    expect(bobPref.rows[0]!.max_weekly_reads).toBe(6);
  });

  it('le preferenze di Alice non modificano quelle di Bob', async () => {
    await as(db, alice, `update public.preferences set max_weekly_reads = 3, weekly_minutes = 45 where user_id = $1`, [alice]);
    const bobPref = await db.query<{ max_weekly_reads: number; weekly_minutes: number }>(
      `select max_weekly_reads, weekly_minutes from public.preferences where user_id = $1`, [bob]);
    expect(bobPref.rows[0]).toEqual({ max_weekly_reads: 6, weekly_minutes: 120 });
  });

  it('non si possono inserire righe a nome di un altro utente', async () => {
    const msg = await expectDenied(as(db, alice,
      `insert into public.user_topics (user_id, category_id, priority) values ($1, 'sepsis', 5)`, [bob]));
    expect(msg).toMatch(/row-level security/i);
  });

  it('argomenti, libreria e progressi di Alice sono invisibili a Bob', async () => {
    await as(db, alice, `insert into public.user_topics (user_id, category_id, priority) values ($1,'sepsis',5)`, [alice]);
    await as(db, alice, `insert into public.user_articles (user_id, article_id, status)
                         select $1, id, 'saved' from public.articles where pmid = '111'`, [alice]);
    expect(await as(db, bob, `select * from public.user_topics`)).toHaveLength(0);
    expect(await as(db, bob, `select * from public.user_articles`)).toHaveLength(0);
    expect(await as(db, alice, `select * from public.user_topics`)).toHaveLength(1);
  });

  it('un utente non può diventare amministratore né toccare ruoli e flag', async () => {
    await expectDenied(as(db, alice, `update public.profiles set role = 'admin' where id = $1`, [alice]));
    await expectDenied(as(db, alice, `update public.profiles set test_authorized = true where id = $1`, [alice]));
    await expectDenied(as(db, alice, `insert into public.profiles (id) values (gen_random_uuid())`));
  });

  it('l\'utente anonimo non legge nulla', async () => {
    await expectDenied(as(db, null, `select * from public.categories`));
    await expectDenied(as(db, null, `select * from public.profiles`));
  });

  it('le tabelle operative sono inaccessibili ai client', async () => {
    for (const t of ['automation_runs', 'quota_usage', 'search_state', 'rate_events']) {
      await expectDenied(as(db, alice, `select * from public.${t}`));
    }
  });
});

describe('dati condivisi', () => {
  it('gli articoli sono leggibili ma non scrivibili dagli utenti', async () => {
    expect(await as(db, alice, `select pmid from public.articles`)).toHaveLength(1);
    await expectDenied(as(db, alice, `insert into public.articles (pmid, title) values ('222','x')`));
    await expectDenied(as(db, alice, `update public.articles set title = 'x'`));
    await expectDenied(as(db, alice, `delete from public.articles`));
  });

  it('solo l\'amministratore modifica le categorie', async () => {
    await expectDenied(as(db, alice,
      `insert into public.categories (id, group_key, name_it, name_en, pubmed_query) values ('nuova','cross','a','b','c[tiab]')`));
    const upd = await as(db, alice, `update public.categories set name_it = 'hack' where id = 'sepsis' returning id`);
    expect(upd).toHaveLength(0);
    await as(db, admin,
      `insert into public.categories (id, group_key, name_it, name_en, pubmed_query) values ('nuova','cross','Nuova','New','c[tiab]')`);
    const upd2 = await as(db, admin, `update public.categories set name_it = 'Nuova 2' where id = 'nuova' returning name_it`);
    expect(upd2).toEqual([{ name_it: 'Nuova 2' }]);
  });
});

describe('ruolo amministratore: nessun accesso ai dati personali', () => {
  it('l\'admin non legge direttamente profili, preferenze o libreria di altri', async () => {
    const profiles = await as<{ id: string }>(db, admin, `select id from public.profiles`);
    expect(profiles.map((p) => p.id)).toEqual([admin]);
    expect(await as(db, admin, `select * from public.user_articles`)).toHaveLength(0);
    expect(await as(db, admin, `select * from public.user_topics`)).toHaveLength(0);
  });

  it('admin_list_users mostra indirizzi mascherati', async () => {
    const rows = await as<{ email_masked: string }>(db, admin, `select * from public.admin_list_users()`);
    const masked = rows.map((r) => r.email_masked);
    expect(masked).toContain('a***@e***.org');
    expect(masked.join(' ')).not.toMatch(/alice@example\.org/);
  });

  it('le funzioni di amministrazione sono vietate agli utenti comuni', async () => {
    await expectDenied(as(db, alice, `select public.admin_overview()`));
    await expectDenied(as(db, alice, `select * from public.admin_list_users()`));
    await expectDenied(as(db, alice, `select public.admin_set_user_flags($1, true, true)`, [bob]));
  });

  it('admin_overview restituisce solo aggregati', async () => {
    const [r] = await as<{ o: { users: { total: number }; recent_runs: unknown[] } }>(db, admin, `select public.admin_overview() as o`);
    expect(r!.o.users.total).toBe(3);
    expect(JSON.stringify(r!.o)).not.toMatch(/@/);
  });

  it('l\'admin non può bloccare se stesso, ma può autorizzare i test di un utente', async () => {
    await expectDenied(as(db, admin, `select public.admin_set_user_flags($1, true, null)`, [admin]));
    await as(db, admin, `select public.admin_set_user_flags($1, null, true)`, [bob]);
    const r = await db.query<{ test_authorized: boolean }>(`select test_authorized from public.profiles where id = $1`, [bob]);
    expect(r.rows[0]!.test_authorized).toBe(true);
    await as(db, admin, `select public.admin_set_user_flags($1, null, false)`, [bob]);
  });
});

describe('consenso, pausa e disiscrizione', () => {
  it('flusso completo con registro dei consensi', async () => {
    await as(db, alice, `select public.give_newsletter_consent('2026-10')`);
    let p = await db.query<{ newsletter_status: string; consent_version: string }>(
      `select newsletter_status, consent_version from public.profiles where id = $1`, [alice]);
    expect(p.rows[0]).toEqual({ newsletter_status: 'active', consent_version: '2026-10' });

    await as(db, alice, `select public.pause_newsletter('2099-01-01')`);
    p = await db.query(`select newsletter_status from public.profiles where id = $1`, [alice]);
    expect(p.rows[0]).toEqual({ newsletter_status: 'paused' });
    await as(db, alice, `select public.resume_newsletter()`);

    await as(db, alice, `select public.unsubscribe_me()`);
    p = await db.query(`select newsletter_status from public.profiles where id = $1`, [alice]);
    expect(p.rows[0]).toEqual({ newsletter_status: 'unsubscribed' });

    const log = await as<{ event: string }>(db, alice, `select event from public.consent_log order by id`);
    expect(log.map((l) => l.event)).toEqual(['consent_newsletter', 'pause', 'resume', 'unsubscribe']);
  });

  it('la nuova iscrizione richiede un nuovo consenso esplicito', async () => {
    await expectDenied(as(db, alice, `select public.resume_newsletter()`));
    await as(db, alice, `select public.give_newsletter_consent('2026-10')`);
    const p = await db.query(`select newsletter_status from public.profiles where id = $1`, [alice]);
    expect(p.rows[0]).toEqual({ newsletter_status: 'active' });
  });

  it('disiscrizione con token da utente anonimo; token errato non fa nulla', async () => {
    await as(db, bob, `select public.give_newsletter_consent('2026-10')`);
    const { rows } = await db.query<{ unsubscribe_token: string }>(`select unsubscribe_token from public.profiles where id = $1`, [bob]);
    const bad = await as<{ r: boolean }>(db, null, `select public.unsubscribe_by_token(gen_random_uuid()) as r`);
    expect(bad[0]!.r).toBe(false);
    const ok = await as<{ r: boolean }>(db, null, `select public.unsubscribe_by_token($1) as r`, [rows[0]!.unsubscribe_token]);
    expect(ok[0]!.r).toBe(true);
    const p = await db.query(`select newsletter_status from public.profiles where id = $1`, [bob]);
    expect(p.rows[0]).toEqual({ newsletter_status: 'unsubscribed' });
    // nessun utente anonimo può leggere i token
    await expectDenied(as(db, null, `select unsubscribe_token from public.profiles`));
  });

  it('l\'utente non può inserire voci nel registro dei consensi', async () => {
    await expectDenied(as(db, alice, `insert into public.consent_log (user_id, event) values ($1,'consent_newsletter')`, [alice]));
  });
});

describe('esportazione, test, eliminazione', () => {
  it('export_my_data contiene solo i dati dell\'utente e ha un limite di frequenza', async () => {
    const [r] = await as<{ d: any }>(db, alice, `select public.export_my_data() as d`);
    expect(r!.d.account.email).toBe('alice@example.org');
    expect(r!.d.library).toHaveLength(1);
    expect(JSON.stringify(r!.d)).not.toMatch(/bob@example/);
    expect(r!.d.profile.unsubscribe_token).toBeUndefined();
    for (let i = 0; i < 4; i++) await as(db, alice, `select public.export_my_data()`);
    const msg = await expectDenied(as(db, alice, `select public.export_my_data()`));
    expect(msg).toMatch(/rate_limited/);
  });

  it('l\'invio di prova richiede autorizzazione ed è limitato a 3 al giorno', async () => {
    const msg = await expectDenied(as(db, alice, `select public.request_test_send()`));
    expect(msg).toMatch(/forbidden/);
    await as(db, admin, `select public.request_test_send()`);
    await as(db, admin, `select public.request_test_send()`);
    await as(db, admin, `select public.request_test_send()`);
    expect(await expectDenied(as(db, admin, `select public.request_test_send()`))).toMatch(/rate_limited/);
  });

  it('delete_my_account elimina tutti i dati dell\'utente e solo i suoi', async () => {
    const carol = await newUser(db, 'carol@example.org');
    await as(db, carol, `select public.give_newsletter_consent('2026-10')`);
    await as(db, carol, `insert into public.user_topics (user_id, category_id, priority) values ($1,'airway',4)`, [carol]);
    await as(db, carol, `select public.delete_my_account()`);
    for (const t of ['profiles:id', 'preferences:user_id', 'user_topics:user_id', 'consent_log:user_id', 'rate_events:user_id']) {
      const [table, col] = t.split(':');
      const r = await db.query(`select 1 from public.${table} where ${col} = $1`, [carol]);
      expect(r.rows, table).toHaveLength(0);
    }
    const u = await db.query(`select 1 from auth.users where id = $1`, [carol]);
    expect(u.rows).toHaveLength(0);
    // gli altri utenti non sono toccati
    expect((await db.query(`select 1 from public.profiles where id = $1`, [alice])).rows).toHaveLength(1);
    expect((await db.query(`select 1 from public.user_topics where user_id = $1`, [alice])).rows).toHaveLength(1);
  });
});

describe('vincoli di integrità', () => {
  it('un\'unica newsletter per utente e settimana; un solo invio per chiave di idempotenza', async () => {
    const i = await db.query<{ id: string }>(
      `insert into public.newsletter_issues (user_id, week_start, subject, html, text_body)
       values ($1, '2026-10-12', 's', '<p/>', 't') returning id`, [alice]);
    await expectDenied(db.query(
      `insert into public.newsletter_issues (user_id, week_start, subject, html, text_body) values ($1,'2026-10-12','s','<p/>','t')`, [alice]));
    await db.query(`insert into public.email_deliveries (issue_id, user_id, idempotency_key) values ($1,$2,'k1')`, [i.rows[0]!.id, alice]);
    await expectDenied(db.query(
      `insert into public.email_deliveries (issue_id, user_id, idempotency_key) values ($1,$2,'k1')`, [i.rows[0]!.id, alice]));
  });

  it('PMID e DOI duplicati nel catalogo sono rifiutati', async () => {
    await db.query(`insert into public.articles (pmid, doi, title) values ('900','10.1/abc','a')`);
    await expectDenied(db.query(`insert into public.articles (pmid, doi, title) values ('900', null, 'b')`));
    await expectDenied(db.query(`insert into public.articles (pmid, doi, title) values ('901','10.1/abc','b')`));
  });

  it('le newsletter sono leggibili solo dal proprietario', async () => {
    expect(await as(db, alice, `select id from public.newsletter_issues`)).toHaveLength(1);
    expect(await as(db, bob, `select id from public.newsletter_issues`)).toHaveLength(0);
    await expectDenied(as(db, alice, `insert into public.newsletter_issues (user_id, week_start, subject, html, text_body) values ($1,'2026-10-19','s','h','t')`, [alice]));
  });
});
