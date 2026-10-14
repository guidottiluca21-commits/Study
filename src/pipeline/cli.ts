import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.ts';
import { pgDb, type Db } from './db.ts';
import { PubmedClient } from '../core/pubmed-client.ts';
import { decideRun } from '../core/schedule.ts';
import { smtpMailer, simulateMailer, type Mailer } from './mailer.ts';
import { processTestRequests, runWeekly } from './run.ts';
import { seedCatalog } from './seed.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };

const log = (level: 'info' | 'warn' | 'error', msg: string) => {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${msg}`;
  (level === 'error' ? console.error : console.log)(line);
  if (process.env.GITHUB_ACTIONS && level !== 'info') console.log(`::${level === 'error' ? 'error' : 'warning'}::${msg.replace(/\n/g, ' ')}`);
};

function openDb(): Db {
  const cfg = loadConfig(process.env, { needDb: true });
  return pgDb(cfg.databaseUrl, { ca: cfg.databaseCa });
}

function summary(md: string) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}

async function migrate() {
  const db = openDb();
  try {
    await db.query(`create table if not exists public._migrations (name text primary key, applied_at timestamptz not null default now())`);
    await db.query(`alter table public._migrations enable row level security`);
    await db.query(`revoke all on public._migrations from anon, authenticated`).catch(() => undefined);
    const dir = join(ROOT, 'supabase', 'migrations');
    const done = new Set((await db.query<{ name: string }>(`select name from public._migrations`)).rows.map((r) => r.name));
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
      if (done.has(f)) { console.log(`già applicata: ${f}`); continue; }
      await db.tx(async (q) => {
        await q.query(readFileSync(join(dir, f), 'utf8'));
        await q.query(`insert into public._migrations (name) values ($1)`, [f]);
      });
      console.log(`applicata: ${f}`);
    }
  } finally { await db.close(); }
}

async function weekly() {
  const simulate = flag('simulate');
  const cfg = loadConfig(process.env, { needSmtp: !simulate });
  const now = new Date();
  const decision = decideRun(now, { force: flag('force') || simulate });
  log('info', `Decisione: ${decision.run ? 'ESEGUI' : 'SALTA'} — ${decision.reason} (settimana ${decision.weekStart}, invio previsto ${decision.sendAt.toISOString()})`);
  if (!decision.run) { summary(`### Digest settimanale\nSaltato: ${decision.reason}`); return; }
  if (decision.late) log('warn', 'Esecuzione in ritardo rispetto alle 06:00 (ritardo della pianificazione di GitHub Actions): invio immediato.');

  const mailer: Mailer = simulate ? simulateMailer() : smtpMailer(cfg.smtp!);
  const db = openDb();
  try {
    const res = await runWeekly({
      db, mailer, now, mode: simulate ? 'simulate' : 'live',
      weekStart: opt('week') ?? decision.weekStart, sendAt: simulate ? undefined : decision.sendAt, log,
      pubmed: new PubmedClient({ email: cfg.ncbiEmail, apiKey: cfg.ncbiApiKey, onLog: (m) => log('warn', m) }),
      config: { siteUrl: cfg.siteUrl, emailDailyLimit: cfg.emailDailyLimit, allowlist: cfg.allowlist },
      githubRunId: process.env.GITHUB_RUN_ID, skipSearch: flag('skip-search'),
    });
    const out = opt('out');
    if (out) {
      mkdirSync(out, { recursive: true });
      for (const p of res.previews) if (p.html) { writeFileSync(join(out, `${p.userId}.html`), p.html); writeFileSync(join(out, `${p.userId}.txt`), p.text ?? ''); }
      writeFileSync(join(out, 'summary.json'), JSON.stringify({ ...res, previews: res.previews.map(({ html, text, ...rest }) => rest) }, null, 2));
    }
    summary(`### Digest settimanale (${res.status})\n\`\`\`json\n${JSON.stringify(res.stats, null, 2)}\n\`\`\`\n${res.errors.map((e) => `- ❌ ${e}`).join('\n')}\n${res.warnings.map((w) => `- ⚠️ ${w}`).join('\n')}`);
    console.log(JSON.stringify({ status: res.status, stats: res.stats, errors: res.errors, warnings: res.warnings }, null, 2));
    if (res.status !== 'success') process.exitCode = 1; // il workflow diventa rosso: GitHub notifica l'amministratore
  } finally { await db.close(); }
}

async function requests() {
  const simulate = flag('simulate');
  const cfg = loadConfig(process.env, { needSmtp: !simulate });
  const db = openDb();
  try {
    const r = await processTestRequests({
      db, mailer: simulate ? simulateMailer() : smtpMailer(cfg.smtp!), now: new Date(), mode: simulate ? 'simulate' : 'live', log,
      pubmed: new PubmedClient({}), config: { siteUrl: cfg.siteUrl, emailDailyLimit: cfg.emailDailyLimit, allowlist: cfg.allowlist },
    });
    console.log(JSON.stringify(r));
    if (r.failed) process.exitCode = 1;
  } finally { await db.close(); }
}

async function mailTest() {
  const to = argv[1];
  if (!to) throw new Error('Uso: mail-test <indirizzo>');
  const cfg = loadConfig(process.env, { needSmtp: true, needDb: false });
  const m = smtpMailer(cfg.smtp!);
  const r = await m.send({ to, subject: 'Prova di invio — Anesthesia & Critical Care Digest', text: 'Se leggi questo messaggio, la configurazione SMTP funziona.', html: '<p>Se leggi questo messaggio, la configurazione SMTP funziona.</p>', messageId: `<mail-test.${Date.now()}@${new URL(cfg.siteUrl).hostname}>` });
  console.log('Inviato:', r.providerMessageId);
}

async function scheduleCheck() {
  const now = opt('at') ? new Date(opt('at')!) : new Date();
  console.log(JSON.stringify(decideRun(now, { force: flag('force') }), null, 2));
}

async function main() {
  switch (cmd) {
    case 'migrate': return migrate();
    case 'seed': { const db = openDb(); try { console.log(await seedCatalog(db)); } finally { await db.close(); } return; }
    case 'weekly': return weekly();
    case 'requests': return requests();
    case 'mail-test': return mailTest();
    case 'schedule-check': return scheduleCheck();
    case 'verify-curriculum': { const { verifyCurriculumCli } = await import('./cli-curriculum.ts'); return verifyCurriculumCli(); }
    default:
      console.error('Comandi: migrate | seed | weekly [--simulate] [--force] [--week YYYY-MM-DD] [--out dir] | requests [--simulate] | mail-test <indirizzo> | schedule-check [--at ISO] | verify-curriculum');
      process.exit(2);
  }
}
main().catch((e) => { log('error', (e as Error).message); process.exit(1); });
