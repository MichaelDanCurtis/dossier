import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { ActionError } from "@/lib/action";
import { profileForPrompt } from "@/lib/ai/tasks/prompt-parts";
import { lockForTransaction } from "@/lib/db-lock";
import { prisma } from "@/lib/prisma";
import type { ProfileData } from "@/lib/profile";
import { loadProfile } from "@/lib/profile-data";
import { recordHash } from "@/lib/record-hash";

import { loadResumeContext, listResumeVariants, saveResumeVariant } from "@/lib/resume-variant-data";

import { careerReviewContext } from "./review-context";
import { careerKindSchema, careerPreferencesSchema, careerProposalSchema, type CareerKind, type CareerProposalInput, type CareerPreferences, type CareerSessionView } from "./schema";

const CAREER_LOCK = 1128354373;
export const careerJobKey = (sessionId: string) => `career:${sessionId}`;

export async function currentCareerPreferences(db: Prisma.TransactionClient = prisma): Promise<CareerPreferences | null> {
  const pointer = await db.setting.findUnique({ where: { key: "careerPreferencesId" } });
  if (!pointer?.value) return null;
  const row = await db.careerProposal.findFirst({ where: { id: pointer.value, kind: "PREFERENCES", status: "ACCEPTED" } });
  if (!row) return null;
  const parsed = careerPreferencesSchema.safeParse(JSON.parse(row.dataJson));
  return parsed.success ? parsed.data : null;
}

export async function listCareerSessions() {
  const rows = await prisma.careerSession.findMany({ take: 60, orderBy: { updatedAt: "desc" }, select: { id: true, title: true, kind: true, state: true, updatedAt: true } });
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
}

export async function loadCareerSession(id: string): Promise<CareerSessionView | null> {
  const row = await prisma.careerSession.findUnique({ where: { id }, include: { messages: { orderBy: { ordinal: "asc" } }, proposals: { orderBy: { createdAt: "desc" } } } });
  if (!row) return null;
  return {
    id: row.id, kind: careerKindSchema.parse(row.kind), title: row.title, state: row.state, revision: row.revision, createdAt: row.createdAt.toISOString(),
    messages: row.messages.map((message) => ({ id: message.id, role: message.role, origin: message.origin, text: message.text, createdAt: message.createdAt.toISOString() })),
    proposals: row.proposals.flatMap((proposal) => {
      const payload = careerProposalSchema.safeParse({ kind: proposal.kind, data: JSON.parse(proposal.dataJson) });
      return payload.success ? [{ id: proposal.id, revision: proposal.revision, status: proposal.status, payload: payload.data, evidence: JSON.parse(proposal.sourceMessageIdsJson) as string[], acceptedAt: proposal.acceptedAt?.toISOString() ?? null }] : [];
    }),
  };
}

export async function createCareerSession(kind: CareerKind, title: string, { periodKey, variantId }: { periodKey?: string; variantId?: string } = {}) {
  const profile = await loadProfile();
  const resume = kind === "COACH" ? await loadResumeContext(variantId) : null;
  const contextJson = resume ? JSON.stringify({ ...resume, profile: { ...resume.profile, photo: null } }) : kind === "REVIEW" ? await careerReviewContext() : profileForPrompt(profile);
  const first = kind === "COACH" ? `What would you like to improve in ${resume?.variantName ?? "your resume"}? We can work on clarity, evidence, relevance or whether it is up to date. Suggestions will appear beside the preview for you to accept.` : kind === "PROJECT"
    ? `Tell me about ${title || "the project"}. What did you personally build or change, and what was the outcome? You can add evidence links and dates as we go.`
    : kind === "REVIEW"
      ? "What has changed in your work or goals since your last check-in, and what would make the next opportunity worth pursuing?"
      : `Your resume${profile.experience[0]?.role ? ` includes ${profile.experience[0].role}` : " is our starting point"}. Which parts of your work would you like more of in your next job, and which would you leave behind?`;
  return prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, CAREER_LOCK);
    if (periodKey) {
      const existing = await tx.careerSession.findUnique({ where: { periodKey } });
      if (existing) return existing.id;
    }
    const session = await tx.careerSession.create({ data: { kind, title: title || (kind === "PROJECT" ? "Project update" : kind === "REVIEW" ? "Career review" : "Job preferences"), contextJson, periodKey, linkedRecordId: resume?.variantId, messages: { create: { ordinal: 0, role: "assistant", origin: "LOCAL", text: first } } } });
    return session.id;
  });
}

/** A user turn and its queued job commit together; retries reuse both identities. */
export async function addCareerAnswer(input: { sessionId: string; revision: number; requestId: string; text: string; finishing: boolean; skip: boolean }) {
  return prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, CAREER_LOCK);
    const session = await tx.careerSession.findUnique({ where: { id: input.sessionId } });
    if (!session) throw new ActionError("That career conversation no longer exists.");
    const repeated = await tx.careerMessage.findUnique({ where: { sessionId_requestId: { sessionId: session.id, requestId: input.requestId } } });
    if (repeated?.jobId) return { sessionId: session.id, jobId: repeated.jobId };
    if (session.revision !== input.revision) throw new ActionError("This conversation changed. Reload before answering again.");
    if (!["ACTIVE", "REVIEW"].includes(session.state)) throw new ActionError("Resume this conversation before answering.");
    const last = await tx.careerMessage.findFirst({ where: { sessionId: session.id }, orderBy: { ordinal: "desc" } });
    if (last?.role === "user") throw new ActionError("Your last answer is saved. Retry its response before adding another answer.");
    if ((last?.ordinal ?? 0) >= 120) throw new ActionError("This interview has reached its turn limit. Review it and start a fresh conversation.");
    const text = input.skip ? "[Skipped this question]" : input.text.trim() || (input.finishing ? "Please prepare a review from what I have told you, and leave unknown matters unanswered." : "");
    if (!text) throw new ActionError("Write an answer, skip this question, or finish for review.");
    const message = await tx.careerMessage.create({ data: { sessionId: session.id, ordinal: (last?.ordinal ?? -1) + 1, role: "user", origin: input.skip ? "SKIP" : input.finishing && !input.text.trim() ? "REVIEW_REQUEST" : "USER", text, requestId: input.requestId, finishing: input.finishing } });
    const job = await tx.job.create({ data: { type: "career-turn", key: careerJobKey(session.id), input: { sessionId: session.id, messageId: message.id, finishing: input.finishing } } });
    await tx.careerMessage.update({ where: { id: message.id }, data: { jobId: job.id } });
    await tx.careerSession.update({ where: { id: session.id }, data: { revision: { increment: 1 } } });
    return { sessionId: session.id, jobId: job.id };
  });
}

export async function retryCareerAnswer(sessionId: string) {
  return prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, CAREER_LOCK);
    const message = await tx.careerMessage.findFirst({ where: { sessionId }, orderBy: { ordinal: "desc" } });
    if (!message || message.role !== "user") throw new ActionError("There is no saved answer waiting for a response.");
    const previous = message.jobId ? await tx.job.findUnique({ where: { id: message.jobId } }) : null;
    if (previous) return { jobId: previous.id, retry: previous.status === "FAILED" };
    const job = await tx.job.create({ data: { type: "career-turn", key: careerJobKey(sessionId), input: { sessionId, messageId: message.id, finishing: message.finishing } } });
    await tx.careerMessage.update({ where: { id: message.id }, data: { jobId: job.id } });
    return { jobId: job.id, retry: false };
  });
}

export function proposalBaseline(payload: CareerProposalInput, profile: ProfileData): string | null {
  if (payload.kind === "RESUME_EDIT") {
    const id = payload.data.unitId;
    const source = id === "summary" ? { summary: profile.basics.summary } : id.startsWith("experience:") ? profile.experience.find((row) => `experience:${row.id}` === id) : id.startsWith("project:") ? profile.projects.find((row) => `project:${row.id}` === id) : profile.education.find((row) => `education:${row.id}` === id);
    if (!source) throw new ActionError("The profile entry behind this resume suggestion no longer exists.");
    return recordHash("skillIds" in source ? { ...source, skillIds: [...source.skillIds].sort() } : source);
  }
  const target = payload.kind === "PROJECT" && payload.data.targetId ? profile.projects.find((row) => row.id === payload.data.targetId)
    : payload.kind === "CERTIFICATION" && payload.data.targetId ? profile.certifications.find((row) => row.id === payload.data.targetId) : null;
  if ((payload.kind === "PROJECT" || payload.kind === "CERTIFICATION") && payload.data.targetId && !target) throw new ActionError("A proposed update refers to a profile entry that no longer exists.");
  return target ? recordHash("skillIds" in target ? { ...target, skillIds: [...target.skillIds].sort() } : target) : null;
}

export async function applyCareerProposal(id: string, revision: number, accept: boolean) {
  return prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, CAREER_LOCK);
    const proposal = await tx.careerProposal.findUnique({ where: { id } });
    if (!proposal) throw new ActionError("That proposal no longer exists.");
    if (proposal.status === "ACCEPTED" && accept) return { appliedRecordId: proposal.appliedRecordId };
    if (proposal.status !== "PENDING" || proposal.revision !== revision) throw new ActionError("That proposal changed or has already been reviewed. Reload to see its current state.");
    if (!accept) {
      await tx.careerProposal.update({ where: { id }, data: { status: "REJECTED", revision: { increment: 1 } } });
      return { appliedRecordId: null };
    }
    const payload = careerProposalSchema.parse({ kind: proposal.kind, data: JSON.parse(proposal.dataJson) });
    // Lock the canonical row before checking its baseline. A concurrent Profile
    // edit must either finish first (and invalidate this proposal), or follow it.
    const unitId = payload.kind === "RESUME_EDIT" ? payload.data.unitId : "";
    const projectId = payload.kind === "PROJECT" ? payload.data.targetId : unitId.startsWith("project:") ? unitId.slice(8) : null;
    const certificationId = payload.kind === "CERTIFICATION" ? payload.data.targetId : null;
    if (projectId) await tx.$executeRaw`UPDATE "Project" SET id = id WHERE id = ${projectId}`;
    if (certificationId) await tx.$executeRaw`UPDATE "Certification" SET id = id WHERE id = ${certificationId}`;
    if (unitId.startsWith("experience:")) await tx.$executeRaw`UPDATE "Experience" SET id = id WHERE id = ${unitId.slice(11)}`;
    if (unitId.startsWith("education:")) await tx.$executeRaw`UPDATE "Education" SET id = id WHERE id = ${unitId.slice(10)}`;
    if (unitId === "summary") {
      await tx.$executeRaw`INSERT INTO "ProfileField" ("key", "value", "updatedAt") VALUES (${"summary"}, ${""}, ${new Date()}) ON CONFLICT ("key") DO NOTHING`;
      await tx.$executeRaw`UPDATE "ProfileField" SET value = value WHERE key = ${"summary"}`;
    }
    const profile = await loadProfile(tx);
    if (proposal.baselineHash !== proposalBaseline(payload, profile)) throw new ActionError("The profile entry changed after this proposal was made. Ask for an updated proposal before accepting it.");
    let appliedRecordId: string | null = null;
    if (payload.kind === "RESUME_EDIT") {
      const edit = payload.data;
      const context = await loadResumeContext(edit.variantId, tx);
      const variant = (await listResumeVariants(tx)).find((row) => row.id === edit.variantId)!;
      if (variant.revision !== edit.variantRevision || context.units.find((row) => row.id === edit.unitId)?.text !== edit.expected) throw new ActionError("This resume changed after the suggestion. Ask the coach for a fresh suggestion.");
      await saveResumeVariant({ ...variant, overrides: [...variant.overrides.filter((row) => row.id !== edit.unitId), { id: edit.unitId, text: edit.text }] }, "Accepted coach suggestion", tx);
      appliedRecordId = edit.variantId;
    } else if (payload.kind === "PROJECT") {
      const { targetId, skills, ...data } = payload.data;
      if (!targetId && profile.projects.some((row) => row.name.trim().toLowerCase() === data.name.trim().toLowerCase())) throw new ActionError("A project with that name already exists. Ask to update that project instead.");
      const skillIds: string[] = [];
      for (const name of [...new Map(skills.map((skill) => [skill.toLowerCase(), skill])).values()]) {
        const canonicalName = profile.skills.find((skill) => skill.name.toLowerCase() === name.toLowerCase())?.name ?? name;
        const skill = await tx.skill.upsert({ where: { name: canonicalName }, update: {}, create: { name: canonicalName, sort: profile.skills.length + skillIds.length } });
        skillIds.push(skill.id);
      }
      if (targetId) {
        await tx.project.update({ where: { id: targetId }, data });
        await tx.projectSkill.deleteMany({ where: { projectId: targetId } });
        for (const skillId of skillIds) await tx.projectSkill.create({ data: { projectId: targetId, skillId } });
        appliedRecordId = targetId;
      } else {
        const project = await tx.project.create({ data: { ...data, sort: profile.projects.length, skills: { create: skillIds.map((skillId) => ({ skillId })) } } });
        appliedRecordId = project.id;
      }
    } else if (payload.kind === "CERTIFICATION" && ["earned", "expired"].includes(payload.data.status)) {
      const { targetId, status, ...data } = payload.data;
      if (status === "expired" && data.expiryYear === null) throw new ActionError("Add the expiry date before recording an expired credential.");
      if (!targetId && profile.certifications.some((row) => row.name.trim().toLowerCase() === data.name.trim().toLowerCase())) throw new ActionError("That certification already exists. Ask to update it instead.");
      const certification = targetId ? await tx.certification.update({ where: { id: targetId }, data }) : await tx.certification.create({ data: { ...data, sort: profile.certifications.length } });
      appliedRecordId = certification.id;
    } else if (payload.kind === "FACT") {
      const existing = await tx.fact.findFirst({ where: { applicationId: null, text: payload.data.text } });
      if (existing) appliedRecordId = existing.id;
      else {
        if (profile.facts.length >= 50) throw new ActionError("Your profile has reached its extra-facts limit. Review those facts before adding another.");
        const fact = await tx.fact.create({ data: { text: payload.data.text, sort: profile.facts.length } });
        appliedRecordId = fact.id;
      }
    } else if (payload.kind === "PREFERENCES") {
      await tx.setting.upsert({ where: { key: "careerPreferencesId" }, create: { key: "careerPreferencesId", value: id }, update: { value: id } });
    }
    await tx.careerProposal.update({ where: { id }, data: { status: "ACCEPTED", revision: { increment: 1 }, acceptedAt: new Date(), appliedRecordId } });
    return { appliedRecordId };
  });
}

export async function changeCareerState(id: string, revision: number, state: "ACTIVE" | "PAUSED" | "FINISHED") {
  const result = await prisma.careerSession.updateMany({ where: { id, revision }, data: { state, revision: { increment: 1 } } });
  if (!result.count) throw new ActionError("This conversation changed. Reload before changing its state.");
}
