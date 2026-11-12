import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { createTestClient } from "@/test/db";
import { resetDatabase } from "@/test/db";
import { demoProfile } from "@/lib/demo-profile";
import type { JobContext } from "@/lib/jobs/runner";
import { importLinkedinOpportunity } from "@/lib/linkedin-import";
import { linkedinCareerContext, currentLinkedinReview } from "./data";
import { linkedinCareerReviewJob } from "./jobs";
import { buildExport } from "@/lib/data-export";

const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof createTestClient> | undefined, complete: vi.fn(), profile: undefined as ReturnType<typeof demoProfile> | undefined }));
vi.mock("@/lib/prisma", async () => { const { createTestClient } = await import("@/test/db"); fixture.db = createTestClient(); return { prisma: fixture.db }; });
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(32) } }));
vi.mock("@/lib/profile-data", () => ({ loadProfile: async () => fixture.profile }));
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => ({ kind: "MOCK", model: "fixture-model", complete: fixture.complete }) }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => true }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => ({ userId: "fixture" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/lib/jobs/runner", async original => ({ ...await original<typeof import("@/lib/jobs/runner")>(), startJob: vi.fn(async () => "queued-review") }));
vi.mock("@/lib/agent/scan-lock", async original => {
  const actual = await original<typeof import("@/lib/agent/scan-lock")>(); const { testDatabaseUrl } = await import("@/test/db");
  return { withAgentScanLock: <T>(work: (signal: AbortSignal) => Promise<T>) => actual.withAgentScanLock(work, testDatabaseUrl()) };
});
const db = () => fixture.db!;
const context = (controller = new AbortController()): JobContext => ({ id: "fixture-job", step: async () => {}, signal: controller.signal });
const imported = (id: string) => importLinkedinOpportunity({ url: `https://www.linkedin.com/jobs/view/${id}/`, title: "Platform Lead", company: "Example", place: "Seattle", remote: true, salary: "", text: "Help customer engineering teams design and deliver reliable infrastructure. ".repeat(3) });
const answer = () => ({ score: 88, recommendation: "PURSUE", summary: "Your delivery and infrastructure work transfer well to this role.", careerFit: "Confirm that the hands-on scope fits the direction you want.", matches: [{ evidenceId: `experience:${fixture.profile!.experience[0].id}`, requirement: "Customer delivery", explanation: "Your saved role shows relevant delivery work." }], gaps: ["Product-specific experience is not documented."], questions: ["How much of the role is implementation versus architecture?"] });
beforeEach(async () => { await resetDatabase(db()); fixture.profile = demoProfile(); fixture.complete.mockReset(); fixture.complete.mockImplementation(async () => answer()); });
afterAll(() => db().$disconnect());

describe("bounded LinkedIn career reviews", () => {
  it("admits only saved LinkedIn records through the authenticated app action", async () => {
    const { reviewLinkedinCollection } = await import("@/app/(app)/linkedin/actions");
    const { startJob } = await import("@/lib/jobs/runner"); vi.mocked(startJob).mockClear();
    expect((await reviewLinkedinCollection({ postingIds: ["other-workspace"], force: false })).ok).toBe(false);
    const posting = await imported("12345");
    await db().posting.update({ where: { id: posting.id }, data: { complete: false } });
    expect((await reviewLinkedinCollection({ postingIds: [posting.id], force: false })).ok).toBe(false);
    expect(startJob).not.toHaveBeenCalled();
    await db().posting.update({ where: { id: posting.id }, data: { complete: true } });
    expect(await reviewLinkedinCollection({ postingIds: [posting.id], force: false })).toMatchObject({ ok: true, data: { jobId: "queued-review" } });
    expect(startJob).toHaveBeenCalledTimes(1);
  });
  it("saves an evidence-backed summary, reuses current reviews and creates no application", async () => {
    const posting = await imported("12345");
    expect(await linkedinCareerReviewJob.run({ postingIds: [posting.id], force: false }, context())).toMatchObject({ reviewed: 1, failed: 0 });
    const stored = await db().posting.findUniqueOrThrow({ where: { id: posting.id } });
    const review = currentLinkedinReview(stored.careerReviewJson, stored, (await linkedinCareerContext()).hash);
    expect(review).toMatchObject({ summary: answer().summary, score: 88, model: "fixture-model", matches: [{ label: expect.any(String) }] });
    expect(await db().application.count()).toBe(0);
    expect((await linkedinCareerReviewJob.run({ force: false }, context())).reviewed).toBe(0);
    expect(fixture.complete).toHaveBeenCalledTimes(1);
    const prompt = JSON.stringify(fixture.complete.mock.calls[0][0]);
    expect(prompt).not.toContain(fixture.profile!.basics.email);
    expect(prompt).not.toContain(fixture.profile!.basics.phone);
    const backup = await buildExport(db()); expect(backup.postings[0].careerReviewJson).toContain('"summary"');
  });
  it("reviews only the chosen workspace jobs and refuses unknown or incomplete records", async () => {
    const selected = await imported("12345"), other = await imported("12346");
    expect((await linkedinCareerReviewJob.run({ postingIds: [selected.id], force: false }, context())).reviewed).toBe(1);
    expect((await db().posting.findUniqueOrThrow({ where: { id: other.id } })).careerReviewJson).toBe("");
    await expect(linkedinCareerReviewJob.run({ postingIds: ["another-workspace-record"], force: false }, context())).rejects.toThrow("missing");
    expect(fixture.complete).toHaveBeenCalledTimes(1);
  });
  it("rejects invented evidence references and retains the job for another attempt", async () => {
    const posting = await imported("12345"); fixture.complete.mockResolvedValue({ ...answer(), matches: [{ ...answer().matches[0], evidenceId: "experience:invented" }] });
    expect(await linkedinCareerReviewJob.run({ force: false }, context())).toMatchObject({ reviewed: 0, failed: 1 });
    expect((await db().posting.findUniqueOrThrow({ where: { id: posting.id } })).careerReviewJson).toBe("");
  });
  it("does not save after cancellation or recreate a deleted posting", async () => {
    const posting = await imported("12345"), controller = new AbortController();
    fixture.complete.mockImplementationOnce(async () => { controller.abort(); return answer(); });
    await expect(linkedinCareerReviewJob.run({ force: false }, context(controller))).rejects.toThrow();
    expect((await db().posting.findUniqueOrThrow({ where: { id: posting.id } })).careerReviewJson).toBe("");
    fixture.complete.mockImplementationOnce(async () => { await db().posting.delete({ where: { id: posting.id } }); return answer(); });
    expect(await linkedinCareerReviewJob.run({ force: false }, context())).toMatchObject({ reviewed: 0, failed: 1 });
    expect(await db().posting.count()).toBe(0);
  });
  it("discards output when the posting or profile changes in flight", async () => {
    const posting = await imported("12345");
    fixture.complete.mockImplementationOnce(async () => { await db().posting.update({ where: { id: posting.id }, data: { description: "Updated requirements. ".repeat(8) } }); return answer(); });
    expect((await linkedinCareerReviewJob.run({ force: false }, context())).reviewed).toBe(0);
    fixture.complete.mockImplementationOnce(async () => { fixture.profile!.experience[0].bullets += "\nA new confirmed project."; return answer(); });
    expect((await linkedinCareerReviewJob.run({ force: false }, context())).reviewed).toBe(0);
    expect((await db().posting.findUniqueOrThrow({ where: { id: posting.id } })).careerReviewJson).toBe("");
  });
  it("allows an identical recapture without discarding a valid review", async () => {
    const posting = await imported("12345");
    fixture.complete.mockImplementationOnce(async () => { await imported("12345"); return answer(); });
    expect((await linkedinCareerReviewJob.run({ force: false }, context())).reviewed).toBe(1);
    expect((await db().posting.findUniqueOrThrow({ where: { id: posting.id } })).careerReviewJson).not.toBe("");
  });
  it("caps each run at ten and allows an explicit one-job reassessment", async () => {
    for (let id = 20000; id < 20012; id++) await imported(String(id));
    expect(await linkedinCareerReviewJob.run({ force: false }, context())).toMatchObject({ reviewed: 10, remaining: 2 });
    expect((await linkedinCareerReviewJob.run({ force: false }, context())).reviewed).toBe(2);
    const posting = await db().posting.findFirstOrThrow();
    expect((await linkedinCareerReviewJob.run({ postingIds: [posting.id], force: true }, context())).reviewed).toBe(1);
    await expect(linkedinCareerReviewJob.run({ force: true }, context())).rejects.toThrow("one chosen job");
    expect(await db().application.count()).toBe(0);
  });
});
