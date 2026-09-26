// The gateway creates a fresh, credential-free Modal Sandbox for each call.
export async function executeOnModal(
  code: string,
  language: "python" | "lean",
) {
  const url = process.env.PROOFLAYER_RUNTIME_URL || process.env.PROOFLAYER_PUBLIC_URL;
  if (!url) throw new Error("Modal deployment is not configured.");
  const response = await fetch(`${url.replace(/\/$/, "")}/executor`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.PROOFLAYER_MCP_TOKEN}`,
    },
    body: JSON.stringify({ code, language }),
    signal: AbortSignal.timeout(210_000),
  });
  if (!response.ok)
    throw new Error(`Modal execution failed (${response.status})`);
  return (await response.json()) as {
    stdout: string;
    stderr: string;
    exitCode: number;
    sandboxId: string;
    durationMs: number;
  };
}
