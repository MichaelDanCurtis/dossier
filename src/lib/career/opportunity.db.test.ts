import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestClient, resetDatabase } from "@/test/db";
import { createOpportunity, opportunityChoices, startInterviewPractice } from "./opportunities";
import { opportunityContextSchema } from "./opportunity-schema";
import { loadCareerSession, addCareerAnswer } from "./data";
import { careerTurnJob } from "./jobs";
import { createRepositorySession, repositorySettings, saveRepositorySettings } from "./repositories";
import { buildWorkspaceExport, workspaceExportSchema } from "@/lib/workspace-export";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
const ai = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("@/lib/prisma", async () => { const { createTestClient } = await import("@/test/db"); db.client = createTestClient(); return { prisma: db.client }; });
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(32) } }));
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => ({ kind: "MOCK", model: "fixture", complete: ai.complete }) }));
vi.mock("@/lib/studio/publicist-provider", () => ({ publicistProvider: async () => ({ kind: "MOCK", model: "cheap-fixture", complete: ai.complete }) }));
const prisma = () => db.client!;
const input = { applicationId: "", title: "Infrastructure lead", company: "Example employer", posting: "Lead Kubernetes infrastructure and evaluate architecture tradeoffs. This role calls for hands-on engineering and technical leadership.", url: "https://example.com/jobs/1", focus: "Hands-on work", companySource: "", companySourceUrl: "" };
const ctx = (id: string) => ({ id, step: vi.fn(async () => {}), signal: new AbortController().signal });
beforeEach(async () => { await resetDatabase(prisma()); ai.complete.mockReset(); await prisma().profileField.createMany({ data: [{ key: "name", value: "Real person" }, { key: "email", value: "private@example.com" }, { key: "phone", value: "secret-phone" }] }); });
afterAll(async () => { await prisma().$disconnect(); });

async function completeBrief() {
  await prisma().experience.create({ data: { role: "Architect", company: "Actual employer", bullets: "Built Kubernetes operators in Rust." } });
  const result = await createOpportunity(input);
  const row = await prisma().careerSession.findUniqueOrThrow({ where: { id: result.id } });
  const snapshot = opportunityContextSchema.parse(JSON.parse(row.contextJson));
  ai.complete.mockResolvedValue({ assessment: "Worth exploring; responsibilities need clarification.", matches: [{ requirement: "Kubernetes", evidenceId: snapshot.evidence[0].id, explanation: "Saved experience describes operators." }], tradeoffs: ["Hands-on scope unknown"], unknowns: ["Company research absent"], companyNotes: [{ text: "Technical leadership is requested", source: "posting" }], questions: ["What is the hands-on scope?"], preparation: ["Explain an operator design decision."] });
  const message = await prisma().careerMessage.findFirstOrThrow({ where: { sessionId: result.id, role: "user" } });
  await careerTurnJob.run({ sessionId: result.id, messageId: message.id, finishing: false }, ctx(result.jobId));
  return { ...result, snapshot, message };
}

describe("opportunity briefings and grounded practice", () => {
  it("snapshots actual facts without contacts, saves its job atomically, and retains them after profile changes", async () => {
    const { id, snapshot } = await completeBrief();
    expect(snapshot.profile).not.toContain("private@example.com"); expect(snapshot.profile).not.toContain("secret-phone");
    expect(snapshot.evidence[0].text).toContain("Rust");
    await prisma().experience.deleteMany();
    const session = await loadCareerSession(id);
    expect(session?.messages.at(-1)?.text).toContain("Actual employer");
    expect(session?.messages.at(-1)?.text).toContain("no independent web research");
    const practice = await startInterviewPractice(id);
    expect(JSON.parse((await prisma().careerSession.findUniqueOrThrow({ where: { id: practice.id } })).contextJson)).toEqual(snapshot);
    await prisma().$transaction(async (tx) => expect(workspaceExportSchema.safeParse(JSON.parse(JSON.stringify(await buildWorkspaceExport(tx)))).success).toBe(true));
  });
  it("rejects invented evidence citations, preserves the request, and does not create a reply or profile facts", async () => {
    const r = await createOpportunity(input);
    ai.complete.mockResolvedValue({ assessment: "Unsupported", matches: [{ requirement: "Kubernetes", evidenceId: "invented", explanation: "Invented" }], tradeoffs: [], unknowns: [], companyNotes: [], questions: [], preparation: [] });
    const m = await prisma().careerMessage.findFirstOrThrow({ where: { sessionId: r.id, role: "user" } });
    await expect(careerTurnJob.run({ sessionId: r.id, messageId: m.id, finishing: false }, ctx(r.jobId))).rejects.toThrow("evidence that was not supplied");
    expect((await loadCareerSession(r.id))?.messages.at(-1)?.origin).toBe("BRIEF_REQUEST");
    expect(await prisma().careerProposal.count()).toBe(0);
    await expect(startInterviewPractice(r.id)).rejects.toThrow("Complete an opportunity briefing");
  });
  it("adapts practice and debriefs without promoting practice answers into profile", async () => {
    const brief = await completeBrief(); const practice = await startInterviewPractice(brief.id);
    const answer = await addCareerAnswer({ sessionId: practice.id, revision: 0, requestId: crypto.randomUUID(), text: "I designed this operator, but do not have outcome metrics yet.", finishing: true, skip: false });
    ai.complete.mockResolvedValue({ reply: "Clear ownership; collect evidence for outcomes. Practice the failure-mode discussion next.", question: "", readyForReview: true });
    const m = await prisma().careerMessage.findFirstOrThrow({ where: { sessionId: practice.id, role: "user" } });
    await careerTurnJob.run({ sessionId: practice.id, messageId: m.id, finishing: true }, ctx(answer.jobId));
    expect((await loadCareerSession(practice.id))?.state).toBe("REVIEW");
    expect(await prisma().careerProposal.count()).toBe(0); expect(await prisma().fact.count()).toBe(0);
    expect(ai.complete.mock.calls.at(-1)![0].system).toContain("debrief");
  });
  it("uses saved posting facts rather than client supplied title and refuses empty/removed postings", async () => {
    const saved = await prisma().posting.create({ data: { source: "JSEARCH", externalId: "fixture-1", title: "Real saved job", company: "Real company", savedAt: new Date(), description: input.posting, url: input.url } });
    expect((await opportunityChoices()).some((row) => row.id === `posting:${saved.id}`)).toBe(true);
    const r = await createOpportunity({ ...input, applicationId: `posting:${saved.id}`, title: "Injected title" });
    expect(JSON.parse((await prisma().careerSession.findUniqueOrThrow({ where: { id: r.id } })).contextJson).title).toBe("Real saved job");
    await expect(createOpportunity({ ...input, applicationId: "removed" })).rejects.toThrow("no longer exists");
    await expect(createOpportunity({ ...input, posting: "too short" })).rejects.toThrow("80 characters");
  });
  it("requires an explicit repository model and personal answers before proposing project facts", async () => {
    const source = { version: 1 as const, name: "owner/repo", url: "https://github.com/owner/repo", privateExcerpt: false, capturedAt: new Date().toISOString(), commit: "a".repeat(40), fork: true, parent: "upstream/repo", description: "Repository capability is not contribution", language: "Rust", readme: "A storage tool." };
    await expect(createRepositorySession(source)).rejects.toThrow("Choose a low-cost model");
    await saveRepositorySettings({ connectionId: "", model: "cheap-fixture" }); expect((await repositorySettings()).model).toBe("cheap-fixture");
    const r = await createRepositorySession(source);
    ai.complete.mockResolvedValue({ reply: "The README describes storage; your contribution is unknown.", question: "What did you personally change?", readyForReview: false, proposals: [] });
    const m = await prisma().careerMessage.findFirstOrThrow({ where: { sessionId: r.id, role: "user" } });
    await careerTurnJob.run({ sessionId: r.id, messageId: m.id, finishing: false }, ctx(r.jobId));
    expect(await prisma().project.count()).toBe(0); expect(await prisma().careerProposal.count()).toBe(0);
    expect(ai.complete.mock.calls.at(-1)![0]).toMatchObject({ effort: "low", maxTokens: 2048 });
  });
});
