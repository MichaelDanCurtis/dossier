import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/route";
import { canonicalLinkedinJob, importLinkedinOpportunity, linkedinImportSchema } from "@/lib/linkedin-import";

const inputSchema = linkedinImportSchema.extend({ approved: z.literal(true) }).strict();
export const POST = route(async (request) => {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "Use JSON job details." }, { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "Review the job before saving." }, { status: 400 });
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 256 * 1024) return NextResponse.json({ error: "This job description is too large." }, { status: 413 }); parts.push(part.value); }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  let input;
  try { input = inputSchema.safeParse(JSON.parse(Buffer.concat(parts).toString("utf8"))); } catch { return NextResponse.json({ error: "Review the job fields and approve saving." }, { status: 400 }); }
  if (!input.success) return NextResponse.json({ error: "Review the role, company and full description (at least 80 characters), then approve saving." }, { status: 400 });
  try { canonicalLinkedinJob(input.data.url); } catch { return NextResponse.json({ error: "Use a LinkedIn job link starting https://www.linkedin.com/jobs/view/." }, { status: 400 }); }
  const posting = await importLinkedinOpportunity(input.data, "CareerAI Chrome extension · user-reviewed import");
  return NextResponse.json({ id: posting.id, saved: true }, { status: 200 });
});
