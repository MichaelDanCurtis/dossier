import { afterAll, beforeEach, expect, it, vi } from "vitest";
import type { createTestClient } from "@/test/db";
import { resetDatabase } from "@/test/db";
const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof createTestClient> | undefined, complete: vi.fn(), start: vi.fn(), ready: true }));
vi.mock("@/lib/prisma", async () => { const { createTestClient } = await import("@/test/db"); fixture.db = createTestClient(); return { prisma: fixture.db }; });
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(32) } }));
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => ({ complete: fixture.complete }) }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => fixture.ready, loadAiSettingsView: async () => ({ model: "fixture-model" }) }));
vi.mock("@/lib/jobs/runner", async original => ({ ...await original<typeof import("@/lib/jobs/runner")>(), startJob: fixture.start }));
vi.mock("@/lib/linkedin-review/data", () => ({ linkedinCareerContext: async () => ({ candidate: { experience: [{ title: "Engineer" }] }, preferences: {}, hash: "f".repeat(64) }), currentLinkedinReview: () => null }));
vi.mock("@/lib/studio/publicist-provider", () => ({ publicistProvider: async () => ({ complete: fixture.complete }) }));
import { handleWorkspace } from "./service";
import { workspaceInput } from "./schema";
import { workspaceReplyDraft, workspaceSourceReview } from "./jobs";
import { loadStudio, updateStudio } from "@/lib/studio/data";
import { publicistContext, publicistConversation } from "@/lib/studio/publicist-conversation";
const db = () => fixture.db!;
const connection = "a".repeat(32), other = "b".repeat(32);
const item = { key: "thread-fixture", title: "Alex", text: "Can we discuss this infrastructure opportunity?", url: "https://www.linkedin.com/messaging/thread/fixture/" };
const context = () => ({ id: "fixture", step: async () => {}, signal: new AbortController().signal });
beforeEach(async () => { await resetDatabase(db()); fixture.complete.mockReset(); fixture.start.mockReset().mockResolvedValue("queued-fixture"); fixture.ready = true; });
afterAll(async () => { await db().$disconnect(); });
it("captures are idempotent, bounded, stripped of tracking and explicitly identify previews", async () => {
  const first = await handleWorkspace({ kind: "IMPORT_INBOX", items: [{ ...item, url: "" }] }, connection);
  expect(await handleWorkspace({ kind: "IMPORT_INBOX", items: [{ ...item, url: "" }] }, connection)).toEqual(first);
  await handleWorkspace({ kind: "IMPORT_THREAD", item: { ...item, url: item.url + "?trackingId=private" } }, connection);
  const studio = await loadStudio(); expect(studio.sources).toHaveLength(2);
  expect(studio.sources.find(s => s.id.startsWith("li-preview:"))?.text).toMatch(/not the full conversation/);
  expect(studio.sources.find(s => s.id.startsWith("li-thread:"))?.url).toBe(item.url);
  await expect(handleWorkspace({ kind: "IMPORT_FEED", items: [{ ...item, url: "https://evil.test/" }] }, connection)).rejects.toThrow("LinkedIn");
  expect((await loadStudio()).sources).toHaveLength(2); expect(fixture.complete).not.toHaveBeenCalled();
});
it("does not discard older saved sources when a capture exceeds capacity", async () => {
  await updateStudio(studio => { studio.sources = Array.from({ length: 80 }, (_, n) => ({ ...item, id: String(n), kind: "POST", applicationId: "", createdAt: new Date().toISOString() })); });
  await expect(handleWorkspace({ kind: "IMPORT_FEED", items: [item] }, connection)).rejects.toThrow("full"); expect((await loadStudio()).sources).toHaveLength(80);
});
it("paid requests are claimed once, and job results cannot cross connection grants", async () => {
  await handleWorkspace({ kind: "IMPORT_THREAD", item }, connection);
  const request = { kind: "REVIEW_SOURCES" as const, requestId: crypto.randomUUID(), sourceIds: [(await loadStudio()).sources[0].id] };
  expect(await handleWorkspace(request, connection)).toEqual({ jobId: "queued-fixture" });
  expect(await handleWorkspace(request, connection)).toEqual({ jobId: "queued-fixture" }); expect(fixture.start).toHaveBeenCalledTimes(1);
  await expect(handleWorkspace({ kind: "JOB_STATUS", jobId: "queued-fixture" }, other)).rejects.toThrow("connection");
  const statuses = await handleWorkspace({ kind: "JOB_STATUSES", jobIds: ["queued-fixture"] }, connection); expect(statuses).toMatchObject({ jobs: [{ status: "FAILED", error: expect.stringContaining("removed") }] });
});
it("an uncertain start cannot spend twice after a response is lost", async () => {
  fixture.start.mockRejectedValueOnce(new Error("interrupted"));
  const request = { kind: "REVIEW_SOURCES" as const, requestId: crypto.randomUUID(), sourceIds: ["fixture"] };
  await expect(handleWorkspace(request, connection)).rejects.toThrow("interrupted");
  await expect(handleWorkspace(request, connection)).rejects.toThrow("received this request already"); expect(fixture.start).toHaveBeenCalledTimes(1);
});
it("refuses drafts for jobs that are not saved in the paired account", async () => {
  await expect(handleWorkspace({ kind: "PREPARE_RESUME", requestId: crypto.randomUUID(), postingId: "foreign" }, connection)).rejects.toThrow("saved LinkedIn job"); expect(fixture.start).not.toHaveBeenCalled();
});
it("reuses an existing application draft rather than creating a duplicate", async () => {
  const posting = await db().posting.create({ data: { source: "LINKEDIN", externalId: "fixture", title: "Engineer", company: "Example", url: "https://www.linkedin.com/jobs/view/123/", complete: true, savedAt: new Date() } });
  const application = await db().application.create({ data: { postingUrl: posting.url } });
  expect(await handleWorkspace({ kind: "PREPARE_RESUME", requestId: crypto.randomUUID(), postingId: posting.id }, connection)).toEqual({ applicationId: application.id }); expect(fixture.start).not.toHaveBeenCalled();
});
it("source reviews verify model references and never inject private messages into public writing", async () => {
  await handleWorkspace({ kind: "IMPORT_THREAD", item }, connection); const source = (await loadStudio()).sources[0];
  fixture.complete.mockResolvedValueOnce({ items: [{ id: "invented", summary: "Unsupported", nextStep: "No" }] });
  await expect(workspaceSourceReview.run({ sourceIds: [source.id] }, context())).rejects.toThrow("invalid source reference"); expect((await loadStudio()).sources[0].analysis).toBeUndefined();
  expect(() => publicistContext(awaitValue(), [source.id])).toThrow("unavailable");
  function awaitValue() { return { sources: [source], publicist: {} } as Awaited<ReturnType<typeof loadStudio>>; }
});
it("reply drafting requires a captured conversation instead of an inbox preview", async () => {
  await handleWorkspace({ kind: "IMPORT_INBOX", items: [{ ...item, url: "" }] }, connection); const source = (await loadStudio()).sources[0];
  await expect(workspaceReplyDraft.run({ sourceId: source.id }, context())).rejects.toThrow("conversation first"); expect(fixture.complete).not.toHaveBeenCalled();
});
it("cancellation discards a Publicist answer and releases the pending conversation", async () => {
  const controller = new AbortController(); fixture.complete.mockImplementationOnce(async () => { controller.abort(); return { reply: "Stale response", ideas: [], visual: { prompt: "", altText: "", photoQuery: "" } }; });
  await expect(publicistConversation("What should we write?", 0, [], controller.signal)).rejects.toThrow();
  const studio = await loadStudio(); expect(studio.publicistChat.messages).toEqual([]); expect(studio.publicistChat.pending).toBeUndefined();
});
it("the workspace protocol has no sends, cookies, credential fields or unlimited reads", () => {
  for (const value of [{ kind: "SEND_MESSAGE" }, { kind: "PUBLICIST_CHAT", requestId: crypto.randomUUID(), text: "Post this", sourceIds: [], publish: true }, { kind: "IMPORT_THREAD", item, cookies: "private" }, { kind: "IMPORT_FEED", items: Array(21).fill(item) }]) expect(workspaceInput.safeParse(value).success).toBe(false);
});
