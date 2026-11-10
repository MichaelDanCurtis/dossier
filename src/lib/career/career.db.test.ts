import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { seedBuiltIns } from "../../../prisma/seed/built-ins";
import { canonicalLinkedinJob, importLinkedinOpportunity } from "@/lib/linkedin-import";
import { sendApplicationEmail } from "@/lib/google/send";
import { backfillSentApplicationPackages, reserveApplicationPackage, reviewApplicationPackage, recordPackageOutcome, acknowledgePackageDifferences, applicationPackageSchema } from "@/lib/application-package";
import { applyStatusChange, undoStatusChange } from "@/lib/status-changes";
import { buildExport, exportSchema } from "@/lib/data-export";
import { importExport } from "@/lib/data-import";
import { listResumeVariants, loadResumeContext, createResumeVariant, saveResumeVariant, restoreResumeVariantVersion, selectResumeVariant } from "@/lib/resume-variant-data";
import { resumeContextSchema } from "@/lib/resume-variants";
import { writeDocumentsJob } from "@/lib/jobs/write-documents";
import { loadProfile } from "@/lib/profile-data";
import { createTestClient, resetDatabase } from "@/test/db";

import { addCareerAnswer, applyCareerProposal, createCareerSession, currentCareerPreferences, loadCareerSession, retryCareerAnswer } from "./data";
import { careerTurnJob } from "./jobs";
import { careerReviewPeriod, prepareDueCareerReview } from "./schedule";
import { saveSettings } from "@/lib/settings-data";
import type { CareerProposalInput } from "./schema";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
const ai = vi.hoisted(() => ({ complete: vi.fn() }));
const delivery = vi.hoisted(() => ({ render: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/google/account", () => ({ loadGoogleAccount: async () => ({ email: "fixture@example.com" }) }));
vi.mock("@/lib/google/gmail", () => ({ sendMail: delivery.send }));
vi.mock("@/lib/pdf/render", () => ({ renderPdf: delivery.render }));
vi.mock("@/lib/prisma", async () => { const { createTestClient } = await import("@/test/db"); db.client = createTestClient(); return { prisma: db.client }; });
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(32) } }));
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => ({ kind: "MOCK", model: "career-fixture", complete: ai.complete, listModels: async () => [], test: async () => ({ model: "career-fixture", latencyMs: 0 }) }) }));

const prisma = () => db.client!;
const context = (id = "fixture-job") => ({ id, step: vi.fn(async () => {}), signal: new AbortController().signal });
const project: CareerProposalInput = { kind: "PROJECT", data: { targetId: null, name: "A real new project", bullets: "Built an automation workflow", skills: ["TypeScript"], link: "https://example.com/evidence", startYear: 2026, startMonth: 10, endYear: null, endMonth: null, current: true } };
const preferences: CareerProposalInput = { kind: "PREFERENCES", data: { summary: "Wants hands-on automation work", wants: ["Automation"], strengths: ["Building tools"], avoid: [], workStyle: ["Hands-on"], locations: [], remote: "remote", compensation: "Not stated", travel: "Not stated", tradeoffs: "Not stated", unknowns: ["Location", "Compensation"], searches: [{ query: { keywords: "automation engineer", place: "", country: "", radiusKm: 25, remoteOnly: true, postedWithin: "any" }, reason: "You said you want hands-on automation work with remote flexibility." }] } };

beforeEach(async () => { await resetDatabase(prisma()); await seedBuiltIns(prisma()); ai.complete.mockReset(); delivery.render.mockReset().mockResolvedValue(new Uint8Array([37, 80, 68, 70])); delivery.send.mockReset().mockResolvedValue({ id: "fixture-mail", threadId: "fixture-thread" }); });
afterAll(async () => { await prisma().$disconnect(); });

async function answeredSession(payload: CareerProposalInput = project) {
  const sessionId = await createCareerSession("INTERVIEW", "My next role");
  const started = await addCareerAnswer({ sessionId, revision: 0, requestId: crypto.randomUUID(), text: "I built an automation workflow with TypeScript in October 2026, and I want remote automation work.", finishing: false, skip: false });
  const message = await prisma().careerMessage.findFirstOrThrow({ where: { sessionId, role: "user" } });
  ai.complete.mockResolvedValue({ reply: "Thanks for the concrete example.", question: "Which part would you like to keep doing?", readyForReview: false, proposals: [{ proposal: payload, evidenceMessageIds: [message.id] }] });
  const input = { sessionId, messageId: message.id, finishing: false };
  await careerTurnJob.run(input, context(message.jobId!));
  return { sessionId, message, started, input, proposal: await prisma().careerProposal.findFirstOrThrow({ where: { sessionId } }) };
}

describe("durable career conversations", () => {
  it("stores a turn and job together, and repeats a client request id without duplicating either", async () => {
    const sessionId = await createCareerSession("INTERVIEW", "Next role");
    const input = { sessionId, revision: 0, requestId: crypto.randomUUID(), text: "I want to build tools.", finishing: true, skip: false };
    const a = await addCareerAnswer(input);
    const b = await addCareerAnswer(input);
    expect(a).toEqual(b);
    expect(await prisma().careerMessage.count({ where: { sessionId, role: "user" } })).toBe(1);
    expect(await prisma().job.count()).toBe(1);
    const session = await loadCareerSession(sessionId);
    expect(session?.messages.at(-1)?.text).toBe(input.text);
  });

  it("keeps proposed projects out of the profile until explicit acceptance, then accepts idempotently", async () => {
    const result = await answeredSession();
    expect((await loadProfile()).projects).toHaveLength(0);
    await applyCareerProposal(result.proposal.id, 0, true);
    await applyCareerProposal(result.proposal.id, 0, true);
    expect(await prisma().project.count()).toBe(1);
    expect((await loadProfile()).projects[0]).toMatchObject({ name: project.data.name, startYear: 2026, startMonth: 10, current: true });
    expect(await prisma().projectSkill.count()).toBe(1);
  });

  it("a retried completed job does not call the provider or create another reply/proposal", async () => {
    const result = await answeredSession();
    await careerTurnJob.run(result.input, context(result.message.jobId!));
    expect(ai.complete).toHaveBeenCalledTimes(1);
    expect(await prisma().careerMessage.count({ where: { replyToId: result.message.id } })).toBe(1);
    expect(await prisma().careerProposal.count()).toBe(1);
  });

  it("retains the user's answer on provider failure and repairs a retained conversation after job cleanup", async () => {
    const sessionId = await createCareerSession("INTERVIEW", "Review");
    const result = await addCareerAnswer({ sessionId, revision: 0, requestId: crypto.randomUUID(), text: "Keep this answer even if the provider fails.", finishing: true, skip: false });
    const message = await prisma().careerMessage.findFirstOrThrow({ where: { sessionId, role: "user" } });
    ai.complete.mockRejectedValue(new Error("Fixture provider unavailable"));
    await expect(careerTurnJob.run({ sessionId, messageId: message.id, finishing: true }, context(message.jobId!))).rejects.toThrow();
    expect((await loadCareerSession(sessionId))?.messages.at(-1)?.text).toContain("Keep this answer");
    await prisma().job.delete({ where: { id: result.jobId } });
    const recovered = await retryCareerAnswer(sessionId);
    const job = await prisma().job.findUniqueOrThrow({ where: { id: recovered.jobId } });
    expect(job.input).toMatchObject({ messageId: message.id, finishing: true });
  });

  it("rejects a proposal if the canonical target was edited while the AI worked", async () => {
    const existing = await prisma().project.create({ data: { name: "Original", bullets: "Original evidence" } });
    const update: CareerProposalInput = { ...project, data: { ...project.data, targetId: existing.id } };
    const result = await answeredSession(update);
    await prisma().project.update({ where: { id: existing.id }, data: { bullets: "A newer manual edit" } });
    await expect(applyCareerProposal(result.proposal.id, 0, true)).rejects.toThrow("profile entry changed");
    expect((await prisma().project.findUniqueOrThrow({ where: { id: existing.id } })).bullets).toBe("A newer manual edit");
  });

  it("only accepted preferences influence the reviewed brief and search suggestions", async () => {
    const result = await answeredSession(preferences);
    expect(await currentCareerPreferences()).toBeNull();
    await applyCareerProposal(result.proposal.id, 0, true);
    expect(await currentCareerPreferences()).toEqual(preferences.data);
    expect((await loadProfile()).facts).toHaveLength(0);
    expect(await prisma().agentSearch.count()).toBe(0);
  });

  it("planned credentials stay in the career timeline and never become earned resume credentials", async () => {
    const certificate: CareerProposalInput = { kind: "CERTIFICATION", data: { targetId: null, name: "Future certification", issuer: "Example", status: "planned", year: null, month: null, expiryYear: null, expiryMonth: null, link: "" } };
    const result = await answeredSession(certificate);
    await applyCareerProposal(result.proposal.id, 0, true);
    expect(await prisma().certification.count()).toBe(0);
    expect((await loadCareerSession(result.sessionId))?.proposals[0].status).toBe("ACCEPTED");
  });

  it("rejects invented evidence references and does not promote pending facts", async () => {
    const sessionId = await createCareerSession("PROJECT", "Project");
    await addCareerAnswer({ sessionId, revision: 0, requestId: crypto.randomUUID(), text: "My answer.", finishing: false, skip: false });
    const message = await prisma().careerMessage.findFirstOrThrow({ where: { sessionId, role: "user" } });
    ai.complete.mockResolvedValue({ reply: "Ready", question: "", readyForReview: true, proposals: [{ proposal: project, evidenceMessageIds: ["another-session-message"] }] });
    await expect(careerTurnJob.run({ sessionId, messageId: message.id, finishing: true }, context(message.jobId!))).rejects.toThrow("saved answers");
    expect(await prisma().careerProposal.count()).toBe(0);
    expect((await loadProfile()).facts).toHaveLength(0);
  });

  it("round-trips history/provenance and board configuration without active jobs, leases or caches", async () => {
    const result = await answeredSession(preferences);
    await applyCareerProposal(result.proposal.id, 0, true);
    await prisma().companyBoard.create({ data: { platform: "greenhouse", region: "global", boardToken: "example", company: "Example", enabled: true, etag: "old-validator", listingJson: "[1,2]", leaseToken: "old-worker", leaseUntil: new Date(Date.now() + 60000) } });
    const file = exportSchema.parse(JSON.parse(JSON.stringify(await buildExport(prisma()))));
    expect(JSON.stringify(file.workspace)).not.toContain("old-validator");
    expect(JSON.stringify(file.workspace)).not.toContain("old-worker");
    await importExport(prisma(), file);
    expect((await loadCareerSession(result.sessionId))?.messages).toHaveLength(3);
    expect(await currentCareerPreferences()).toEqual(preferences.data);
    expect(await prisma().job.count()).toBe(0);
    expect(await prisma().companyBoard.findFirst()).toMatchObject({ enabled: true, etag: null, listingJson: null, leaseToken: null, generation: 0 });
    expect((await prisma().careerMessage.findFirstOrThrow({ where: { role: "user" } })).jobId).toBeNull();
  });
});

describe("optional career check-ins", () => {
  it("uses local Monday/month boundaries and waits until 9am, including DST", () => {
    expect(careerReviewPeriod(new Date("2026-11-09T16:59:00Z"), "weekly", "America/Los_Angeles")).toBeNull();
    expect(careerReviewPeriod(new Date("2026-11-09T17:00:00Z"), "weekly", "America/Los_Angeles")).toBe("weekly:2026-11-09");
    expect(careerReviewPeriod(new Date("2026-11-08T18:00:00Z"), "weekly", "America/Los_Angeles")).toBe("weekly:2026-11-02");
    expect(careerReviewPeriod(new Date("2026-12-01T01:00:00Z"), "monthly", "America/Los_Angeles")).toBe("monthly:2026-11");
    expect(careerReviewPeriod(new Date(), "off", "UTC")).toBeNull();
  });

  it("defaults off, honors pause, queues one atomic current-period review and does not replay old periods", async () => {
    const now = new Date("2026-11-10T18:00:00Z");
    expect(await prepareDueCareerReview(now)).toBeNull();
    await saveSettings({ careerReviewCadence: "weekly", careerReviewPaused: true, browserTimeZone: "America/Los_Angeles" });
    expect(await prepareDueCareerReview(now)).toBeNull();
    await saveSettings({ careerReviewPaused: false });
    const due = await prepareDueCareerReview(now);
    expect(due).not.toBeNull();
    expect(await prepareDueCareerReview(now)).toBeNull();
    const message = await prisma().careerMessage.findFirstOrThrow({ where: { sessionId: due!.sessionId } });
    expect(message).toMatchObject({ role: "user", origin: "SCHEDULE", jobId: due!.jobId });
    expect(await prisma().job.count()).toBe(1);
    await saveSettings({ careerReviewCadence: "monthly" });
    expect(await prepareDueCareerReview(now)).toBeNull();
    await saveSettings({ careerReviewCadence: "weekly" });
    expect(await prepareDueCareerReview(new Date("2027-02-10T18:00:00Z"))).not.toBeNull();
    expect(await prisma().careerSession.count()).toBe(2);
  });

  it("keeps scheduled prompts out of factual evidence and bounds the AI request", async () => {
    await saveSettings({ careerReviewCadence: "monthly", browserTimeZone: "UTC" });
    const due = await prepareDueCareerReview(new Date("2026-11-10T18:00:00Z"));
    const message = await prisma().careerMessage.findFirstOrThrow({ where: { sessionId: due!.sessionId } });
    ai.complete.mockResolvedValue({ reply: "Your saved goals are ready to revisit.", question: "What changed?", readyForReview: false, proposals: [] });
    await careerTurnJob.run({ sessionId: due!.sessionId, messageId: message.id, finishing: false }, context(message.jobId!));
    expect(ai.complete).toHaveBeenCalledTimes(1);
    expect(ai.complete.mock.calls[0][0].maxTokens).toBe(2048);
    expect((await loadCareerSession(due!.sessionId))?.messages.at(-1)?.text).toContain("What changed?");
    const session = await prisma().careerSession.findUniqueOrThrow({ where: { id: due!.sessionId } });
    await addCareerAnswer({ sessionId: session.id, revision: session.revision, requestId: crypto.randomUUID(), text: "", finishing: true, skip: false });
    const review = await prisma().careerMessage.findFirstOrThrow({ where: { sessionId: session.id }, orderBy: { ordinal: "desc" } });
    ai.complete.mockResolvedValue({ reply: "Review", question: "", readyForReview: true, proposals: [{ proposal: project, evidenceMessageIds: [message.id] }] });
    await expect(careerTurnJob.run({ sessionId: session.id, messageId: review.id, finishing: true }, context(review.jobId!))).rejects.toThrow("saved answers");
    expect(await prisma().careerProposal.count()).toBe(0);
  });
});

describe("focused resume wording and coaching", () => {
  async function history() {
    await prisma().profileField.create({ data: { key: "summary", value: "I build automation tools." } });
    const a = await prisma().experience.create({ data: { company: "IBM", role: "Platform engineer", bullets: "Built deployment tools", startYear: 2020, startMonth: 1, current: true } });
    const b = await prisma().experience.create({ data: { company: "Google", role: "Software engineer", bullets: "Built search tools", startYear: 2022, startMonth: 1, current: true } });
    return { a, b };
  }
  it("keeps overlapping canonical timelines intact while selecting a truthful subset", async () => {
    const { a, b } = await history();
    const variant = await createResumeVariant("Platform focus", "base");
    const saved = await saveResumeVariant({ ...variant, selection: variant.selection.filter((id) => id !== `experience:${b.id}`), focus: "Platform infrastructure", overrides: [{ id: `experience:${a.id}`, text: "- Built deployment tooling" }] });
    const context = await loadResumeContext(saved.id);
    expect(context.profile.experience.map((row) => row.id)).toEqual([a.id]);
    expect(context.profile.experience[0]).toMatchObject({ company: "IBM", role: "Platform engineer", startYear: 2020, startMonth: 1, current: true, bullets: "Built deployment tooling" });
    expect((await loadProfile()).experience).toHaveLength(2);
    expect(resumeContextSchema.parse(context)).toEqual(context);
  });
  it("does not overwrite newer wording and restores selection/wording while retaining current factual dates", async () => {
    const { a } = await history();
    const variant = await createResumeVariant("Focus", "base");
    const first = await saveResumeVariant({ ...variant, overrides: [{ id: `experience:${a.id}`, text: "Built deployment tooling" }] });
    await expect(saveResumeVariant({ ...variant, focus: "Stale" })).rejects.toThrow("changed");
    const version = await prisma().resumeVariantVersion.findFirstOrThrow({ where: { variantId: variant.id, revision: first.revision } });
    const second = await saveResumeVariant({ ...first, overrides: [{ id: `experience:${a.id}`, text: "Built better tools" }] });
    await prisma().experience.update({ where: { id: a.id }, data: { startYear: 2019 } });
    await restoreResumeVariantVersion(variant.id, second.revision, version.id);
    const restored = await loadResumeContext(variant.id);
    expect(restored.profile.experience.find((row) => row.id === a.id)).toMatchObject({ startYear: 2019, bullets: "Built deployment tooling" });
    expect(await prisma().resumeVariantVersion.count({ where: { variantId: variant.id } })).toBe(4);
  });
  it("rejects edits to credential/citation records and unknown units", async () => {
    const base = (await listResumeVariants())[0];
    await expect(saveResumeVariant({ ...base, overrides: [{ id: "certification:fake", text: "Invented credential" }] })).rejects.toThrow("Profile");
    expect(await prisma().resumeVariant.count()).toBe(0);
  });
  it("captures the selected resume before AI generation and ignores a later default switch", async () => {
    const { a, b } = await history();
    const variant = await createResumeVariant("IBM focus", "base");
    const saved = await saveResumeVariant({ ...variant, selection: variant.selection.filter((id) => id !== `experience:${b.id}`), focus: "Platform tooling" });
    await selectResumeVariant(saved.id);
    const captured = await loadResumeContext();
    await selectResumeVariant("base");
    ai.complete.mockResolvedValue({ summary: "Builds automation tools", roles: [], projects: [], skills: [], education: [] });
    const extracted = { title: null, company: "Example", role: "Engineer", location: null, mode: null, salary: null, deadline: null, requirements: [], asksForReferences: false, language: "English" };
    const generated = await writeDocumentsJob.run({ readJobId: "fixture", posting: "Platform role", extracted, match: { items: [] }, tone: "WARM", note: "", write: "resume", resumeContext: captured }, context());
    expect(generated.resumeContext?.variantId).toBe(saved.id);
    expect(generated.resume.some((unit) => unit.id === `experience:${a.id}`)).toBe(true);
    expect(generated.resume.some((unit) => unit.id === `experience:${b.id}`)).toBe(false);
    expect(JSON.stringify(ai.complete.mock.calls[0][0].messages)).toContain("Preferred emphasis");
  });
  it("shows a proposed coach edit without applying it, then accepts once and rejects stale edits", async () => {
    await history();
    const saved = await loadResumeContext("base");
    const sessionId = await createCareerSession("COACH", "Coach", { variantId: "base" });
    await addCareerAnswer({ sessionId, revision: 0, requestId: crypto.randomUUID(), text: "Please make my summary clearer.", finishing: false, skip: false });
    const message = await prisma().careerMessage.findFirstOrThrow({ where: { sessionId, role: "user" } });
    const edit = { variantId: "base", variantRevision: saved.variantRevision, unitId: "summary", expected: saved.profile.basics.summary, text: "Builds automation tools.", reason: "Shorter and more direct", unverified: [] };
    ai.complete.mockResolvedValue({ reply: "Here is a shorter option.", question: "Does this capture the work you want?", readyForReview: false, proposals: [{ proposal: { kind: "RESUME_EDIT", data: edit }, evidenceMessageIds: [message.id] }] });
    await careerTurnJob.run({ sessionId, messageId: message.id, finishing: false }, context(message.jobId!));
    expect((await loadResumeContext("base")).profile.basics.summary).toBe(edit.expected);
    const proposal = await prisma().careerProposal.findFirstOrThrow({ where: { sessionId } });
    await applyCareerProposal(proposal.id, 0, true);
    await applyCareerProposal(proposal.id, 0, true);
    expect((await loadResumeContext("base")).profile.basics.summary).toBe(edit.text);
    expect((await loadProfile()).basics.summary).toBe(edit.expected);
    const pending = await prisma().careerProposal.create({ data: { sessionId, generationKey: "stale", ordinal: 0, kind: "RESUME_EDIT", dataJson: proposal.dataJson, sourceMessageIdsJson: proposal.sourceMessageIdsJson, baselineHash: proposal.baselineHash } });
    await expect(applyCareerProposal(pending.id, 0, true)).rejects.toThrow("resume changed");
    expect(await prisma().resumeVariantVersion.count()).toBe(1);
  });
});

describe("immutable employer package history", () => {
  async function application(company = "Example Corp", includeRole = true) {
    const role = await prisma().experience.upsert({ where: { id: "shared-role" }, create: { id: "shared-role", company: "IBM", role: "Engineer", startYear: 2020, current: true, bullets: "Built tools" }, update: {} });
    return prisma().application.create({ data: { company, role: "Platform engineer", documents: { create: { kind: "RESUME", units: [{ id: "summary", label: "Summary", text: "Builder" }, ...(includeRole ? [{ id: `experience:${role.id}`, label: "IBM role", text: "Built tools" }] : [])] } } } });
  }
  it("captures full rendering inputs once and preserves history after a later edit or application deletion", async () => {
    const app = await application();
    const reserved = await reserveApplicationPackage(app.id);
    await recordPackageOutcome(reserved.id, "EXPORTED");
    await prisma().experience.update({ where: { id: "shared-role" }, data: { startYear: 2019 } });
    await prisma().document.updateMany({ where: { applicationId: app.id }, data: { units: [{ id: "summary", label: "Summary", text: "Later wording" }] } });
    const stored = await prisma().applicationPackageSnapshot.findUniqueOrThrow({ where: { id: reserved.id } });
    expect(applicationPackageSchema.parse(JSON.parse(stored.snapshotJson))).toEqual(reserved.snapshot);
    expect(reserved.snapshot.profile.experience[0].startYear).toBe(2020);
    await prisma().application.delete({ where: { id: app.id } });
    expect((await prisma().applicationPackageSnapshot.findUniqueOrThrow({ where: { id: reserved.id } })).applicationId).toBeNull();
    expect(await prisma().applicationPackageEvent.count()).toBe(2);
  });
  it("allows different emphasis/omission but blocks contradictory dates before export until this exact package is reviewed", async () => {
    const first = await application();
    const old = await reserveApplicationPackage(first.id);
    await recordPackageOutcome(old.id, "EXPORTED");
    const omitted = await application("example corp", false);
    expect((await reviewApplicationPackage(omitted.id)).conflicts).toHaveLength(0);
    await prisma().experience.update({ where: { id: "shared-role" }, data: { startYear: 2019 } });
    const next = await application("  EXAMPLE   CORP ");
    const review = await reviewApplicationPackage(next.id);
    expect(review.conflicts).toHaveLength(1);
    await expect(reserveApplicationPackage(next.id)).rejects.toThrow("Employer history");
    await acknowledgePackageDifferences(next.id, review.approvalHash);
    const approved = await reserveApplicationPackage(next.id);
    expect(approved.snapshot.profile.experience[0].startYear).toBe(2019);
    await prisma().document.updateMany({ where: { applicationId: next.id }, data: { units: [{ id: "experience:shared-role", label: "IBM role", text: "A newer version" }] } });
    await expect(reserveApplicationPackage(next.id)).rejects.toThrow("Employer history");
    await expect(acknowledgePackageDifferences(next.id, review.approvalHash)).rejects.toThrow("changed");
  });
  it("serializes preparations and distinguishes failed preparation from actual export/send", async () => {
    const first = await application();
    const reserved = await reserveApplicationPackage(first.id);
    await prisma().experience.update({ where: { id: "shared-role" }, data: { startYear: 2018 } });
    const next = await application();
    expect((await reviewApplicationPackage(next.id)).conflicts[0].pending).toBe(true);
    await expect(reserveApplicationPackage(next.id)).rejects.toThrow("Employer history");
    await recordPackageOutcome(reserved.id, "FAILED");
    expect((await reviewApplicationPackage(next.id)).conflicts).toHaveLength(0);
    expect(await prisma().applicationPackageEvent.count({ where: { kind: { in: ["EXPORTED", "SENT"] } } })).toBe(0);
  });
  it("keeps a marked-sent package after undo so later contradictory sends still require review", async () => {
    const first = await application();
    const change = await applyStatusChange(prisma(), first.id, "SENT");
    if (change.outcome !== "changed") throw new Error("Expected status change");
    await undoStatusChange(prisma(), change.event.id);
    expect(await prisma().applicationPackageEvent.count({ where: { kind: "SENT" } })).toBe(1);
    await prisma().experience.update({ where: { id: "shared-role" }, data: { startYear: 2017 } });
    const next = await application();
    await expect(applyStatusChange(prisma(), next.id, "SENT")).rejects.toThrow("Employer history");
    expect((await prisma().application.findUniqueOrThrow({ where: { id: next.id } })).status).toBe("DRAFT");
  });
});

describe("Gmail package consistency gate", () => {
  async function emailApplication() {
    await prisma().experience.upsert({ where: { id: "email-shared" }, create: { id: "email-shared", company: "IBM", role: "Engineer", startYear: 2020, current: true }, update: {} });
    return prisma().application.create({ data: { company: "Same employer", role: "Engineer", documents: { create: [
      { kind: "RESUME", units: [{ id: "experience:email-shared", label: "IBM role", text: "Built tools" }] },
      { kind: "EMAIL", units: [{ id: "to", label: "To", text: "recruiter@example.com" }, { id: "subject", label: "Subject", text: "Application" }, { id: "body", label: "Body", text: "Please find my resume attached." }] },
    ] } } });
  }
  it("blocks a contradictory package before Gmail's actual send or any PDF rendering", async () => {
    const first = await emailApplication();
    const old = await reserveApplicationPackage(first.id);
    await recordPackageOutcome(old.id, "EXPORTED");
    await prisma().experience.update({ where: { id: "email-shared" }, data: { startYear: 2018 } });
    const second = await emailApplication();
    await expect(sendApplicationEmail(second.id)).rejects.toThrow("Employer history");
    expect(delivery.render).not.toHaveBeenCalled();
    expect(delivery.send).not.toHaveBeenCalled();
  });
  it("renders and sends the reserved package even when live profile changes while rendering", async () => {
    const app = await emailApplication();
    delivery.render.mockImplementationOnce(async () => {
      await prisma().experience.update({ where: { id: "email-shared" }, data: { startYear: 2016 } });
      return new Uint8Array([37, 80, 68, 70]);
    });
    await sendApplicationEmail(app.id);
    const stored = await prisma().applicationPackageSnapshot.findFirstOrThrow({ where: { applicationId: app.id } });
    const snapshot = applicationPackageSchema.parse(JSON.parse(stored.snapshotJson));
    expect(snapshot.profile.experience[0].startYear).toBe(2020);
    expect(delivery.render).toHaveBeenCalledWith(`/print/package/${stored.id}/resume`);
    expect(delivery.send).toHaveBeenCalledTimes(1);
    const marked = await prisma().application.findUniqueOrThrow({ where: { id: app.id } });
    expect(marked.status).toBe("SENT");
    expect((marked.frozen as { profile: { experience: { startYear: number }[] } }).profile.experience[0].startYear).toBe(2020);
    expect(await prisma().applicationPackageEvent.count({ where: { kind: "SENT" } })).toBe(1);
  });
});

describe("assisted LinkedIn opportunity import", () => {
  it("keeps a canonical source link, deduplicates tracking URLs and retains the user-supplied full text", async () => {
    const text = "Build platform automation and deployment tools with our engineering team. This is the full posting supplied by the user.";
    const input = { url: "https://www.linkedin.com/jobs/view/platform-engineer-123456/?trackingId=ignored", title: "Platform engineer", company: "Example", place: "London", remote: true, text };
    const first = await importLinkedinOpportunity(input);
    const second = await importLinkedinOpportunity({ ...input, url: "https://linkedin.com/jobs/view/123456/" });
    expect(first.id).toBe(second.id);
    expect(second).toMatchObject({ source: "LINKEDIN", url: "https://www.linkedin.com/jobs/view/123456/", complete: true, description: text, remote: true });
    expect(await prisma().posting.count()).toBe(1);
    const backup = await buildExport(prisma());
    await importExport(prisma(), exportSchema.parse(JSON.parse(JSON.stringify(backup))));
    expect((await prisma().posting.findUniqueOrThrow({ where: { id: first.id } })).source).toBe("LINKEDIN");
  });
  it("refuses non-LinkedIn, credential-bearing and non-job links", () => {
    for (const url of ["https://www.linkedin.com.evil.example/jobs/view/123/", "https://user:pass@www.linkedin.com/jobs/view/123/", "http://www.linkedin.com/jobs/view/123/", "https://www.linkedin.com/in/member", "javascript:alert(1)"]) expect(() => canonicalLinkedinJob(url)).toThrow();
  });
});

it("discards an AI response whose saved job identity was reset by import or repair", async () => {
  const sessionId = await createCareerSession("PROJECT", "Replacement check");
  await addCareerAnswer({ sessionId, revision: 0, requestId: crypto.randomUUID(), text: "A real answer", finishing: false, skip: false });
  const message = await prisma().careerMessage.findFirstOrThrow({ where: { sessionId, role: "user" } });
  ai.complete.mockImplementationOnce(async () => {
    await prisma().careerMessage.update({ where: { id: message.id }, data: { jobId: null } });
    return { reply: "An old worker's reply", question: "", readyForReview: true, proposals: [{ proposal: project, evidenceMessageIds: [message.id] }] };
  });
  await expect(careerTurnJob.run({ sessionId, messageId: message.id, finishing: false }, context(message.jobId!))).rejects.toThrow("replaced or restored");
  expect(await prisma().careerProposal.count()).toBe(0);
  expect(await prisma().careerMessage.count({ where: { replyToId: message.id } })).toBe(0);
});

it("round-trips immutable photos once per image without changing package hashes", async () => {
  const src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSh8AAAAASUVORK5CYII=";
  await prisma().profileField.create({ data: { key: "photo", value: src } });
  for (const company of ["One", "Two"]) {
    const app = await prisma().application.create({ data: { company, documents: { create: { kind: "RESUME", units: [] } } } });
    const reserved = await reserveApplicationPackage(app.id);
    await recordPackageOutcome(reserved.id, "EXPORTED");
  }
  const before = await prisma().applicationPackageSnapshot.findMany({ orderBy: { company: "asc" } });
  const backup = await buildExport(prisma());
  expect(backup.workspace!.resumes.photoAssets).toHaveLength(1);
  expect(backup.workspace!.resumes.packages.every((row) => !row.snapshotJson.includes(src))).toBe(true);
  await importExport(prisma(), exportSchema.parse(JSON.parse(JSON.stringify(backup))));
  expect(await prisma().applicationPackageSnapshot.findMany({ orderBy: { company: "asc" } })).toEqual(before);
});

it("captures available older Sent records once with legacy provenance", async () => {
  const app = await prisma().application.create({ data: { company: "Legacy employer", status: "SENT", sentAt: new Date("2026-01-01T12:00:00Z"), documents: { create: { kind: "RESUME", units: [] } } } });
  expect(await backfillSentApplicationPackages()).toBe(1);
  expect(await backfillSentApplicationPackages()).toBe(0);
  expect(await prisma().applicationPackageEvent.count({ where: { kind: "LEGACY_SENT" } })).toBe(1);
  expect((await prisma().application.findUniqueOrThrow({ where: { id: app.id } })).sentAt).toEqual(new Date("2026-01-01T12:00:00Z"));
});

it("keeps a focused resume editable after a selected profile entry is removed", async () => {
  const project = await prisma().project.create({ data: { name: "Removed later", bullets: "Original wording" } });
  const variant = await createResumeVariant("Focus", "base");
  const first = await saveResumeVariant({ ...variant, overrides: [{ id: `project:${project.id}`, text: "My reviewed wording" }] });
  await prisma().project.delete({ where: { id: project.id } });
  const saved = await saveResumeVariant({ ...first, focus: "A new emphasis" });
  expect(saved.overrides).toEqual([]);
  expect(saved.selection).not.toContain(`project:${project.id}`);
  expect(saved.focus).toBe("A new emphasis");
});

it("asks for review when two focused resumes swap concurrent jobs for the same employer", async () => {
  const a = await prisma().experience.create({ data: { company: "IBM", role: "Engineer", startYear: 2020, current: true } });
  const b = await prisma().experience.create({ data: { company: "Google", role: "Engineer", startYear: 2022, current: true } });
  const app = async (id: string) => prisma().application.create({ data: { company: "Same employer", documents: { create: { kind: "RESUME", units: [{ id: `experience:${id}`, label: "Selected role", text: "Built tools" }] } } } });
  const first = await app(a.id); const old = await reserveApplicationPackage(first.id); await recordPackageOutcome(old.id, "EXPORTED");
  const second = await app(b.id); const review = await reviewApplicationPackage(second.id);
  expect(review.conflicts[0].differences.join(" ")).toContain("overlapping roles at IBM and Google");
  await expect(reserveApplicationPackage(second.id)).rejects.toThrow("Employer history");
  await acknowledgePackageDifferences(second.id, review.approvalHash);
  expect((await reserveApplicationPackage(second.id)).snapshot.applicationId).toBe(second.id);
});
