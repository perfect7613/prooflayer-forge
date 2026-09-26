export const NOTE = `# A small claim, worth checking

Controlled benchmark note · Synthetic data · 200 binary predictions

Claim 01. The method improves binary F1 by 14 percentage points over the baseline.
Claim 02. F1 is the harmonic mean of precision and recall, as defined in the scikit-learn documentation.
Claim 03. For nonnegative confusion counts and a positive denominator, F1 lies between zero and one.

Protocol: positive label 1; binary averaging; zero denominator returns 0.
Artifact scope: saved predictions, not model retraining. These data demonstrate a review workflow and do not represent a published research result.
Reference: https://scikit-learn.org/stable/modules/generated/sklearn.metrics.f1_score.html`;
export interface Row {
  id: number;
  label: number;
  baseline: number;
  method: number;
}
export const rows: Row[] = Array.from({ length: 200 }, (_, i) => ({
  id: i + 1,
  label: i < 100 ? 1 : 0,
  baseline: i < 100 ? +(i < 71) : +(i < 129),
  method: i < 100 ? +(i < 81) : +(i < 119),
}));
export function metrics(input: Row[]) {
  const score = (key: "baseline" | "method") => {
    const tp = input.filter((r) => r.label === 1 && r[key] === 1).length;
    const fp = input.filter((r) => r.label === 0 && r[key] === 1).length;
    const fn = input.filter((r) => r.label === 1 && r[key] === 0).length;
    return { tp, fp, fn, f1: (2 * tp) / (2 * tp + fp + fn) || 0 };
  };
  const baseline = score("baseline"),
    method = score("method");
  return {
    baseline,
    method,
    absolutePoints: (method.f1 - baseline.f1) * 100,
    relativePercent: (method.f1 / baseline.f1 - 1) * 100,
    rows: input.length,
  };
}
export const EXAMPLE_PYTHON = `import json
from fractions import Fraction

rows = json.load(open("predictions.json"))
def f1(model):
    tp = sum(r["label"] == 1 and r[model] == 1 for r in rows)
    fp = sum(r["label"] == 0 and r[model] == 1 for r in rows)
    fn = sum(r["label"] == 1 and r[model] == 0 for r in rows)
    return Fraction(2 * tp, 2 * tp + fp + fn)

baseline, method = f1("baseline"), f1("method")
print(json.dumps({"baseline": float(baseline), "method": float(method),
    "absolutePoints": float(100 * (method - baseline)),
    "relativePercent": float(100 * (method - baseline) / baseline)}))`;
