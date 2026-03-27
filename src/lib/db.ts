/**
 * D1 Database access layer.
 *
 * In Cloudflare Pages: accessed via env binding (DB)
 * In local dev: accessed via wrangler's local D1 proxy
 */
import { getRequestContext } from '@cloudflare/next-on-pages';

export interface D1Row {
  [key: string]: unknown;
}

export function getDB(): D1Database {
  try {
    const { env } = getRequestContext();
    return (env as { DB: D1Database }).DB;
  } catch {
    throw new Error('D1 database not available. Run with `wrangler pages dev` or deploy to Cloudflare Pages.');
  }
}

// ── Query helpers ──

export async function queryOne<T = D1Row>(sql: string, ...params: unknown[]): Promise<T | null> {
  const db = getDB();
  const stmt = db.prepare(sql).bind(...params);
  const result = await stmt.first<T>();
  return result;
}

export async function queryAll<T = D1Row>(sql: string, ...params: unknown[]): Promise<T[]> {
  const db = getDB();
  const stmt = db.prepare(sql).bind(...params);
  const { results } = await stmt.all<T>();
  return results || [];
}

export async function queryCount(sql: string, ...params: unknown[]): Promise<number> {
  const db = getDB();
  const stmt = db.prepare(sql).bind(...params);
  const row = await stmt.first<{ cnt: number }>();
  return row?.cnt || 0;
}

export async function execute(sql: string, ...params: unknown[]): Promise<D1Result> {
  const db = getDB();
  const stmt = db.prepare(sql).bind(...params);
  return stmt.run();
}

export async function executeBatch(statements: { sql: string; params: unknown[] }[]): Promise<void> {
  const db = getDB();
  const batch = statements.map(s => db.prepare(s.sql).bind(...s.params));
  await db.batch(batch);
}
