import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { createTestClient } from "@/test/db";
import { resetDatabase } from "@/test/db";

const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof createTestClient> | undefined, complete: vi.fn() }));
vi.mock("@/lib/prisma", async () => { const { createTestClient } = await import("@/test/db"); fixture.db = createTestClient(); return { prisma: fixture.db }; });
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(32) } }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => ({ userId: "fixture" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/lib/ai", () => ({ AiError: class AiError extends Error {}, getAiProvider: async () => ({ complete: fixture.complete }) }));
import { addStudioSource, createPublicistDraft, publishPublicistPost } from "@/app/(app)/agent/studio-actions";
import { loadStudio, updateStudio } from "./data";
import { beginLinkedin, completeLinkedin, forgetLinkedinConnection, linkedinConnectionView, setLinkedinApp } from "./linkedin";
import { linkedinKeys, studioKey } from "./schema";
import { careerReviewContext } from "@/lib/career/review-context";
import { buildExport } from "@/lib/data-export";

const db = () => fixture.db!;
const fetcher = vi.fn();
beforeEach(async () => { await resetDatabase(db()); vi.stubGlobal("fetch", fetcher); fetcher.mockReset(); fixture.complete.mockReset(); });
afterAll(async () => { vi.unstubAllGlobals(); await db().$disconnect(); });

async function connected() {
  await setLinkedinApp("fixture-app", "fixture-secret");
  const start = await beginLinkedin("https://fixture.example");
  fetcher.mockResolvedValueOnce(Response.json({ access_token: "fixture-token", expires_in: 3600, scope: "openid profile w_member_social" }))
    .mockResolvedValueOnce(Response.json({ sub: "fixture-member", name: "Fixture Writer" }));
  await completeLinkedin("https://fixture.example", start.state, "fixture-code");
  return start;
}
async function draft() {
  await updateStudio((studio) => { studio.drafts.push({ id: "fixture-draft", format: "POST", title: "Review me", body: "A useful lesson about building tools.", createdAt: new Date().toISOString(), status: "DRAFT", sources: [] }); });
  return { id: "fixture-draft", expected: "A useful lesson about building tools.", approved: true as const, connectionId: (await linkedinConnectionView()).connectionId! };
}

describe("private agent studio and LinkedIn publishing", () => {
  it("gives career AI published ranges and relative comparisons, without exact private pay", async () => {
    await updateStudio((studio) => { studio.watch = { ...studio.watch, role: "Platform engineer", annualBase: 97321, targetBase: 142789 }; });
    await db().posting.create({ data: { source: "LINKEDIN", externalId: "fixture-pay", title: "Platform engineer", company: "Fixture", url: "https://example.com/job", salary: "USD 120,000–160,000/year", savedAt: new Date(), complete: true } });
    const context = await careerReviewContext();
    expect(context).toContain("below this published range");
    expect(context).toContain("range can meet target");
    expect(context).toContain("USD 120,000–160,000/year");
    expect(context).not.toContain("97321");
    expect(context).not.toContain("142789");
  });
  it("stores encrypted OAuth credentials, uses single-use state and forgets the connection", async () => {
    const start = await connected();
    expect(start.url.searchParams.get("scope")).toBe("openid profile w_member_social");
    expect(await linkedinConnectionView()).toMatchObject({ configured: true, connected: true, name: "Fixture Writer" });
    const rows = await db().setting.findMany({ where: { key: { in: [...linkedinKeys] } } });
    expect(JSON.stringify(rows)).not.toContain("fixture-token");
    expect(JSON.stringify(rows)).not.toContain("fixture-secret");
    await expect(completeLinkedin("https://fixture.example", start.state, "again")).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
    await forgetLinkedinConnection();
    expect(await linkedinConnectionView()).toMatchObject({ configured: true, connected: false });
  });
  it("does not exchange an invalid OAuth state", async () => {
    await setLinkedinApp("fixture-app", "fixture-secret"); await beginLinkedin("https://fixture.example");
    await expect(completeLinkedin("https://fixture.example", "wrong", "code")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("exports personal studio data without LinkedIn credentials", async () => {
    await connected();
    await addStudioSource({ kind: "POST", title: "My saved source", text: "A public lesson about building tools.", url: "", applicationId: "" });
    const backup = await buildExport(db());
    expect(backup.settings.some((item) => item.key === studioKey)).toBe(true);
    expect(backup.settings.some((item) => (linkedinKeys as readonly string[]).includes(item.key))).toBe(false);
    expect(JSON.stringify(backup)).not.toContain("fixture-token");
    expect(JSON.stringify(backup)).not.toContain("fixture-secret");
  });
  it("publishes one exact approved post and rejects duplicate or stale-account approval", async () => {
    await connected(); const input = await draft();
    expect((await publishPublicistPost({ ...input, connectionId: "wrong-account" })).ok).toBe(false);
    expect((await publishPublicistPost({ ...input, expected: "Different text" })).ok).toBe(false);
    fetcher.mockResolvedValueOnce(new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:123" } }));
    const result = await publishPublicistPost(input);
    expect(result.ok).toBe(true);
    expect((await loadStudio()).drafts[0]).toMatchObject({ status: "PUBLISHED", postUrn: "urn:li:share:123" });
    expect((await publishPublicistPost(input)).ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const sent = JSON.parse(fetcher.mock.calls[2][1].body);
    expect(sent.author).toBe("urn:li:person:fixture-member");
    expect(sent.specificContent["com.linkedin.ugc.ShareContent"].shareCommentary.text).toBe(input.expected);
  });
  it("blocks automatic or manual retry after an ambiguous delivery", async () => {
    await connected(); const input = await draft();
    fetcher.mockRejectedValueOnce(new Error("Network disconnected after submission"));
    expect((await publishPublicistPost(input)).ok).toBe(false);
    expect((await loadStudio()).drafts[0].status).toBe("CHECK_LINKEDIN");
    expect((await publishPublicistPost(input)).ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("excludes imported private messages and private pay from generated public copy", async () => {
    await updateStudio((studio) => { studio.watch.annualBase = 173219; });
    const message = await addStudioSource({ kind: "MESSAGE", title: "Recruiter", text: "Private negotiation about salary.", url: "", applicationId: "" });
    expect(message.ok).toBe(true);
    if (!message.ok) return;
    expect((await createPublicistDraft({ format: "POST", topic: "Tools and teams", sourceIds: [message.data.id] })).ok).toBe(false);
    expect(fixture.complete).not.toHaveBeenCalled();
    fixture.complete.mockResolvedValue({ title: "Tools", body: "Better tools make room for collaboration." });
    expect((await createPublicistDraft({ format: "POST", topic: "Tools and teams", sourceIds: [] })).ok).toBe(true);
    expect(JSON.stringify(fixture.complete.mock.calls[0])).not.toContain("173219");
    expect(JSON.stringify(fixture.complete.mock.calls[0])).not.toContain("Private negotiation");
  });
  it("does not repopulate a cleared workspace with an old AI result", async () => {
    fixture.complete.mockImplementationOnce(async () => {
      await db().setting.delete({ where: { key: studioKey } });
      return { title: "Old draft", body: "This belongs to the deleted workspace." };
    });
    const result = await createPublicistDraft({ format: "POST", topic: "Tools and teams", sourceIds: [] });
    expect(result.ok).toBe(false);
    expect((await loadStudio()).drafts).toEqual([]);
  });
});
