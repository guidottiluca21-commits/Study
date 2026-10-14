/** Accesso al database: stessa interfaccia per Postgres reale (pg) e per i test (PGlite). */
import pg from 'pg';
import type { PGlite } from '@electric-sql/pglite';

export interface QueryResult<T> { rows: T[]; rowCount: number }
export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}
export interface Db extends Queryable {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Connessione diretta a Postgres (es. pooler Supabase in modalità sessione, compatibile IPv4).
 * La connessione è cifrata; la verifica del certificato è attiva se si fornisce DATABASE_CA.
 */
export function pgDb(connectionString: string, opts: { ca?: string; ssl?: boolean } = {}): Db {
  const ssl = opts.ssl === false ? false : opts.ca ? { ca: opts.ca } : { rejectUnauthorized: false };
  const pool = new pg.Pool({ connectionString, ssl, max: 3, connectionTimeoutMillis: 20_000, idleTimeoutMillis: 10_000 });
  const wrap = (c: pg.PoolClient | pg.Pool): Queryable => ({
    async query<T>(sql: string, params?: unknown[]) {
      const r = await c.query(sql, params as any[]);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
    },
  });
  return {
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn(wrap(client));
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

export function pgliteDb(db: PGlite): Db {
  const wrap = (c: { query: PGlite['query'] }): Queryable => ({
    async query<T>(sql: string, params?: unknown[]) {
      const r = await c.query<T>(sql, params as any[]);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
  });
  return {
    ...wrap(db),
    tx: (fn) => db.transaction((t) => fn(wrap(t as unknown as { query: PGlite['query'] }))),
    close: async () => undefined,
  };
}
