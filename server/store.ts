import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import type { Run } from "../src/lib/types";
import { env } from "./config";
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 4 })
  : undefined;
let init: Promise<unknown> | undefined;
let queue: Promise<unknown> = Promise.resolve();
async function ready() {
  if (env.hosted && !pool && !process.env.PROOFLAYER_DATA_DIR?.startsWith("/data/"))
    throw new Error("Hosted file storage requires the persistent /data volume.");
  if (!init)
    init = pool
      ? pool.query(
          "CREATE TABLE IF NOT EXISTS prooflayer_runs (id text PRIMARY KEY, body jsonb NOT NULL)",
        )
      : mkdir(env.dataDir, { recursive: true });
  await init;
}
async function localRead(): Promise<Run[]> {
  try {
    return JSON.parse(
      await readFile(path.join(env.dataDir, "runs.json"), "utf8"),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
async function localWrite(runs: Run[]) {
  const file = path.join(env.dataDir, "runs.json");
  await writeFile(`${file}.tmp`, JSON.stringify(runs), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}
export async function listRuns(): Promise<Run[]> {
  await ready();
  const data = pool
    ? (
        await pool.query(
          "SELECT body FROM prooflayer_runs ORDER BY body->>'createdAt' DESC LIMIT 100",
        )
      ).rows.map((r) => r.body as Run)
    : await localRead();
  return data.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function getRun(id: string): Promise<Run> {
  await ready();
  const run = pool
    ? (await pool.query("SELECT body FROM prooflayer_runs WHERE id=$1", [id]))
        .rows[0]?.body
    : (await localRead()).find((r) => r.id === id);
  if (!run) throw new Error("Run not found");
  return run;
}
export async function createRun(run: Run) {
  await ready();
  if (pool) {
    await pool.query("INSERT INTO prooflayer_runs(id, body) VALUES($1,$2)", [
      run.id,
      JSON.stringify(run),
    ]);
    return;
  }
  return serialize(async () => localWrite([run, ...(await localRead())]));
}
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn);
  queue = next.catch(() => {});
  return next;
}
export async function updateRun(
  id: string,
  change: (run: Run) => void,
): Promise<Run> {
  await ready();
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(
        "SELECT body FROM prooflayer_runs WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!found.rows[0]) throw new Error("Run not found");
      const run: Run = found.rows[0].body;
      change(run);
      run.updatedAt = new Date().toISOString();
      await client.query("UPDATE prooflayer_runs SET body=$2 WHERE id=$1", [
        id,
        JSON.stringify(run),
      ]);
      await client.query("COMMIT");
      return run;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  return serialize(async () => {
    const runs = await localRead(),
      run = runs.find((r) => r.id === id);
    if (!run) throw new Error("Run not found");
    change(run);
    run.updatedAt = new Date().toISOString();
    await localWrite(runs);
    return run;
  });
}
export function publicRun(run: Run): Run {
  const copy = structuredClone(run);
  delete copy.grant;
  return copy;
}
