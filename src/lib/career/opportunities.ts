import "server-only";

import { ActionError } from "@/lib/action";
import { profileForPrompt } from "@/lib/ai/tasks/prompt-parts";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { formatDateRange } from "@/lib/profile";
import { currentCareerPreferences, careerJobKey } from "./data";
import { opportunityContextSchema, opportunityInput } from "./opportunity-schema";
import type { z } from "zod";

export async function opportunityChoices() {
  const [applications, postings, candidates] = await Promise.all([
    prisma.application.findMany({ where: { archivedAt: null, postingText: { not: "" } }, orderBy: { updatedAt: "desc" }, take: 40, select: { id: true, title: true, company: true } }),
    prisma.posting.findMany({ where: { savedAt: { not: null }, dismissedAt: null, applicationId: null, description: { not: "" } }, orderBy: { savedAt: "desc" }, take: 30, select: { id: true, title: true, company: true } }),
    prisma.agentCandidate.findMany({ where: { status: "SCORED", applicationId: null, description: { not: "" } }, orderBy: [{ score: "desc" }, { updatedAt: "desc" }], take: 30, select: { id: true, title: true, company: true } }),
  ]);
  return [...applications, ...postings.map((row) => ({ ...row, id: `posting:${row.id}`, title: `${row.title} · saved job` })), ...candidates.map((row) => ({ ...row, id: `candidate:${row.id}`, title: `${row.title} · Agent` }))];
}

export async function createOpportunity(input: z.infer<typeof opportunityInput>) {
  const selection = input.applicationId;
  const saved = selection.startsWith("posting:") ? await prisma.posting.findUnique({ where: { id: selection.slice(8) } }) : selection.startsWith("candidate:") ? await prisma.agentCandidate.findUnique({ where: { id: selection.slice(10) } }) : null;
  const app = selection && !selection.includes(":") ? await prisma.application.findUnique({ where: { id: selection } }) : null;
  if (selection && !app && !saved) throw new ActionError("That saved opportunity no longer exists.");
  const posting = (app?.postingText ?? saved?.description ?? input.posting).trim().slice(0, 20000);
  if (posting.length < 80) throw new ActionError("Choose an application with a posting, or paste at least 80 characters of the opportunity.");
  if (input.companySource && !input.companySourceUrl) throw new ActionError("Add the source link for the company excerpt.");
  const [profile, preferences] = await Promise.all([loadProfile(), currentCareerPreferences()]);
  const context = opportunityContextSchema.parse({
    version: 1, capturedAt: new Date().toISOString(), applicationId: app?.id ?? "",
    title: app?.title || saved?.title || input.title || "Opportunity", company: app?.company || saved?.company || input.company,
    posting, url: app?.postingUrl || saved?.url || input.url, focus: input.focus,
    profile: profileForPrompt(profile).slice(0, 30000), preferences,
    evidence: [...profile.experience.slice(0, 25).map((row) => ({ id: `experience:${row.id}`, label: `${row.role} · ${row.company} · ${formatDateRange(row)}`, text: row.bullets.slice(0, 4000) })),
      ...profile.projects.slice(0, 25).map((row) => ({ id: `project:${row.id}`, label: `${row.name} · ${formatDateRange(row)}`, text: row.bullets.slice(0, 4000) }))],
    companySource: input.companySource, companySourceUrl: input.companySourceUrl,
  });
  return prisma.$transaction(async (tx) => {
    const session = await tx.careerSession.create({ data: { kind: "OPPORTUNITY", title: `${context.title}${context.company ? ` · ${context.company}` : ""}`.slice(0, 200), contextJson: JSON.stringify(context), linkedRecordId: app?.id,
      messages: { create: { ordinal: 0, role: "assistant", origin: "LOCAL", text: "I’ll compare this saved opportunity with your profile and reviewed preferences, identify useful examples and evidence gaps, and suggest questions to ask. The posting’s availability has not been rechecked." } } } });
    const message = await tx.careerMessage.create({ data: { sessionId: session.id, ordinal: 1, role: "user", origin: "BRIEF_REQUEST", text: "Prepare my opportunity briefing using the saved facts and sources." } });
    const job = await tx.job.create({ data: { type: "career-turn", key: careerJobKey(session.id), input: { sessionId: session.id, messageId: message.id, finishing: false } } });
    await tx.careerMessage.update({ where: { id: message.id }, data: { jobId: job.id } });
    return { id: session.id, jobId: job.id };
  });
}

export async function startInterviewPractice(briefingId: string) {
  const brief = await prisma.careerSession.findUnique({ where: { id: briefingId }, include: { messages: { orderBy: { ordinal: "asc" } } } });
  if (brief?.kind !== "OPPORTUNITY" || !brief.messages.some((row) => row.origin === "AI")) throw new ActionError("Complete an opportunity briefing before starting practice.");
  const context = opportunityContextSchema.parse(JSON.parse(brief.contextJson));
  const session = await prisma.careerSession.create({ data: { kind: "PRACTICE", title: `Interview · ${brief.title}`.slice(0, 200), contextJson: JSON.stringify(context), linkedRecordId: brief.id,
    messages: { create: { ordinal: 0, role: "assistant", origin: "LOCAL", text: `Let’s practice for ${context.title}${context.company ? ` at ${context.company}` : ""}. Start with a short introduction: what draws you to this role, and which experience best shows what you could bring? I’ll ask one question at a time and help you make your answers specific. Choose “Finish for review” for a debrief.` } } } });
  return { id: session.id };
}
