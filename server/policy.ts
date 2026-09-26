import { createHash, timingSafeEqual } from "node:crypto";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function authorized(
  header: string | undefined,
  token: string | undefined,
) {
  if (!token || !header) return false;
  const a = Buffer.from(header),
    b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function sourceUrl(input: string) {
  const url = new URL(input);
  const hosts = ["arxiv.org", "export.arxiv.org", "raw.githubusercontent.com", "cdn.openai.com", "openai.com", "anthropic.com"];
  const isAnthropic = url.hostname.endsWith(".anthropic.com");
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    !hosts.includes(url.hostname) && !isAnthropic
  )
    throw new Error(
      "Source must be an HTTPS arXiv, approved provider CDN, or commit-pinned raw GitHub URL.",
    );
  if (
    url.hostname === "raw.githubusercontent.com" &&
    !/^\/[^/]+\/[^/]+\/[a-f0-9]{40}\/.+/i.test(url.pathname)
  )
    throw new Error("Repository source must use a full commit SHA.");
  return url;
}
export function isPdfSource(url: URL) {
  return url.pathname.toLowerCase().endsWith(".pdf") ||
    ["cdn.openai.com", "openai.com", "anthropic.com"].includes(url.hostname) ||
    url.hostname.endsWith(".anthropic.com");
}
export function leanSource(proof: string) {
  if (!["omega", "simp +arith", "exact Nat.le_add_right _ _"].includes(proof))
    throw new Error(
      "Unsupported proof. This checker accepts only the fixed arithmetic contract.",
    );
  return `import Std\ntheorem confusion_bound (tp fp fn : Nat) : 2 * tp ≤ 2 * tp + fp + fn := by\n  ${proof}\n#print axioms confusion_bound\n`;
}
const LEAN_AXIOMS = new Set(["propext", "Classical.choice", "Quot.sound"]);
const LEAN_BANNED =
  /\b(sorry|admit|axiom|opaque|unsafe|native_decide)\b|\b(import|theorem|lemma|def|abbrev|inductive|structure|class|instance|namespace|example|constant)\b|#/;
export function claimProofSource(claimId: string, statement: string, proof: string) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(claimId))
    throw new Error("Claim id must be a short Lean identifier");
  const prop = statement.trim();
  const body = proof.trim();
  if (prop.length < 1 || prop.length > 1500)
    throw new Error("Lean statement must be 1–1500 characters");
  if (body.length < 1 || body.length > 8000)
    throw new Error("Lean proof must be 1–8000 characters");
  if (LEAN_BANNED.test(prop) || LEAN_BANNED.test(body) || prop.includes(":="))
    throw new Error(
      "The statement and proof must be one Std proposition. Declarations, imports, and proof holes are rejected.",
    );
  const theorem = `claim_${claimId}`;
  const indented = body
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  return {
    theorem,
    statement: prop,
    source: `import Std\ntheorem ${theorem} : ${prop} := by\n${indented}\n#print axioms ${theorem}\n`,
  };
}
export function axiomReport(stdout: string, theorem: string) {
  const line = stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.includes(`'${theorem}'`) || (s.includes(theorem) && /axiom/i.test(s)));
  if (!line) return { ok: false, axioms: [] as string[], reason: "Axiom report missing" };
  if (/does not depend on any axioms/.test(line))
    return { ok: true, axioms: [] as string[], reason: "" };
  const match = line.match(/\[([^\]]*)\]/);
  if (!match) return { ok: false, axioms: [] as string[], reason: "Unreadable axiom report" };
  const axioms = match[1].split(",").map((s) => s.trim()).filter(Boolean);
  const extra = axioms.filter((a) => !LEAN_AXIOMS.has(a));
  return { ok: extra.length === 0, axioms, reason: extra.join(", ") };
}
export function requireGrant(run: {
  grant?: { reportHash: string; expiresAt: number };
  protocolHash?: string;
  phase: string;
}) {
  if (
    !run.grant ||
    run.grant.reportHash !== run.protocolHash ||
    run.grant.expiresAt < Date.now() ||
    run.phase !== "investigating"
  )
    throw new Error(
      "A person must approve the current experiment protocol before execution.",
    );
}
