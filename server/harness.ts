import { extractViews } from "../src/lib/visuals";
import { randomUUID } from "node:crypto";
import { env } from "./config";
import { getRun, updateRun } from "./store";
import { agentSpec } from "./agent-spec";
export async function forge(path: string, body?: unknown, method = "POST") {
  const res = await fetch(`${env.harness}/api/v1${path}`, {
    method: body === undefined ? "GET" : method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TRUEFORGE_API_KEY}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok)
    throw new Error(
      `TrueForge ${res.status}: ${(await res.text()).slice(0, 500)}`,
    );
  return res.json();
}
export async function startRun(id: string) {
  const run = await getRun(id);
  const session = await forge("/sessions", {
    agent: { spec: agentSpec(id, env.model) },
  });
  await updateRun(id, (r) => {
    r.sessionId = session.data.id;
    r.phase = "investigating";
  });
  await turn(id, [
    {
      type: "user.message",
      content: JSON.stringify({
        runId: id,
        paper: run.paperUrl,
        pastedSourceEvidenceIds: run.evidence.filter(e => e.title === "Pasted paper text").map(e => e.id),
        repository: run.repository,
        mode: run.reproductionMode,
        task: run.note,
      }),
    },
  ]);
}
export async function turn(id: string, input: unknown[]) {
  const run = await getRun(id);
  const result = await forge(`/sessions/${run.sessionId}/turns`, {
    input,
    stream: false,
  });
  await updateRun(id, (r) => {
    r.turnId = result.data.id;
  });
}
const polling = new Set<string>();
export async function refreshRun(id: string) {
  if (polling.has(id)) return;
  polling.add(id);
  try {
    const run = await getRun(id);
    if (
      run.mode !== "live" ||
      !run.sessionId ||
      !run.turnId ||
      !["investigating", "assessing", "completed"].includes(run.phase)
    )
      return;
    if (run.syncedTurnId === run.turnId) return;
    const base = `/sessions/${run.sessionId}/turns/${run.turnId}`;
    const result = await forge(base);
    const events: any[] = [];
    let page: string | undefined;
    do {
      const batch = await forge(
        `${base}/events?limit=100${page ? `&page_token=${encodeURIComponent(page)}` : ""}`,
      );
      events.push(...batch.data);
      page = batch.pagination?.next_page_token;
    } while (page);
    await updateRun(id, (r) => {
      if (r.turnId !== run.turnId) return;
      if (result.data.state.status !== "running") r.syncedTurnId = run.turnId;
      for (const event of events) {
        const key = event.id || `${r.turnId}:${events.indexOf(event)}`;
        if (!r.trace.some((t) => t.id === key))
          r.trace.push({
            id: key,
            time: new Date().toISOString(),
            type: event.type,
            title: event.type,
            detail: JSON.stringify(event).slice(0, 24000),
          });
        if (event.type === "model.message" && typeof event.content === "string") {
          for (const [i, content] of extractViews(event.content).entries()) {
            const id = `${key}:view:${i}`;
            r.visuals ||= [];
            if (!r.visuals.some(v => v.id === id)) r.visuals.push({ id, content, createdAt: event.created_at || new Date().toISOString(), eventId: key, sessionId: r.sessionId });
          }
        }
        if (
          event.type === "tool.approval_required" &&
          !r.pending &&
          r.phase === "investigating"
        ) {
          const call = event.tool_calls?.[0];
          if (call && r.protocolHash) {
            r.pending = {
              toolCallId: call.id,
              threadId: event.thread_id,
              reportHash: r.protocolHash,
            };
            r.phase = "review";
          }
        }
      }
      if (["cancelled", "denied"].includes(r.phase)) return;
      if (r.turnId !== run.turnId) return;
      if (result.data.state.status === "cancelled") r.phase = "cancelled";
      if (result.data.state.status === "error") {
        r.phase = "failed";
        r.error = JSON.stringify(result.data.state.error);
      }
      if (
        result.data.state.status === "done" &&
        !r.pending &&
        !r.report &&
        r.phase !== "assessing"
      ) {
        r.phase = "failed";
        r.error = "Harness finished without a report. Inspect the logbook.";
      }
    });
  } finally {
    polling.delete(id);
  }
}
export async function decide(id: string, allow: boolean, expectedHash: string) {
  const run = await updateRun(id, (r) => {
    if (
      r.phase !== "review" ||
      !r.pending ||
      r.protocolHash !== expectedHash ||
      r.pending.reportHash !== expectedHash
    )
      throw new Error("The protocol changed. Reload and review it again.");
    r.grant = allow
      ? {
          reportHash: expectedHash,
          expiresAt: Date.now() + 60 * 60 * 1000,
          used: false,
          toolCallId: r.pending.toolCallId,
        }
      : undefined;
    r.phase = allow ? "investigating" : "denied";
    r.trace.push({
      id: randomUUID(),
      time: new Date().toISOString(),
      type: "human",
      title: allow ? "Protocol approved" : "Protocol declined",
      detail: `Decision binds to SHA-256 ${expectedHash}`,
    });
  });
  const pending = run.pending!;
  try {
    await turn(id, [
      {
        type: "user.tool_approval",
        thread_id: pending.threadId,
        tool_call_id: pending.toolCallId,
        approval: {
          status: allow ? "allow" : "deny",
          reason: allow
            ? "Experiment protocol reviewed in ProofLayer"
            : "Reviewer declined this protocol",
        },
      },
    ]);
    await updateRun(id, (r) => {
      delete r.pending;
    });
  } catch (error) {
    // A timeout may follow a successful submission. Do not automatically resubmit it.
    await updateRun(id, (r) => {
      delete r.grant;
      r.phase = "failed";
      r.error =
        "Approval resume could not be confirmed. Start a new investigation; the grant has been revoked.";
    });
    throw error;
  }
}

export async function cancelRun(id: string) {
  const run = await updateRun(id, (r) => {
    if (["completed", "cancelled", "denied", "failed"].includes(r.phase))
      throw new Error("Run is already closed");
    r.phase = "cancelled";
    delete r.grant;
    delete r.pending;
  });
  if (run.sessionId) await forge(`/sessions/${run.sessionId}/cancel`, {});
  return run;
}
