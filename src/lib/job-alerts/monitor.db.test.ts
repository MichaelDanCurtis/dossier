import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestClient, resetDatabase } from "@/test/db";
import { addCompanyBoard, scanCompanyBoard } from "@/lib/company-boards/data";
import { checkAlerts, configureAlerts } from "./monitor";
import { alertQueue } from "./queue";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const mail = vi.hoisted(() => ({ listAlertPage: vi.fn(), getAlertBody: vi.fn(), alertLabels: vi.fn() }));
vi.mock("@/lib/google/gmail", () => mail);
vi.mock("@/lib/google/account", () => ({
  googleConnection: async () => ({ status: "connected", email: "fixture@example.org", canRead: true }),
  loadGoogleAccount: async () => ({ email: "fixture@example.org" }),
}));
vi.mock("./review", () => ({ scheduleAlertReview: vi.fn() }));
const prisma = () => db.client!;
const received = new Date("2026-11-22T12:00:00Z");
const employer = "https://boards.greenhouse.io/example/jobs/123";
const linkedin = "https://www.linkedin.com/jobs/view/543/";
const html = `<div><a href="${linkedin}">Platform Engineer</a><div>Example</div><a href="${employer}">Apply</a></div>`;

beforeEach(async () => {
  await resetDatabase(prisma());
  vi.resetAllMocks();
  mail.alertLabels.mockResolvedValue([{ id: "INBOX", name: "INBOX" }]);
  mail.listAlertPage.mockResolvedValue({ messages: [{ id: "original" }] });
  mail.getAlertBody.mockResolvedValue({ html, plain: "", received });
});
afterAll(async () => prisma().$disconnect());

describe("private job alert monitoring", () => {
  it("joins a board scan to an alert, replays safely after partial failure, and keeps a pass", async () => {
    const board = await addCompanyBoard({ platform: "greenhouse", region: "global", boardToken: "example", company: "Example", enabled: true, intervalHours: 24 });
    await scanCompanyBoard(board.id, { request: async () => ({ status: 200, etag: null, lastModified: null, body: {
      jobs: [{ id: 123, internal_job_id: 123, title: "Platform Engineer", location: { name: "Seattle" }, absolute_url: employer, content: "<p>Build platform tools for customers.</p>", updated_at: received.toISOString() }],
      meta: { total: 1 },
    } }) });
    await configureAlerts("Inbox");
    const now = new Date(Date.now() + 5000);
    mail.listAlertPage.mockResolvedValueOnce({ messages: [{ id: "original" }], nextPageToken: "more" }).mockRejectedValueOnce(new Error("fixture outage"));
    await checkAlerts(now);
    expect(await prisma().jobAlertMonitor.findFirst()).toMatchObject({ checkedAt: null, problem: expect.any(String) });
    await checkAlerts(new Date(+now + 3600000));
    const queue = await alertQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ lead: { linkedinUrl: linkedin }, posting: { source: "DIRECT", url: employer, complete: true, title: "Platform Engineer" } });
    expect(await prisma().jobAlertReceipt.count()).toBe(1);
    expect(mail.getAlertBody).toHaveBeenCalledTimes(1);
    await prisma().jobAlertLead.update({ where: { linkedinUrl: linkedin }, data: { passed: true } });
    await checkAlerts(new Date(+now + 7200000));
    expect(await alertQueue()).toEqual([]);
  });

  it("never polls before opt-in and fences an in-flight response when paused", async () => {
    await checkAlerts();
    expect(mail.listAlertPage).not.toHaveBeenCalled();
    await configureAlerts("Inbox");
    mail.getAlertBody.mockImplementationOnce(async () => {
      await configureAlerts(null);
      return { html, plain: "", received };
    });
    await checkAlerts(new Date(Date.now() + 5000));
    expect(await prisma().jobAlertLead.count()).toBe(0);
    expect(await prisma().jobAlertReceipt.count()).toBe(0);
    expect(await prisma().jobAlertMonitor.findFirst()).toMatchObject({ enabled: false });
  });
});
