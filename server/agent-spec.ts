import { instructions } from "./instructions";
export function agentSpec(id: string, model: string) {
  return {
    model: {
      name: `openai/${model}`,
      params: { max_tokens: 24000, parallel_tool_calls: false, reasoning_effort: "high" },
    },
    instructions: instructions(id),
    mcp_servers: [
      {
        name: "prooflayer",
        enable_tools: ["@all"],
        require_approval_for_tools: ["approve_protocol"],
        preload: true,
      },
    ],
    config: {
      sandbox: { enabled: false },
      dynamic_sub_agents: { enabled: false },
      ask_user_questions: { enabled: false },
      generative_ui: { enabled: true },
      web_search: { enabled: false },
      context_management: {
        compaction: { enabled: true },
        large_tool_response: { enabled: false },
      },
      iteration_limit: 24,
    },
  };
}
