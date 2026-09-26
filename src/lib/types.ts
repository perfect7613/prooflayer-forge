export type Verdict = "supported" | "contested" | "inconclusive";
export type Phase =
  | "queued"
  | "investigating"
  | "assessing"
  | "review"
  | "completed"
  | "denied"
  | "failed"
  | "cancelled";
export type Scope = "toy" | "saved_predictions" | "paper_subset" | "full";
export interface Claim {
  id: string;
  text: string;
  kind: "empirical" | "citation" | "formal";
  verdict: Verdict;
  explanation: string;
  scope: Scope;
  evidenceIds: string[];
}
export interface Evidence {
  id: string;
  title: string;
  kind: "python" | "citation" | "lean" | "reproduction" | "jev";
  status: "passed" | "failed" | "unresolved";
  summary: string;
  content: string;
  hash: string;
  createdAt: string;
  source?: string;
  metadata?: Record<string, unknown>;
}
export interface Trace {
  id: string;
  time: string;
  type: string;
  title: string;
  detail: string;
}
export interface PendingApproval {
  toolCallId: string;
  threadId: string;
  reportHash: string;
}
export interface Run {
  id: string;
  title: string;
  mode: "fixture" | "live";
  phase: Phase;
  reproductionMode: "from_paper" | "repository";
  /** Every hosted live investigation must complete the bounded Lean contract before reporting. */
  leanRequired?: boolean;
  paperUrl?: string;
  paperText?: string;
  repository?: string;
  createdAt: string;
  updatedAt: string;
  note: string;
  sessionId?: string;
  turnId?: string;
  syncedTurnId?: string;
  claims: Claim[];
  evidence: Evidence[];
  trace: Trace[];
  agentClaims?: Claim[];
  agentDraft?: string;
  reportHistory?: { report: string; hash?: string; time: string }[];
  visuals?: import('./visuals').GeneratedView[];
  presentationPending?: boolean;
  report?: string;
  reportHash?: string;
  pending?: PendingApproval;
  protocol?: string;
  protocolHash?: string;
  error?: string;
  jobs: string[];
  executions: number;
  grant?: {
    reportHash: string;
    expiresAt: number;
    used: boolean;
    toolCallId: string;
  };
}
export interface Connection {
  name: string;
  configured: boolean;
  detail: string;
}
export interface Workspace {
  runs: Run[];
  connections: Connection[];
  model: string;
  hosted: boolean;
}
