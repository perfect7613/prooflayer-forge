"use client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useEffect, useState, useCallback } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  BookOpen,
  FlaskConical,
  FileText,
  Activity,
  Download,
  Check,
  ChevronRight,
  Layers,
  Settings2,
  X,
  ShieldCheck,
  Code2,
} from "lucide-react";
import type { Workspace as State, Run } from "@/lib/types";
import { GeneratedView } from "./generated-view";
import { JevReview } from "./jev-review";
import { DEMO_PAPER } from "@/lib/papers";
const labels = {
  supported: "Supported",
  contested: "Contested",
  inconclusive: "Not established",
};
const scopeLabels = {
  toy: "Formula or sample",
  saved_predictions: "Saved predictions",
  paper_subset: "Part of the paper",
  full: "Whole result",
};
export default function Workspace() {
  const [data, setData] = useState<State>();
  const [selected, setSelected] = useState<string>();
  const [tab, setTab] = useState("claims");
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(DEMO_PAPER.title),
    [paperUrl, setPaperUrl] = useState(DEMO_PAPER.url),
    [paperText, setPaperText] = useState(""),
    [pastePaper, setPastePaper] = useState(false),
    [note, setNote] = useState(DEMO_PAPER.brief),
    [mode, setMode] = useState<"from_paper" | "repository">("from_paper"),
    [repository, setRepository] = useState("");
  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/control/workspace");
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setData(d);
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), 4000);
    return () => clearInterval(timer);
  }, [reload]);
  const run = data?.runs.find((r) => r.id === selected) || data?.runs[0];
  async function action(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/control/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw Error(d.error);
      await reload();
      return d;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function create(fixture = false) {
    const r = await action("runs", {
      title,
      note,
      paperUrl: paperUrl || undefined,
      paperText: pastePaper ? paperText.trim() || undefined : undefined,
      reproductionMode: mode,
      repository: repository || undefined,
      mode: fixture ? "fixture" : "live",
    });
    if (r) {
      setSelected(r.id);
      setCreating(false);
      setTab("claims");
    }
  }
  function download(r: Run, format: "md" | "json") {
    const blob = new Blob(
      [
        format === "md"
          ? r.report || "Report pending"
          : JSON.stringify(r, null, 2),
      ],
      { type: format === "md" ? "text/markdown" : "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prooflayer-${r.id}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">
            <Layers size={22} />
          </span>
          prooflayer<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">
          RESEARCH WORKSPACE <span>01</span>
        </div>
        <button
          className="nav active"
          onClick={() => {
            setCreating(false);
            setSettings(false);
          }}
        >
          <BookOpen size={17} /> Investigations{" "}
          <span>{data?.runs.length || 0}</span>
        </button>
        <button className="nav" onClick={() => setSettings(true)}>
          <Settings2 size={17} /> Connections
        </button>
        <div className="sidebar-divider" />
        <div className="section-label">
          YOUR LOGBOOKS{" "}
          <button
            aria-label="New investigation"
            onClick={() => setCreating(true)}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="run-list">
          {data?.runs.map((r) => (
            <button
              key={r.id}
              className={run?.id === r.id ? "run-link selected" : "run-link"}
              onClick={() => {
                setSelected(r.id);
                setCreating(false);
                setTab("claims");
              }}
            >
              <span className={`dot ${r.phase}`} />
              <span>{r.title}</span>
            </button>
          ))}
          {!data?.runs.length && (
            <p className="quiet">Your first investigation starts here.</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="harness-icon">
            <Activity size={16} />
          </div>
          <div>
            Powered by TrueForge
            <small>
              {data?.hosted
                ? "Modal runtime connected"
                : "Local preview · no API usage"}
            </small>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <div className="breadcrumbs">
            Workspace <ChevronRight size={13} /> <span>Investigations</span>
          </div>
          <button className="button small" onClick={() => setCreating(true)}>
            <Plus size={15} /> New investigation
          </button>
        </header>
        {error && (
          <div role="alert" className="error">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={15} />
            </button>
          </div>
        )}
        <div className="content">
          <div className="eyebrow">
            <span className="dot completed" /> EVIDENCE BEFORE CONFIDENCE
          </div>
          <div className="page-heading">
            <div>
              <h1>Research, checked.</h1>
              <p>From a paper’s claims to evidence you can inspect.</p>
            </div>
            <span className="edition">
              THE REPRODUCTION DESK
              <br />
              VOL. 001 / WORKSPACE
            </span>
          </div>
          {!run && !creating ? (
            <>
              <section className="welcome">
                <div>
                  <span className="eyebrow">START WITH A QUESTION</span>
                  <h2>
                    Does the result
                    <br />
                    hold up?
                  </h2>
                  <p>
                    Give the agent a paper. It builds an experiment, waits for
                    your review, then runs the code and records what it finds.
                  </p>
                  <button
                    className="button primary"
                    onClick={() => setCreating(true)}
                  >
                    Investigate a paper <ArrowUpRight size={17} />
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => create(true)}
                  >
                    Explore a key-free fixture <ArrowRight size={15} />
                  </button>
                </div>
                <div className="paper-illustration">
                  <div className="paper-sheet">
                    <span>RESEARCH NOTE / 01</span>
                    <h3>
                      A claim is only
                      <br />
                      the beginning.
                    </h3>
                    <div className="fake-lines">
                      <i />
                      <i />
                      <i />
                    </div>
                    <div className="mini-chart">
                      <svg
                        viewBox="0 0 230 100"
                        aria-label="Illustrative training and test loss curves"
                      >
                        <path d="M5 15 C35 15 25 83 70 86 S170 88 225 90" />
                        <path d="M5 22 C95 20 110 28 135 55 S160 86 225 90" />
                      </svg>
                    </div>
                    <div className="paper-stamp">
                      <Check size={14} /> TRACEABLE BY DESIGN
                    </div>
                  </div>
                  <div className="floating-note">
                    <Code2 size={17} />
                    <span>Paper → code → evidence</span>
                  </div>
                </div>
              </section>
              <div className="three-steps">
                {[
                  [
                    "01",
                    "Define the claim",
                    "Choose a precise result and a fair test.",
                  ],
                  [
                    "02",
                    "Review the experiment",
                    "Approve the protocol before code runs.",
                  ],
                  [
                    "03",
                    "Inspect the evidence",
                    "Read the results, source and limitations.",
                  ],
                ].map(([n, t, d]) => (
                  <div key={n}>
                    <span>{n}</span>
                    <h3>{t}</h3>
                    <p>{d}</p>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          {creating && (
            <section className="intake">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">NEW INVESTIGATION</span>
                  <h2>What should we reproduce?</h2>
                </div>
                <button
                  aria-label="Close new investigation"
                  onClick={() => setCreating(false)}
                >
                  <X size={20} />
                </button>
              </div>
              <div className="preset">
                <FlaskConical size={21} />
                <div>
                  <strong>Demo candidate: grokking in ridge regression</strong>
                  <p>
                    Independent code from the paper. CPU experiment. Existing
                    external logbook available.
                  </p>
                </div>
                <a
                  href={DEMO_PAPER.referenceLogbook}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open reference logbook"
                >
                  <ArrowUpRight size={19} />
                </a>
              </div>
              <label>
                Investigation title
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Paper URL{" "}
                <span>
                  arXiv HTML, OpenAI/Anthropic PDF, or leave blank and paste the source below
                </span>
                <input
                  value={paperUrl}
                  onChange={(e) => setPaperUrl(e.target.value)}
                  placeholder="https://arxiv.org/html/… or https://cdn.openai.com/…pdf"
                />
              </label>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setPastePaper((open) => !open);
                  setPaperText("");
                }}
              >
                {pastePaper ? "Use the URL only" : "Paste the paper instead of a URL"}
              </button>
              {pastePaper && (
                <label>
                  Paper source{" "}
                  <span>
                    Source text only, up to 100,000 characters. The task goes in the box below.
                  </span>
                  <textarea
                    rows={9}
                    maxLength={100000}
                    value={paperText}
                    onChange={(e) => setPaperText(e.target.value)}
                    placeholder="Paste the paper or the section that contains the equations."
                  />
                </label>
              )}
              <p className="public-notice">Public demo: submissions, protocols, code, and reports are visible to everyone. Each experiment pauses for approval before code runs.</p>
              <div className="mode-buttons">
                <button
                  className={mode === "from_paper" ? "chosen" : ""}
                  onClick={() => setMode("from_paper")}
                >
                  <Code2 size={18} />
                  <strong>Implement from the paper</strong>
                  <span>TrueForge writes the experiment code.</span>
                </button>
                <button
                  className={mode === "repository" ? "chosen" : ""}
                  onClick={() => setMode("repository")}
                >
                  <BookOpen size={18} />
                  <strong>Adapt existing code</strong>
                  <span>Supply a repository and commit.</span>
                </button>
              </div>
              {mode === "repository" && (
                <label>
                  Repository and commit
                  <input
                    value={repository}
                    onChange={(e) => setRepository(e.target.value)}
                    placeholder="owner/repo @ full commit SHA"
                  />
                </label>
              )}
              <label>
                What should the agent check?
                <span>The only task. Do not repeat it in the paper source.</span>
                <textarea
                  rows={7}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <div className="intake-footer">
                <span>
                  <ShieldCheck size={16} /> 6 bounded CPU executions · human
                  approval first
                </span>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => create()}
                >
                  Start investigation <ArrowRight size={16} />
                </button>
              </div>
            </section>
          )}
          {run && !creating && (
            <>
              <section className="run-heading">
                <div>
                  <div className="run-meta">
                    <span className="mono">
                      CASE {run.id.slice(0, 8).toUpperCase()}
                    </span>
                    <span className="tag">
                      {run.mode === "fixture"
                        ? "Synthetic fixture"
                        : run.reproductionMode === "from_paper"
                          ? "From-paper implementation"
                          : "Repository reproduction"}
                    </span>
                  </div>
                  <h2>{run.title}</h2>
                  <p>
                    {run.mode === "fixture"
                      ? "A transparent walkthrough. No model or cloud execution was used."
                      : "Every conclusion stays linked to its source, execution and scope."}
                  </p>
                </div>
                <span className={`status ${run.phase}`}>
                  <span className={`dot ${run.phase}`} />
                  {run.phase}
                </span>
              </section>
              <div className="stats">
                <div>
                  <span>CLAIMS CHECKED</span>
                  <strong>
                    {run.claims.length.toString().padStart(2, "0")}
                  </strong>
                </div>
                <div>
                  <span>EVIDENCE ITEMS</span>
                  <strong>
                    {run.evidence.length.toString().padStart(2, "0")}
                  </strong>
                </div>
                <div>
                  <span>SANDBOX EXECUTIONS</span>
                  <strong>
                    {run.executions.toString().padStart(2, "0")}
                    <small>/ 06</small>
                  </strong>
                </div>
                <div>
                  <span>REVIEW STATUS</span>
                  <strong className="stat-text">
                    {run.phase === "review"
                      ? "Needs your review"
                      : run.phase === "completed"
                        ? "Report ready"
                        : "In progress"}
                  </strong>
                </div>
              </div>
              {run.error && <div className="error">{run.error}</div>}
              {run.phase === "review" && (
                <section className="approval">
                  <div className="panel-heading">
                    <h3>
                      <ShieldCheck size={21} /> Your decision comes first
                    </h3>
                    <span className="tag">TRUEFORGE PAUSED</span>
                  </div>
                  <p>
                    The harness is waiting to run this experiment. Review the
                    scope, assumptions and resource limits.
                  </p>
                  <pre>{run.protocol}</pre>
                  <small className="mono">
                    Protocol SHA-256: {run.protocolHash}
                  </small>
                  <div className="approval-actions">
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() =>
                        action(`runs/${run.id}/decision`, {
                          allow: false,
                          protocolHash: run.protocolHash,
                        })
                      }
                    >
                      Decline
                    </button>
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() =>
                        action(`runs/${run.id}/decision`, {
                          allow: true,
                          protocolHash: run.protocolHash,
                        })
                      }
                    >
                      Approve experiment <ArrowRight size={15} />
                    </button>
                  </div>
                </section>
              )}
              <div className="tabs">
                {[
                  ["claims", "Claims", FlaskConical],
                  ["evidence", "Evidence", Layers],
                  ["logbook", "Logbook", Activity],
                  ["figures", "Figures", Activity],
                  ["review", "Jev review", ShieldCheck],
                  ["report", "Report", FileText],
                ].map(([id, label, Icon]) => {
                  const I = Icon as typeof Layers;
                  return (
                    <button
                      key={id as string}
                      className={tab === id ? "selected" : ""}
                      onClick={() => setTab(id as string)}
                    >
                      <I size={16} />
                      {label as string}
                    </button>
                  );
                })}
                <button
                  className="export"
                  onClick={() => download(run, "json")}
                >
                  <Download size={15} /> Export logbook
                </button>
              </div>
              {tab === "claims" && (
                <div className="claims">
                  {run.claims.length > 0 && (
                    <p className="public-notice">
                      {run.claims.filter((c) => c.verdict === "supported").length}{" "}
                      matched the recorded evidence.{" "}
                      {run.claims.filter((c) => c.verdict !== "supported").length}{" "}
                      were not established. A supported check is not a proof of the paper&apos;s main theorem.
                    </p>
                  )}
                  {(["supported", "open"] as const).map((group) => {
                    const items = run.claims.filter((c) =>
                      group === "supported"
                        ? c.verdict === "supported"
                        : c.verdict !== "supported",
                    );
                    if (!items.length) return null;
                    return (
                      <div key={group}>
                        <h3 className="claim-group">
                          {group === "supported"
                            ? "Matched the recorded evidence"
                            : "Not established"}
                        </h3>
                        {items.map((c) => {
                          const i = run.claims.findIndex((item) => item.id === c.id);
                          return (
                    <article key={c.id}>
                      <div className="claim-number">
                        {String(i + 1).padStart(2, "0")}
                      </div>
                      <div>
                        <div className="claim-top">
                          <span className="eyebrow">{c.kind} CLAIM</span>
                          <span className={`verdict ${c.verdict}`}>
                            {labels[c.verdict]}
                          </span>
                        </div>
                        <h3>{c.text}</h3>
                        <p>{c.explanation}</p>
                        <div className="claim-foot">
                          <span className="tag">
                            {scopeLabels[c.scope]}
                          </span>
                          <button onClick={() => setTab("evidence")}>
                            {c.evidenceIds.length} evidence item(s){" "}
                            <ArrowUpRight size={13} />
                          </button>
                        </div>
                      </div>
                    </article>
                          );
                        })}
                      </div>
                    );
                  })}
                  {!run.claims.length && (
                    <div className="empty">
                      <FlaskConical size={25} />
                      <h3>The investigation is underway</h3>
                      <p>
                        Claims appear here after the agent gathers and assesses
                        evidence.
                      </p>
                    </div>
                  )}
                </div>
              )}
              {tab === "evidence" && (
                <div className="evidence">
                  {run.evidence.map((e) => (
                    <details key={e.id}>
                      <summary>
                        <span className="tag">{e.kind}</span>
                        <strong>{e.title}</strong>
                        <span>{e.status}</span>
                      </summary>
                      <p>{e.summary}</p>
                      <small className="mono">Evidence ID {e.id}</small>
                      <small className="mono">SHA-256 {e.hash}</small>
                      {e.metadata && (
                        <div className="evidence-provenance">
                          {e.metadata.sourceEvidenceId != null && <span><strong>Code source:</strong> <code>{String(e.metadata.sourceEvidenceId)}</code></span>}
                          {e.metadata.sandboxId != null && <span><strong>Sandbox:</strong> <code>{String(e.metadata.sandboxId)}</code></span>}
                          {typeof e.metadata.exitCode === "number" && <span><strong>Exit code:</strong> <code>{String(e.metadata.exitCode)}</code></span>}
                          {typeof e.metadata.durationMs === "number" && <span><strong>Duration:</strong> <code>{String(e.metadata.durationMs)} ms</code></span>}
                          {e.metadata.leanRole != null && <span><strong>Lean check:</strong> <code>{e.metadata.leanRole === "claim" ? "claim statement" : "fixed contract"}</code></span>}
                          {e.metadata.statement != null && <span><strong>Statement:</strong> <code>{String(e.metadata.statement)}</code></span>}
                          {Array.isArray(e.metadata.axioms) && <span><strong>Axioms:</strong> <code>{e.metadata.axioms.map(String).join(", ") || "none"}</code></span>}
                        </div>
                      )}
                      {e.metadata?.language != null && e.metadata?.sourceEvidenceId == null && <div className="evidence-code-label">Generated source saved before execution</div>}
                      <pre>{e.content}</pre>
                    </details>
                  ))}
                  {!run.evidence.length && (
                    <div className="empty">No evidence collected yet.</div>
                  )}
                </div>
              )}
              {tab === "logbook" && (
                <div className="logbook">
                  {run.trace.map((t) => (
                    <details key={t.id}>
                      <summary>
                        <span className="mono">
                          {new Date(t.time).toLocaleTimeString()}
                        </span>
                        <strong>{t.title}</strong>
                      </summary>
                      <pre>{t.detail}</pre>
                    </details>
                  ))}
                  {!run.trace.length && (
                    <div className="empty">
                      Waiting for the first harness events.
                    </div>
                  )}
                </div>
              )}
              {tab === "figures" && <section><div className="panel-heading"><div><span className="eyebrow">GENERATED FROM EVIDENCE</span><h3>The experiment, in view</h3></div><button className="button small" disabled={busy || run.phase !== "completed" || run.presentationPending} onClick={() => action(`runs/${run.id}/presentation`, {})}>{busy || run.presentationPending ? "Generating figures…" : run.visuals?.length ? "Regenerate figures" : "Generate figures"}</button></div><GeneratedView run={run}/></section>}
              {tab === "review" && <JevReview run={run} busy={busy} onReview={() => action(`runs/${run.id}/review`, {})}/>}
              {tab === "report" && (
                <section className="report">
                  <div className="panel-heading">
                    <h3>Research report</h3>
                    <button
                      className="button small"
                      disabled={!run.report}
                      onClick={() => download(run, "md")}
                    >
                      <Download size={14} /> Download Markdown
                    </button>
                  </div>
                  <div className="report-prose"><Markdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={["img"]} components={{a:({children,href})=><a href={href} target="_blank" rel="noreferrer">{children}</a>}}>{run.report || "The report will be available when the investigation finishes."}</Markdown></div>
                </section>
              )}
            </>
          )}
          <footer>
            <span>ProofLayer / An independent look at the evidence</span>
            <span>Agent assessments · inspect before relying</span>
          </footer>
        </div>
      </main>
      {settings && (
        <div className="modal-backdrop" onClick={() => setSettings(false)}>
          <section
            className="connections"
            role="dialog"
            aria-modal="true"
            aria-label="Connections"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-heading">
              <h2>Connections</h2>
              <button
                aria-label="Close connections"
                onClick={() => setSettings(false)}
              >
                <X />
              </button>
            </div>
            {data?.connections.map((c) => (
              <div className="connection" key={c.name}>
                <span
                  className={`dot ${c.configured ? "completed" : "queued"}`}
                />
                <div>
                  <strong>{c.name}</strong>
                  <p>{c.detail}</p>
                </div>
              </div>
            ))}
            <p className="quiet">
              Credentials are configured on the server. See the repository
              README for Modal setup.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
