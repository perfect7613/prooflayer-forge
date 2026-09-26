import { describe, it, expect } from "vitest";
import {
  authorized,
  axiomReport,
  claimProofSource,
  hash,
  leanSource,
  requireGrant,
  sourceUrl,
  isPdfSource,
} from "../server/policy";
import { validateClaims } from "../server/report";
import type { Evidence, Run } from "../src/lib/types";
import { metrics, rows } from "../src/lib/fixture";
describe("execution boundaries", () => {
  it("rejects execution before review, after expiry and after protocol changes", () => {
    const r = { phase: "investigating", protocolHash: hash("first") };
    expect(() => requireGrant(r)).toThrow();
    expect(() =>
      requireGrant({
        ...r,
        grant: { reportHash: hash("other"), expiresAt: Date.now() + 1000 },
      }),
    ).toThrow();
    expect(() =>
      requireGrant({
        ...r,
        grant: { reportHash: r.protocolHash, expiresAt: 0 },
      }),
    ).toThrow();
    expect(() =>
      requireGrant({
        ...r,
        phase: "denied",
        grant: { reportHash: r.protocolHash, expiresAt: Date.now() + 10000 },
      }),
    ).toThrow();
    expect(() =>
      requireGrant({
        ...r,
        grant: { reportHash: r.protocolHash, expiresAt: Date.now() + 10000 },
      }),
    ).not.toThrow();
  });
  it("rejects private endpoints, redirect entrypoints and mutable repository refs", () => {
    for (const url of [
      "http://127.0.0.1",
      "https://169.254.169.254",
      "https://arxiv.org.evil.test/x",
      "https://u:p@arxiv.org/a",
      "https://raw.githubusercontent.com/owner/repo/main/a.py",
    ])
      expect(() => sourceUrl(url)).toThrow();
    expect(sourceUrl("https://arxiv.org/html/2601.19791v1").hostname).toBe(
      "arxiv.org",
    );
    expect(sourceUrl("https://cdn.openai.com/pdf/example.pdf").hostname).toBe("cdn.openai.com");
    expect(sourceUrl("https://papers.anthropic.com/example.pdf").hostname).toBe("papers.anthropic.com");
    expect(isPdfSource(new URL("https://cdn.openai.com/pdf/example.pdf"))).toBe(true);
    expect(isPdfSource(new URL("https://arxiv.org/html/2601.19791v1"))).toBe(false);
  });
  it("requires nonempty exact bearer tokens", () => {
    expect(authorized("Bearer abc", "abc")).toBe(true);
    expect(authorized("Bearer ab", "abc")).toBe(false);
    expect(authorized("Bearer ", "")).toBe(false);
  });
  it("rejects injected Lean declarations and proof holes", () => {
    for (const proof of [
      "sorry",
      "omega\naxiom falsehood : False",
      "by native_decide",
    ])
      expect(() => leanSource(proof)).toThrow();
    expect(leanSource("omega")).toContain("#print axioms confusion_bound");
  });
  it("builds one claim proof and rejects holes, extra axioms, and the fixed contract as paper proof", () => {
    const built = claimProofSource("bounds", "∀ n : Nat, n + 0 = n", "simp");
    expect(built.theorem).toBe("claim_bounds");
    expect(built.source).toContain("#print axioms claim_bounds");
    expect(built.source).not.toContain("sorry");
    for (const [statement, proof] of [
      ["True", "sorry"],
      ["True", "axiom bogus : False\ntrivial"],
      ["True := by trivial", "trivial"],
    ] as const)
      expect(() => claimProofSource("bounds", statement, proof)).toThrow();
    expect(axiomReport("'claim_bounds' does not depend on any axioms", "claim_bounds").ok).toBe(true);
    expect(axiomReport("'claim_bounds' depends on axioms: [propext, Classical.choice]", "claim_bounds").ok).toBe(true);
    expect(axiomReport("'claim_bounds' depends on axioms: [sorry]", "claim_bounds").ok).toBe(false);
    const run = { evidence: [] } as unknown as Run;
    const contract: Evidence = {
      id: "contract",
      title: "contract",
      kind: "lean",
      status: "passed",
      summary: "",
      content: "",
      hash: "h",
      createdAt: "",
      metadata: { sandboxId: "sb", leanRole: "contract" },
    };
    const proof: Evidence = {
      id: "proof",
      title: "proof",
      kind: "lean",
      status: "passed",
      summary: "",
      content: "",
      hash: "h",
      createdAt: "",
      metadata: { sandboxId: "sb", leanRole: "claim", statement: "∀ n : Nat, n + 0 = n" },
    };
    const claim = {
      id: "bounds",
      text: "The sample satisfies ∀ n : Nat, n + 0 = n",
      kind: "formal" as const,
      verdict: "supported" as const,
      explanation: "Compiled statement",
      scope: "toy" as const,
      evidenceIds: ["contract"],
    };
    expect(() => validateClaims({ ...run, evidence: [contract] }, [claim])).toThrow(/fixed arithmetic/);
    expect(() => validateClaims({ ...run, evidence: [proof] }, [{ ...claim, evidenceIds: ["proof"] }])).not.toThrow();
  });
});
it("distinguishes percentage points from relative percentage", () => {
  const result = metrics(rows);
  expect(result.absolutePoints).toBeCloseTo(10);
  expect(result.relativePercent).toBeCloseTo(14.084507);
});
