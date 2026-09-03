import { Pool, type QueryResultRow } from 'pg';

// One pool per process. Next.js keeps modules warm between requests, so this is
// created once and reused; in dev the module can be re-evaluated on HMR, hence
// the global cache.
declare global {
  // eslint-disable-next-line no-var
  var __tvePool: Pool | undefined;
}

function makePool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. The site reads the tve schema directly; ' +
        'there is no fallback and no cached copy — a page that cannot reach ' +
        'the database must fail loudly rather than render a stale number.',
    );
  }
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.PGPOOL_MAX ?? 8),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Every session must see the tve schema. Three functions in this database
    // were silently broken once by relying on an ambient search_path; do not
    // repeat that by relying on the role default.
    options: '-c search_path=tve,public',
  });
  pool.on('error', (err) => {
    console.error('[db] idle client error', err);
  });
  return pool;
}

export function pool(): Pool {
  if (!global.__tvePool) global.__tvePool = makePool();
  return global.__tvePool;
}

export async function q<T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const started = Date.now();
  const res = await pool().query<T>(text, params as unknown[]);
  const ms = Date.now() - started;
  if (ms > 400) console.warn(`[db] slow ${ms}ms :: ${text.slice(0, 120)}`);
  return res.rows;
}

export async function q1<T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}
