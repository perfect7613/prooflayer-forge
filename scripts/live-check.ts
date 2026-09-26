import "../server/config";
import { DEMO_PAPER } from "../src/lib/papers";
import type { Run } from "../src/lib/types";
const base = process.env.PROOFLAYER_API_URL;
if (!base) throw new Error("Deploy with pnpm deploy:modal first");
async function request(path: string, body?: unknown, internal = false) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${process.env[internal ? "PROOFLAYER_MCP_TOKEN" : "PROOFLAYER_ACCESS_TOKEN"]}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(240000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
const action = process.argv[2] || "status";
if (action === "preflight") {
  console.log("health", await request("/health"));
  const check = await request("/judge", { task: "assess", claims: [{ id: "sanity", text: "Two plus two equals four.", evidence: [{ content: "Exact integer arithmetic: 2+2=4" }] }] }, true);
  console.log("Jev", { model: check.model, decisions: check.decisions });
  const sandbox = await request("/executor", { language: "python", code: `import json, os, socket, numpy as np
assert not any(os.getenv(k) for k in ['OPENAI_API_KEY', 'TYPESAFE_API_KEY', 'PROOFLAYER_ACCESS_TOKEN', 'MODAL_TOKEN_SECRET'])
blocked = False
try:
    socket.create_connection(('1.1.1.1', 443), timeout=2).close()
except OSError:
    blocked = True
assert blocked, 'Sandbox unexpectedly has external network access'
print(json.dumps({'numpy': np.__version__, 'sum': int(np.arange(5).sum()), 'secretsAbsent': True, 'networkBlocked': blocked}))` }, true);
  console.log("sandbox", sandbox);
  if (sandbox.exitCode !== 0) throw new Error("Sandbox isolation preflight failed");
} else if (action === "start") {
  const run: Run = await request("/control/runs", { title: DEMO_PAPER.title, paperUrl: DEMO_PAPER.url, note: DEMO_PAPER.brief, reproductionMode: "from_paper", mode: "live" });
  console.log(JSON.stringify({ id: run.id, phase: run.phase, error: run.error }));
} else if (action === "status") {
  const workspace = await request("/control/workspace");
  console.log(JSON.stringify({ model: workspace.model, connections: workspace.connections, runs: workspace.runs.map((r: Run) => ({ id: r.id, phase: r.phase, executions: r.executions, evidence: r.evidence.map(e => ({title:e.title,status:e.status})), claims: r.claims, protocol: r.phase === 'review' ? r.protocol : undefined, error: r.error, events: r.trace.slice(-3).map(t => ({type:t.type, detail:t.detail.slice(0,500)})) })) }, null, 2));
} else {
  throw new Error("Use preflight, start, or status. Protocol approval belongs in the review workspace.");
}
