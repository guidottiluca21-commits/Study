import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

/** Crea un Postgres reale in memoria con lo schema auth di Supabase simulato e tutte le migrazioni. */
export async function createDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(import.meta.dirname, 'supabase-shim.sql'), 'utf8'));
  const dir = join(ROOT, 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  return db;
}

export type Role = 'anon' | 'authenticated';

/**
 * Esegue UNA istruzione con i privilegi di un client Supabase (ruolo + JWT sub),
 * in una transazione propria. Lancia se Postgres rifiuta (permessi, RLS with check, funzioni).
 */
export async function as<T = Record<string, unknown>>(
  db: PGlite,
  uid: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${uid ? 'authenticated' : 'anon'}`);
    if (uid) await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    const res = await tx.query<T>(sql, params);
    return res.rows;
  });
}

export async function newUser(db: PGlite, email: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id`,
    [email],
  );
  return r.rows[0]!.id;
}

export async function expectDenied(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return String((e as Error).message);
  }
  throw new Error('Atteso un rifiuto da parte del database, ma l\'operazione è riuscita');
}
