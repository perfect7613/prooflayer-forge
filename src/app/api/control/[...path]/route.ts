import { sameOrigin } from "../../../../../server/origin";
import { NextRequest } from "next/server";
export const runtime = "nodejs";
export const maxDuration = 300;
async function proxy(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  const safe = path.join("/");
  if (
    !/^(workspace|runs|runs\/[a-f0-9-]+\/(decision|export|cancel|presentation|review|restate))$/.test(safe)
  )
    return Response.json({ error: "Not found" }, { status: 404 });
  if (
    req.method !== "GET" &&
    !sameOrigin(req.headers.get("origin"), req.headers.get("host"))
  )
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  const base = (
    process.env.PROOFLAYER_API_URL || "http://127.0.0.1:8792"
  ).replace(/\/$/, "");
  try {
    const response = await fetch(`${base}/control/${safe}`, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.PROOFLAYER_ACCESS_TOKEN || ""}`,
      },
      ...(req.method === "GET" ? {} : { body: await req.text() }),
      cache: "no-store",
      signal: AbortSignal.timeout(230000),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return Response.json(
      {
        error:
          "Cannot reach the control service. Start pnpm dev or check the Modal deployment URL.",
      },
      { status: 503 },
    );
  }
}
export { proxy as GET, proxy as POST };
