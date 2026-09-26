import { it, expect } from "vitest";
import { AgentSpecSchema } from "@truefoundry/trueforge-core/agent-session";
import { agentSpec } from "../server/agent-spec";
it("validates against pinned TrueForge and gates approval without enabling its native sandbox", () => {
  const spec = AgentSpecSchema.parse(agentSpec("case-id", "gpt-6-astra"));
  expect(spec.config.sandbox.enabled).toBe(false);
  expect(spec.config.generative_ui.enabled).toBe(true);
  expect(spec.config.dynamic_sub_agents.enabled).toBe(false);
  expect(spec.config.context_management.large_tool_response.enabled).toBe(
    false,
  );
  expect(spec.mcp_servers?.[0].require_approval_for_tools).toEqual([
    "approve_protocol",
  ]);
});
