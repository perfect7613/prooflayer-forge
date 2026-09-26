import { randomUUID } from "node:crypto";
import type { Claim, Run, Evidence } from "../src/lib/types";
import { hash } from "./policy";
import { updateRun } from "./store";
import { askJev, reconcile, reviewInput, storedAssessment, type JevResult, REVIEW_POLICY } from "./jev";
export function validateClaims(run: Run, claims: Claim[]) {
  if (new Set(claims.map((c) => c.id)).size !== claims.length)
    throw new Error("Claim IDs must be unique");
  for (const c of claims) {
    if (c.evidenceIds.length > 3)
      throw new Error("Use at most three focused evidence items per claim");
    if (c.evidenceIds.some((id) => !run.evidence.some((e) => e.id === id)))
      throw new Error("Unknown evidence reference");
    if (
      c.verdict !== "inconclusive" &&
      c.kind !== "citation" &&
      !c.evidenceIds.some((id) =>
        run.evidence.some(
          (e) => e.id === id && e.metadata?.sandboxId && e.status === "passed",
        ),
      )
    )
      throw new Error(
        "A scientific verdict requires a successful, inspected execution",
      );
    if (c.verdict === "supported" && c.scope === "full")
      throw new Error("Do not mark the paper's full result supported");
    if (c.kind === "formal" && c.verdict !== "inconclusive") {
      const proof = c.evidenceIds
        .map((id) => run.evidence.find((e) => e.id === id))
        .find(
          (e) =>
            e?.kind === "lean" &&
            e.status === "passed" &&
            e.metadata?.leanRole === "claim" &&
            e.metadata?.sandboxId &&
            typeof e.metadata?.statement === "string" &&
            c.text.includes(e.metadata.statement),
        );
      if (!proof)
        throw new Error(
          "A formal verdict requires a compiled Lean statement quoted in the claim. The fixed arithmetic contract does not count.",
        );
    }
  }
}
export function renderReport(
  claims: Claim[],
  draft: string,
  review?: { model: string; questionVersion: string },
  failure?: string,
  note?: string,
) {
  const block = (c: Claim) =>
    `### ${c.id}: ${c.text}\n\nAssessment: **${c.verdict}**\nScope: ${c.scope}\n\n${c.explanation}\n\nEvidence: ${c.evidenceIds.join(", ")}`;
  const matched = claims.filter((c) => c.verdict === "supported");
  const open = claims.filter((c) => c.verdict !== "supported");
  return `# Research verification report

A supported claim is a check that matched the recorded evidence at the stated scope. It is not a proof of the paper's main theorem. An inconclusive claim was not established by this run.

## Checks that matched the evidence

${matched.length ? matched.map(block).join("\n\n") : "None. No recorded check was strong enough to mark supported."}

## Not established by this run

${open.length ? open.map(block).join("\n\n") : "None."}

## Jev cross-check

${review ? `Model: ${review.model}. Question version: ${review.questionVersion}. Results describe answer distributions, not the probability the paper is correct. A toy formula or sample can stay supported when the cross-check also selects supports. A paper-level claim still needs confidence at least ${REVIEW_POLICY.threshold}. An inconclusive verdict is never upgraded.` : failure}${note ? `\n\n${note}` : ""}

## Original agent analysis

The draft below is the agent's prose before reconciliation. Where a structured assessment above differs, the structured assessment is the verdict.

${draft}`;
}
export async function finishReport(id: string, claims: Claim[], draft: string) {
  const run = await updateRun(id, (r) => {
    if (r.phase !== "investigating") throw new Error("Run not active");
    validateClaims(r, claims);
    r.phase = "assessing";
  });
  let review: JevResult | undefined;
  let failure: string | undefined;
  try {
    const inputs = reviewInput(claims, run.evidence);
    // Separate requests keep each decision focused; preserve every response, never retry for confidence.
    const results = await Promise.all(inputs.map(c => askJev("assess", [c])));
    review = { task: "assess", model: [...new Set(results.map(r => r.model))].join(", "),
      questionVersion: results[0].questionVersion, stateHash: hash(JSON.stringify(inputs)),
      durationMs: Math.max(...results.map(r => r.durationMs)),
      decisions: results.flatMap(r => r.decisions), raw: { policy: REVIEW_POLICY, reviews: results, inputs } };
  } catch {
    failure =
      "Jev evidence review could not be completed. No positive verification is inferred.";
  }
  const content = JSON.stringify(
    review || { status: "unavailable", error: failure },
  );
  const check: Evidence = {
    id: randomUUID(),
    title: "Jev evidence-support cross-check",
    kind: "jev",
    status: review ? "passed" : "unresolved",
    summary: review
      ? `Reviewed by ${review.model}; answer confidence is not scientific certainty`
      : failure!,
    content,
    hash: hash(content),
    createdAt: new Date().toISOString(),
  };
  const finalClaims = reconcile(claims, review).map((c) => ({
    ...c,
    evidenceIds: [...c.evidenceIds, check.id],
  }));
  const report = renderReport(finalClaims, draft, review, failure);
  return updateRun(id, (r) => {
    if (r.phase !== "assessing") throw new Error("Run closed during review");
    r.evidence.push(check);
    r.claims = finalClaims;
    r.agentClaims = claims;
    r.agentDraft = draft;
    r.report = report;
    r.reportHash = hash(report);
    r.phase = "completed";
  });
}

export async function reviewReport(id: string) {
  const current = await updateRun(id, r => {
    if (r.phase !== 'completed' || r.presentationPending) throw Error('Wait for the current task to finish');
    if ((r.reportHistory?.length || 0) >= 2) throw Error('Two additional reviews allowed; do not retry for a preferred verdict');
    if (!r.agentClaims || !r.agentDraft) {
      // Older runs predate separate draft storage; recover the original tool arguments from the audit trail.
      for (const trace of r.trace) {
        try {
          const event = JSON.parse(trace.detail);
          for (const call of event.tool_calls || []) {
            if (call.function?.name === 'write_report') {
              const args = JSON.parse(call.function.arguments);
              r.agentClaims = args.claims; r.agentDraft = args.report;
            }
          }
        } catch { /* Truncated events are not usable draft provenance. */ }
      }
    }
    if (!r.agentClaims || !r.agentDraft) throw Error('Original structured draft unavailable; start a new investigation');
    r.reportHistory ||= [];
    r.reportHistory.push({report:r.report!,hash:r.reportHash,time:new Date().toISOString()});
    r.phase = 'investigating';
  });
  return finishReport(id, current.agentClaims!, current.agentDraft!);
}

export async function restateReport(id: string) {
  return updateRun(id, (r) => {
    if (r.phase !== "completed" || r.presentationPending)
      throw new Error("Wait for the current task to finish");
    if (!r.agentClaims || !r.agentDraft)
      throw new Error("Original structured draft unavailable");
    const jev = [...r.evidence].reverse().find((e) => e.kind === "jev" && e.status === "passed");
    if (!jev) throw new Error("No stored Jev review to restate");
    const parsed = storedAssessment(jev.content);
    if (parsed.task !== "assess") throw new Error("Stored Jev item is not an assessment");
    r.claims = reconcile(r.agentClaims, parsed).map((c) => ({
      ...c,
      evidenceIds: c.evidenceIds.includes(jev.id) ? c.evidenceIds : [...c.evidenceIds, jev.id],
    }));
    r.report = renderReport(
      r.claims,
      r.agentDraft,
      parsed,
      undefined,
      "Restated from the stored cross-check. No new model call was made.",
    );
    r.reportHash = hash(r.report);
    r.trace.push({
      id: randomUUID(),
      time: new Date().toISOString(),
      type: "report.restated",
      title: "Claims restated from the stored review",
      detail: r.reportHash,
    });
  });
}
