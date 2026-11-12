import { NextResponse } from "next/server";
import { ActionError } from "@/lib/action";
import { route } from "@/lib/route";
import { workspaceInput } from "@/lib/linkedin-workspace/schema";
import { handleWorkspace } from "@/lib/linkedin-workspace/service";

export const POST = route(async request => {
  const connectionId = request.headers.get("x-careerai-extension-id");
  if (process.env.DOSSIER_ACCOUNT_GATEWAY !== "on" || !/^[a-f0-9]{32}$/.test(connectionId || "")) return NextResponse.json({ error: "Use a paired LinkedIn workspace connection." }, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "Use JSON." }, { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "A request is required." }, { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 512 * 1024) return NextResponse.json({ error: "Capture a smaller batch." }, { status: 413 }); chunks.push(part.value); } }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  let input;
  try { input = workspaceInput.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { return NextResponse.json({ error: "The workspace request was not valid." }, { status: 400 }); }
  if (!input.success) return NextResponse.json({ error: "The workspace request was not valid." }, { status: 400 });
  try { return NextResponse.json(await handleWorkspace(input.data, connectionId!)); }
  catch (error) { if (error instanceof ActionError) return NextResponse.json({ error: error.message }, { status: 400 }); throw error; }
});
