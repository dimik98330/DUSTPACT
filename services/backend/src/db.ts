import { Pool, type PoolClient } from "pg";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
export function database(url: string) {
  const pool = new Pool({
    connectionString: url,
    max: 8,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 5000,
  });
  // Idle sockets are invalidated by a PostgreSQL restart. Let the pool reconnect;
  // never crash the optional service or dump a connection error containing a URL.
  pool.on("error", () =>
    process.stdout.write('{"event":"database_idle_connection_closed"}\n'),
  );
  return pool;
}
export async function transaction<T>(
  db: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* Preserve the operation/commit failure on a broken socket. */
    }
    throw error;
  } finally {
    client.release();
  }
}
export async function migrate(db: Pool, migrationDirectory=new URL("../migrations/",import.meta.url)) {
  await transaction(db, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(60419701)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const directory = fileURLToPath(migrationDirectory);
    for (const file of (await readdir(directory))
      .filter((n) => /^\d+_.+\.sql$/.test(n))
      .sort()) {
      if (
        (
          await c.query("SELECT 1 FROM schema_migrations WHERE version=$1", [
            file,
          ])
        ).rowCount
      )
        continue;
      await c.query(await readFile(`${directory}/${file}`, "utf8"));
      await c.query("INSERT INTO schema_migrations(version) VALUES($1)", [
        file,
      ]);
    }
  });
}
export async function cleanup(db: Pool) {
  await transaction(db,async(c)=>{
    await c.query('DELETE FROM auth_nonces WHERE expires_at<now()');
    await c.query('DELETE FROM auth_sessions WHERE expires_at<now()');
    await c.query('DELETE FROM v2_ws_tickets WHERE expires_at<now()');
    await c.query('DELETE FROM v2_chat_mutes WHERE expires_at<now()');
  });
}
