import { NextResponse, type NextRequest } from "next/server";
import { route } from "@/lib/route";
import { ActionError } from "@/lib/action";
import { bridgeRequest } from "@/lib/studio/linkedin-bridge";

const allowed = new Set(["status", "open", "close", "screen", "input", "collect", "stop", "disconnect"]);
async function input(request: Request) {
  let size = 0; const parts: Uint8Array[] = [];
  const reader = request.body?.getReader();
  if (!reader) return {};
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 16 * 1024 * 1024) throw new ActionError("The browser request is too large."); parts.push(part.value); }
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
async function handler(request: NextRequest, { params }: RouteContext<"/api/linkedin/bridge/[operation]">) {
  const { operation } = await params;
  if (!allowed.has(operation) || request.method !== (operation === "status" ? "GET" : "POST")) return NextResponse.json({ error: "Unknown browser operation." }, { status: 404 });
  try { return NextResponse.json(await bridgeRequest("/" + operation, operation === "status" ? undefined : await input(request))); }
  catch (error) { return NextResponse.json({ error: error instanceof ActionError ? error.message : "The browser operation could not be completed." }, { status: 400 }); }
}
export const GET = route(handler);
export const POST = route(handler);
