import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Db = PostgresJsDatabase<typeof schema>;

export interface DbConnection {
  db: Db;
  sql: postgres.Sql;
  close: () => Promise<void>;
}

/** Open a Drizzle connection over postgres-js. */
export function createDb(url: string): DbConnection {
  const sql = postgres(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end() };
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

/**
 * Apply SQL migrations in order. Generated DDL (drizzle-kit) plus the hand-written
 * audit-immutability triggers live in packages/db/migrations. Idempotent: each
 * file is wrapped so re-running is safe (CREATE ... IF NOT EXISTS where possible).
 */
export async function runMigrations(conn: DbConnection): Promise<string[]> {
  if (!existsSync(migrationsDir)) return [];
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const applied: string[] = [];
  await conn.sql`CREATE TABLE IF NOT EXISTS _aelio_migrations (name text primary key, applied_at timestamptz default now())`;
  for (const file of files) {
    const already = await conn.sql`SELECT 1 FROM _aelio_migrations WHERE name = ${file}`;
    if (already.length > 0) continue;
    const ddl = readFileSync(join(migrationsDir, file), 'utf8');
    try {
      await conn.sql.unsafe(ddl);
    } catch (err) {
      // Tolerate "already exists" on first adoption of an existing database.
      const msg = err instanceof Error ? err.message : String(err);
      if (!/already exists|duplicate/i.test(msg)) throw err;
    }
    await conn.sql`INSERT INTO _aelio_migrations (name) VALUES (${file}) ON CONFLICT DO NOTHING`;
    applied.push(file);
  }
  return applied;
}
