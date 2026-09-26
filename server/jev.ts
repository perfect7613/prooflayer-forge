import { z } from "zod";
import type { Claim, Evidence } from "../src/lib/types";
import { paperText } from "./source-text";
const decision = z.object({
  claimId: z.string(),
  choice: z.enum([
    "numerical",
    "citation",
    "formal",
    "unclear",
    "supports",
    "contradicts",
    "insufficient",
  ]),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.number().min(0).max(1)),
});
const result = z.object({
  task: z.enum(["route", "assess"]),
  model: z.string(),
  questionVersion: z.string(),
  stateHash: z.string(),
  durationMs: z.number(),
  decisions: z.array(decision),
  raw: z.unknown(),
});
export type JevResult = z.infer<typeof result>;
export async function askJev(
  task: "route" | "assess",
  claims: { id: string; text: string; scope?: string; evidence?: unknown[] }[],
): Promise<JevResult> {
  const base = process.env.PROOFLAYER_RUNTIME_URL || process.env.PROOFLAYER_PUBLIC_URL;
  if (!base) throw new Error("Jev requires the hosted Modal gateway");
  const response = await fetch(`${base.replace(/\/$/, "")}/judge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.PROOFLAYER_MCP_TOKEN}`,
    },
    body: JSON.stringify({ task, claims }),
    signal: AbortSignal.timeout(75000),
  });
  if (!response.ok)
    throw new Error(`Jev review unavailable (HTTP ${response.status})`);
  const data = result.parse(await response.json());
  if (
    data.task !== task ||
    data.decisions.length !== claims.length ||
    new Set(data.decisions.map((d) => d.claimId)).size !== claims.length ||
    claims.some((c) => !data.decisions.some((d) => d.claimId === c.id))
  )
    throw new Error("Jev response does not match submitted claims");
  return data;
}
export const REVIEW_POLICY = {
  version: "evidence-review-v3",
  threshold: 0.8,
  toyThreshold: 0.3,
  calibrated: false,
} as const;
export function storedAssessment(content: string): JevResult {
  return result.parse(JSON.parse(content));
}

function sourceExcerpts(content: string, claim: string) {
  const readable = paperText(content);
  if (readable.length <= 18000) return { content: readable, truncated: false, ranges: [[0, readable.length]] };
  const words = [...new Set(claim.toLowerCase().match(/[a-z0-9]{4,}/g) || [])];
  const chunks = Array.from({ length: Math.ceil(readable.length / 3000) }, (_, i) => {
    const start = i * 3000, text = readable.slice(start, start + 3000);
    return { start, text, score: words.reduce((n, w) => n + (text.toLowerCase().includes(w) ? 1 : 0), 0) };
  }).sort((a, b) => b.score - a.score || a.start - b.start).slice(0, 6).sort((a, b) => a.start - b.start);
  return { content: chunks.map(c => `[source characters ${c.start}-${c.start + c.text.length}]\n${c.text}`).join("\n\n"), truncated: true, ranges: chunks.map(c => [c.start, c.start + c.text.length]) };
}
export function reviewInput(claims: Claim[], evidence: Evidence[]) {
  return claims.map(c => ({
    id: c.id, text: c.text, scope: c.scope, kind: c.kind,
    evidence: c.evidenceIds.map(id => {
      const e = evidence.find(e => e.id === id);
      if (!e) throw Error("Unknown review evidence");
      const selected = e.kind === "citation" ? sourceExcerpts(e.content, c.text) : { content: e.content, truncated: false };
      // Retain complete execution JSON up to the bound; never send a broken JSON prefix.
      const oversized = selected.content.length > 65000;
      const code = evidence.find(source => source.id === e.metadata?.sourceEvidenceId);
      return { id: e.id, kind: e.kind, status: e.status, hash: e.hash,
        ...selected, content: oversized ? "Evidence exceeds review budget; inspect the full logbook. No evidence supplied." : selected.content,
        truncated: selected.truncated || oversized,
        ...(code ? { implementation: { id: code.id, hash: code.hash, content: code.content.length <= 20000 ? code.content : "Implementation exceeds review budget", truncated: code.content.length > 20000 } } : {}),
      };
    }),
  }));
}

function crossCheck(choice: string, confidence: number, extra: string) {
  return `Jev cross-check: ${choice} (answer confidence ${confidence.toFixed(2)}). ${extra}`;
}

export function reconcile(claims: Claim[], review?: JevResult): Claim[] {
  return claims.map((c) => {
    const d = review?.decisions.find((d) => d.claimId === c.id);
    if (c.verdict === "inconclusive") {
      if (!d) return c;
      return {
        ...c,
        explanation: `${c.explanation}\n${crossCheck(d.choice, d.confidence, "An inconclusive claim is not upgraded.")}`,
      };
    }
    const agrees =
      !!d &&
      ((c.verdict === "supported" && d.choice === "supports") ||
        (c.verdict === "contested" && d.choice === "contradicts"));
    const bar =
      c.scope === "toy" && c.verdict === "supported"
        ? REVIEW_POLICY.toyThreshold
        : REVIEW_POLICY.threshold;
    if (agrees && d.confidence >= bar) {
      if (d.confidence >= REVIEW_POLICY.threshold) return c;
      return {
        ...c,
        explanation: `${c.explanation}\n${crossCheck(d.choice, d.confidence, `Agreement is recorded. Confidence below ${REVIEW_POLICY.threshold.toFixed(2)} is not a probability the paper is correct.`)}`,
      };
    }
    const note = !d
      ? "Jev cross-check: unavailable; independent model review was not completed."
      : crossCheck(
          d.choice,
          d.confidence,
          c.scope === "toy" && c.verdict === "supported" && d.choice === "insufficient"
            ? "The claim as written was not accepted. Exponent or identity arithmetic in the explanation does not establish this statement."
            : "Requires human review.",
        );
    return { ...c, verdict: "inconclusive", explanation: `${c.explanation}\n${note}` };
  });
}
