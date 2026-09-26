import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Run } from "../src/lib/types";
vi.mock("../src/lib/modal-client", () => ({
  executeOnModal: vi.fn(async () => ({
    stdout: '{"difference":10}',
    stderr: "",
    exitCode: 0,
    sandboxId: "mock-sandbox",
    durationMs: 12,
  })),
}));
vi.mock("../server/jev", async (original) => ({
  ...(await original<typeof import("../server/jev")>()),
  askJev: vi.fn(async () => ({
    task: "assess",
    model: "jev-mock",
    questionVersion: "test",
    stateHash: "a".repeat(64),
    durationMs: 1,
    decisions: [
      {
        claimId: "c1",
        choice: "supports",
        confidence: 0.99,
        probabilities: { supports: 0.99, contradicts: 0.01 },
      },
    ],
    raw: {},
  })),
}));
let directory: string;
let client: Client;
let store: typeof import("../server/store");
let server: ReturnType<(typeof import("../server/mcp"))["mcpServer"]>;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "prooflayer-test-"));
  vi.stubEnv("PROOFLAYER_DATA_DIR", directory);
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("PROOFLAYER_HOSTED", "false");
  store = await import("../server/store");
  const { mcpServer } = await import("../server/mcp");
  server = mcpServer();
  client = new Client({ name: "integration-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
});
afterAll(async () => {
  await client?.close();
  await server?.close();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
it("enforces approval through real MCP transport, saves code/output, and runs the separate Jev report check", async () => {
  const id = randomUUID(),
    now = new Date().toISOString();
  await store.createRun({
    id,
    title: "Test",
    mode: "live",
    reproductionMode: "from_paper",
    leanRequired: true,
    note: "Test paper",
    createdAt: now,
    updatedAt: now,
    phase: "investigating",
    claims: [],
    evidence: [],
    trace: [],
    jobs: [],
    executions: 0,
  });
  const exec = {
    name: "execute_python",
    arguments: {
      runId: id,
      code: 'print("measured result")',
      purpose: "Test actual execution boundary",
    },
  };
  expect((await client.callTool(exec)).isError).toBe(true);
  await client.callTool({
    name: "propose_protocol",
    arguments: {
      runId: id,
      protocol:
        "Measure the claim using fixed input data, seed 7, an independent baseline, matching units, a numerical tolerance of 1e-8, and a 180 second CPU budget.",
    },
  });
  const proposed = await store.getRun(id);
  expect(
    (
      await client.callTool({
        name: "approve_protocol",
        arguments: { runId: id, protocolHash: proposed.protocolHash },
      })
    ).isError,
  ).toBe(true);
  // Simulate only the human control-plane decision. External providers are mocked.
  await store.updateRun(id, (r) => {
    r.grant = {
      reportHash: r.protocolHash!,
      expiresAt: Date.now() + 60000,
      used: false,
      toolCallId: "approval-test",
    };
  });
  expect((await client.callTool(exec)).isError).not.toBe(true);
  const executed = await store.getRun(id);
  expect(executed.executions).toBe(1);
  expect(executed.evidence).toHaveLength(2);
  const artifact = executed.evidence.find((e) => e.metadata?.sandboxId)!;
  const missingLeanSkill = await client.callTool({name:"check_lean_contract",arguments:{runId:id,proof:"omega"}});
  expect(missingLeanSkill.isError).toBe(true);
  const leanSkill = await client.callTool({name:"load_lean_skill",arguments:{runId:id}});
  expect(leanSkill.isError).not.toBe(true);
  const lean = await client.callTool({name:"check_lean_contract",arguments:{runId:id,proof:"omega"}});
  expect(lean.isError).not.toBe(true);
  expect((await store.getRun(id)).evidence.some(e=>e.kind === "lean" && e.status === "passed")).toBe(true);
  const unstyledReport = await client.callTool({
    name: "write_report",
    arguments: {runId:id, report:"Measured result with explicit scope. ".repeat(8), claims:[{id:"c1",text:"The difference is 10",kind:"empirical",verdict:"supported",explanation:"Measured",scope:"toy",evidenceIds:[artifact.id]}]},
  });
  expect(unstyledReport.isError).toBe(true);
  expect((await store.getRun(id)).phase).not.toBe("completed");
  const skill = await client.callTool({name:"load_humanizer_skill",arguments:{runId:id}});
  expect(skill.isError).not.toBe(true);
  expect((await store.getRun(id)).trace.some(t=>t.type === "skill.loaded")).toBe(true);
  const report = await client.callTool({
    name: "write_report",
    arguments: {
      runId: id,
      report:
        "Scope: controlled integration test with mocked cloud providers. ".repeat(
          5,
        ),
      claims: [
        {
          id: "c1",
          text: "The difference is 10",
          kind: "empirical",
          verdict: "supported",
          explanation: "Measured difference from execution",
          scope: "toy",
          evidenceIds: [artifact.id],
        },
      ],
    },
  });
  expect(report.isError).not.toBe(true);
  const finished = await store.getRun(id);
  expect(finished.phase).toBe("completed");
  expect(finished.evidence.at(-1)?.kind).toBe("jev");
  expect(finished.report).toContain("jev-mock");
  expect((await client.callTool(exec)).isError).toBe(true);
});
