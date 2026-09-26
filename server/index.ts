import { generatePresentation } from "./presentation";
import { reviewReport, restateReport } from "./report";
import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { env } from "./config";
import { authorized, hash, sourceUrl } from "./policy";
import { createRun, listRuns, getRun, updateRun, publicRun } from "./store";
import { startRun, refreshRun, decide, cancelRun } from "./harness";
import { mcpServer } from "./mcp";
import { metrics, rows, NOTE } from "../src/lib/fixture";
import type { Run } from "../src/lib/types";
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "200kb" }));
app.get("/health", (_req, res) => res.json({ ok: true, hosted: env.hosted }));
// Stateless MCP does not offer a server-initiated SSE channel.
app.get("/mcp", (_req, res) => res.sendStatus(405));
app.post("/mcp", async (req, res) => {
  if (
    !authorized(req.headers.authorization, process.env.PROOFLAYER_MCP_TOKEN)
  ) {
    res.sendStatus(401);
    return;
  }
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = mcpServer();
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.use("/control", (req, res, next) => {
  if (
    env.hosted &&
    !authorized(req.headers.authorization, process.env.PROOFLAYER_ACCESS_TOKEN)
  ) {
    res.sendStatus(401);
    return;
  }
  next();
});
app.get("/control/workspace", async (_req, res) => {
  const runs = await listRuns();
  await Promise.allSettled(
    runs
      .filter(
        (r) =>
          ["investigating", "completed"].includes(r.phase) && r.mode === "live",
      )
      .map((r) => refreshRun(r.id)),
  );
  res.json({
    runs: (await listRuns()).map(publicRun),
    model: env.model,
    hosted: env.hosted,
    connections: [
      {
        name: "TrueForge on Modal",
        configured: env.hosted,
        detail: env.hosted
          ? "Hosted runtime"
          : "Fixture mode. Connect a Modal deployment for live research.",
      },
      {
        name: "OpenAI",
        configured: !!process.env.OPENAI_API_KEY,
        detail: env.model,
      },
      {
        name: "Jev",
        configured: !!process.env.TYPESAFE_API_KEY,
        detail: process.env.TYPESAFE_MODEL || "jev-1.13.0",
      },
      {
        name: "Persistent storage",
        configured: env.hosted || !!process.env.DATABASE_URL,
        detail: process.env.DATABASE_URL ? "PostgreSQL" : env.hosted ? "Modal Volume" : "Local fixture files",
      },
    ],
  });
});
app.post("/control/runs/:id/presentation", async (req, res) => {
  res.json(publicRun(await generatePresentation(req.params.id)));
});
app.post("/control/runs/:id/review", async (req, res) => {
  res.json(publicRun(await reviewReport(req.params.id)));
});
app.post("/control/runs/:id/restate", async (req, res) => {
  res.json(publicRun(await restateReport(req.params.id)));
});
const input = z.object({
  title: z.string().min(1).max(160),
  note: z.string().min(20).max(25000),
  paperUrl: z.string().url().optional(),
  paperText: z.string().min(100).max(100000).optional(),
  repository: z.string().max(300).optional(),
  reproductionMode: z.enum(["from_paper", "repository"]).default("from_paper"),
  mode: z.enum(["fixture", "live"]).default("live"),
});
app.post("/control/runs", async (req, res) => {
  const data = input.parse(req.body);
  if (data.mode === "live" && !env.hosted) {
    res.status(503).json({
      error:
        "Connect the Modal deployment to run TrueForge. The local service supports fixtures only.",
    });
    return;
  }
  if (data.paperUrl) sourceUrl(data.paperUrl);
  if (data.mode === "live" && !data.paperUrl && !data.paperText) throw Error("Provide a paper URL or paste at least 100 characters of paper text.");
  const now = new Date().toISOString();
  const run: Run = {
    ...data,
    leanRequired: data.mode === "live",
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    phase: "queued",
    claims: [],
    evidence: [],
    trace: [],
    jobs: [],
    executions: 0,
  };
  if (data.mode === "fixture") {
    const result = metrics(rows);
    const content = JSON.stringify(result, null, 2);
    const eid = randomUUID();
    run.title = "A 14-point improvement?";
    run.note = NOTE;
    run.phase = "completed";
    run.evidence = [
      {
        id: eid,
        title: "Deterministic fixture calculation",
        kind: "reproduction",
        status: "passed",
        summary:
          "Computed locally from 200 synthetic predictions; no harness or sandbox used.",
        content,
        hash: hash(content),
        createdAt: now,
      },
    ];
    run.claims = [
      {
        id: "01",
        text: "The method improves F1 by 14 percentage points.",
        kind: "empirical",
        verdict: "contested",
        explanation:
          "0.71 to 0.81 is 10 percentage points, or approximately 14.08% relative improvement.",
        scope: "saved_predictions",
        evidenceIds: [eid],
      },
    ];
    run.report = `# Synthetic fixture review\n\nThis key-free walkthrough did not call TrueForge, OpenAI, Lean or Modal.\n\nThe generated predictions give F1 = 0.71 for the baseline and 0.81 for the method. The change is 10 percentage points, not 14. Relative improvement is approximately 14.08%.\n\nScope: saved synthetic predictions only. No model was trained and no published paper was reproduced.`;
    run.reportHash = hash(run.report);
    run.trace = [
      {
        id: randomUUID(),
        time: now,
        type: "fixture",
        title: "Local fixture calculated",
        detail: content,
      },
    ];
  }
  if (data.mode === "live" && data.paperText) {
    run.evidence.push({ id: randomUUID(), title: "Pasted paper text", kind: "citation", status: "passed", summary: "User-supplied source text; provenance not independently verified", content: data.paperText, hash: hash(data.paperText), createdAt: now });
  }
  await createRun(run);
  if (data.mode === "live")
    await startRun(run.id).catch((e) =>
      updateRun(run.id, (r) => {
        r.phase = "failed";
        r.error = String(e);
      }),
    );
  res.status(201).json(publicRun(await getRun(run.id)));
});
app.post("/control/runs/:id/decision", async (req, res) => {
  const body = z
    .object({ allow: z.boolean(), protocolHash: z.string().length(64) })
    .parse(req.body);
  await decide(String(req.params.id), body.allow, body.protocolHash);
  res.json(publicRun(await getRun(String(req.params.id))));
});
app.post("/control/runs/:id/cancel", async (req, res) =>
  res.json(publicRun(await cancelRun(String(req.params.id)))),
);
app.get("/control/runs/:id/export", async (req, res) =>
  res.json(publicRun(await getRun(String(req.params.id)))),
);
app.use(
  (
    error: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(400).json({ error: error.message });
  },
);
app.listen(env.port, "127.0.0.1", () =>
  console.log(`ProofLayer control service listening on ${env.port}`),
);

// Persist harness events even when the reviewer closes their browser.
let refreshing = false;
setInterval(async () => {
  if (!env.hosted || refreshing) return;
  refreshing = true;
  try {
    const runs = await listRuns();
    await Promise.allSettled(
      runs
        .filter(
          (r) =>
            r.mode === "live" &&
            r.turnId &&
            r.syncedTurnId !== r.turnId &&
            ["investigating", "completed", "assessing"].includes(r.phase),
        )
        .map((r) => refreshRun(r.id)),
    );
  } catch {
    console.error("Harness refresh deferred; storage unavailable");
  } finally {
    refreshing = false;
  }
}, 5000).unref();
