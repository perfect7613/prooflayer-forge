import { it, expect } from "vitest";
import { reconcile, reviewInput, type JevResult } from "../server/jev";
import { sameOrigin } from "../server/origin";
import type { Claim } from "../src/lib/types";
const claims: Claim[] = [
  {
    id: "c1",
    text: "A measured result",
    kind: "empirical",
    verdict: "supported",
    explanation: "Agent interpretation",
    scope: "paper_subset",
    evidenceIds: [],
  },
];
const review = (choice: string, confidence: number) =>
  ({
    task: "assess",
    model: "jev-1.12",
    decisions: [{ claimId: "c1", choice, confidence, probabilities: {} }],
    questionVersion: "v1",
    stateHash: "x",
    durationMs: 1,
    raw: {},
  }) as JevResult;
it("keeps paper-level, missing and disagreeing reviews inconclusive", () => {
  expect(reconcile(claims)[0].verdict).toBe("inconclusive");
  expect(reconcile(claims, review("supports", 0.73))[0].verdict).toBe(
    "inconclusive",
  );
  expect(reconcile(claims, review("contradicts", 0.99))[0].verdict).toBe(
    "inconclusive",
  );
  expect(reconcile(claims, review("supports", 0.99))[0].verdict).toBe(
    "supported",
  );
  expect(
    reconcile(
      [{ ...claims[0], verdict: "inconclusive" }],
      review("supports", 0.99),
    )[0].verdict,
  ).toBe("inconclusive");
});
it("keeps a toy formula check supported when Jev also supports it", () => {
  const toy = [{ ...claims[0], scope: "toy" as const }];
  expect(reconcile(toy, review("supports", 0.32))[0].verdict).toBe("supported");
  expect(reconcile(toy, review("supports", 0.2))[0].verdict).toBe(
    "inconclusive",
  );
  expect(reconcile(toy, review("insufficient", 0.29))[0].verdict).toBe(
    "inconclusive",
  );
  expect(
    reconcile(
      [{ ...toy[0], verdict: "inconclusive" }],
      review("supports", 0.41),
    )[0].verdict,
  ).toBe("inconclusive");
});
it("matches browser origin to incoming host including loopback IP and port", () => {
  expect(sameOrigin("http://127.0.0.1:3000", "127.0.0.1:3000")).toBe(true);
  expect(sameOrigin("https://evil.test", "127.0.0.1:3000")).toBe(false);
  expect(sameOrigin(null, "127.0.0.1:3000")).toBe(false);
  expect(sameOrigin("null", "127.0.0.1:3000")).toBe(false);
});
