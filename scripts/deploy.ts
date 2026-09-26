import { config, parse } from "dotenv";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
config({ path: ".env", quiet: true });
for (const key of ["OPENAI_API_KEY", "TYPESAFE_API_KEY"])
  if (!process.env[key]) throw new Error(`Set ${key} in .env first`);
const source = readFileSync(".env", "utf8");
const values = parse(source);
for (const key of ["PROOFLAYER_ACCESS_TOKEN", "PROOFLAYER_MCP_TOKEN"])
  values[key] ||= randomBytes(32).toString("hex");
values.OPENAI_MODEL ||= "gpt-6-sol";
values.TYPESAFE_MODEL ||= "jev-1.13.0";
function save() {
  writeFileSync(".env", Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n", { mode: 0o600 });
  chmodSync(".env", 0o600);
}
save();
function run(args: string[], capture = false) {
  const result = spawnSync("uv", args, { encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.status !== 0) throw new Error(`uv ${args.slice(0, 3).join(" ")} failed`);
  return result.stdout?.trim();
}
const temporary = mkdtempSync(join(tmpdir(), "prooflayer-deploy-"));
try {
  const secretPath = join(temporary, "secrets.json");
  const keys = ["OPENAI_API_KEY", "OPENAI_MODEL", "TYPESAFE_API_KEY", "TYPESAFE_MODEL", "PROOFLAYER_ACCESS_TOKEN", "PROOFLAYER_MCP_TOKEN"];
  writeFileSync(secretPath, JSON.stringify(Object.fromEntries(keys.map(k => [k, values[k]]))), { mode: 0o600 });
  run(["run", "modal", "secret", "create", "prooflayer-runtime", "--from-json", secretPath, "--force"]);
  // A single writer owns the state volume. Never overlap old and new containers.
  run(["run", "modal", "deploy", "--strategy", "recreate", "modal/app.py"]);
  const endpoint = run(["run", "python", "-c", 'import modal; print(modal.Function.from_name("prooflayer-forge", "web").get_web_url())'], true);
  if (!endpoint?.startsWith("https://")) throw new Error("Deployment did not return an HTTPS endpoint");
  values.PROOFLAYER_API_URL = endpoint;
  save();
  let ready = false;
  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(5000) });
      if (response.ok && (await response.json()).ok) { ready = true; break; }
    } catch { /* Cold startup may still be in progress. */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error("Deployment created but health check failed. Inspect: uv run modal app logs prooflayer-forge");
  console.log(`Backend deployed: ${endpoint}\n.env updated. Restart pnpm dev to connect the review workspace.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
