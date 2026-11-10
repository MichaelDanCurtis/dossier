import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestClient, resetDatabase } from "@/test/db";
import { addCompanyBoard, changeCompanyBoard, companyPostings, scanCompanyBoard } from "./data";
import { fetchBoardListing, type BoardInput, type FeedRequest } from "./feeds";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => { const { createTestClient } = await import("@/test/db"); db.client = createTestClient(); return { prisma: db.client }; });
const prisma = () => db.client!;
beforeEach(async () => resetDatabase(prisma()));
afterAll(async () => prisma().$disconnect());
const board: BoardInput = { platform: "greenhouse", region: "global", boardToken: "fixture", company: "Fixture company", enabled: true, intervalHours: 24 };
const day = (n: number) => new Date(Date.UTC(2026, 10, 1 + n, 12));
const gh = (id: number, internal: number | null = id) => ({ id, internal_job_id: internal, title: `Engineer ${id}`, location: { name: "London" }, absolute_url: `https://boards.greenhouse.io/fixture/jobs/${id}`, updated_at: "2026-11-01T00:00:00Z" });
const response = (body: unknown, status = 200) => ({ status, body, etag: '"fixture-v1"', lastModified: null });
const feed = (jobs: ReturnType<typeof gh>[]): FeedRequest => async (url) => /\/jobs\/\d+$/.test(url) ? response({ id: Number(url.split("/").at(-1)), content: "<p>Build useful platform tooling with our team.</p>" }) : response({ jobs, meta: { total: jobs.length } });

describe("bounded company watchlists", () => {
  it("imports complete IDs, excludes prospects and enriches separately without inventing remote geography", async () => {
    const saved = await addCompanyBoard(board);
    const result = await scanCompanyBoard(saved.id, { now: day(0), request: feed([gh(1), gh(2, null)]) });
    expect(result).toMatchObject({ found: 1, enriched: 1 });
    const postings = await companyPostings();
    expect(postings[0]).toMatchObject({ source: "DIRECT", externalId: "greenhouse:global:fixture:1", complete: true, remote: null });
    expect(await companyPostings({ remoteOnly: true })).toHaveLength(0);
    expect(await companyPostings({ keywords: "London platform" })).toHaveLength(1);
    expect(await companyPostings({ keywords: "nonexistent" })).toHaveLength(0);
  });
  it("requires two complete missing observations separated by the polling interval; failures cannot close roles", async () => {
    const saved = await addCompanyBoard(board);
    await scanCompanyBoard(saved.id, { now: day(0), request: feed([gh(1), gh(2)]) });
    await scanCompanyBoard(saved.id, { now: day(1), request: feed([gh(1)]) });
    expect((await prisma().companyPosting.findFirstOrThrow({ where: { externalId: { endsWith: ":2" } } })).missingScans).toBe(1);
    await scanCompanyBoard(saved.id, { now: new Date(day(1).getTime() + 6 * 60000), force: true, request: feed([gh(1)]) });
    await expect(scanCompanyBoard(saved.id, { now: day(2), force: true, request: async () => { throw new Error("503"); } })).rejects.toThrow();
    expect(await prisma().companyPosting.count({ where: { closedAt: { not: null } } })).toBe(0);
    await scanCompanyBoard(saved.id, { now: day(3), force: true, request: feed([gh(1)]) });
    expect(await prisma().companyPosting.count({ where: { closedAt: { not: null } } })).toBe(1);
    await scanCompanyBoard(saved.id, { now: day(4), force: true, request: feed([gh(1), gh(2)]) });
    expect(await prisma().companyPosting.count({ where: { closedAt: { not: null } } })).toBe(0);
  });
  it("guards mass disappearance and validates the exact confirmed listing again", async () => {
    const saved = await addCompanyBoard(board);
    await scanCompanyBoard(saved.id, { now: day(0), request: feed([gh(1), gh(2), gh(3)]) });
    expect((await scanCompanyBoard(saved.id, { now: day(1), request: feed([]) })).needsConfirmation).toBe(true);
    expect(await prisma().companyPosting.count({ where: { missingScans: { gt: 0 } } })).toBe(0);
    await changeCompanyBoard(saved.id, "confirm-disappearance");
    await scanCompanyBoard(saved.id, { now: day(2), force: true, request: feed([]) });
    expect(await prisma().companyPosting.count({ where: { missingScans: 1 } })).toBe(3);
    await scanCompanyBoard(saved.id, { now: day(3), force: true, request: feed([]) });
    expect(await prisma().companyPosting.count({ where: { closedAt: { not: null } } })).toBe(3);
  });
  it("uses a durable snapshot for 304 and retries unconditionally when it is corrupt", async () => {
    const saved = await addCompanyBoard(board);
    await scanCompanyBoard(saved.id, { now: day(0), request: feed([gh(1)]) });
    const unchanged = vi.fn(async () => response(null, 304));
    await scanCompanyBoard(saved.id, { now: day(1), request: unchanged });
    expect(unchanged.mock.calls).toHaveLength(1);
    expect(await companyPostings()).toHaveLength(1);
    await prisma().companyBoard.update({ where: { id: saved.id }, data: { listingJson: "invalid" } });
    const repair = vi.fn<FeedRequest>().mockResolvedValueOnce(response(null, 304)).mockResolvedValueOnce(response({ jobs: [gh(1)], meta: { total: 1 } }));
    await scanCompanyBoard(saved.id, { now: day(2), request: repair });
    expect(repair.mock.calls[0][1]).toEqual({});
    expect(repair.mock.calls[1][1]).toEqual({});
  });
  it("rejects malformed partial metadata without overwriting the last successful snapshot", async () => {
    const saved = await addCompanyBoard(board);
    await scanCompanyBoard(saved.id, { now: day(0), request: feed([gh(1), gh(2)]) });
    await expect(scanCompanyBoard(saved.id, { now: day(1), request: async () => response({ jobs: [gh(1)], meta: { total: 2 } }) })).rejects.toThrow("incomplete");
    expect(await companyPostings()).toHaveLength(2);
    expect(await prisma().companyPosting.count({ where: { missingScans: { gt: 0 } } })).toBe(0);
  });
  it("fences a stale worker after a user pauses the board", async () => {
    const saved = await addCompanyBoard(board);
    let release!: () => void; let entered!: () => void;
    const began = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pending = scanCompanyBoard(saved.id, { now: day(0), request: async (url) => { entered(); await gate; return feed([gh(1)])(url); } });
    await began; await changeCompanyBoard(saved.id, "pause"); release();
    await expect(pending).rejects.toThrow("replaced");
    expect(await prisma().companyPosting.count()).toBe(0);
    expect((await prisma().companyBoard.findUniqueOrThrow({ where: { id: saved.id } })).enabled).toBe(false);
  });
  it("paginates Lever completely and refuses repeated pages", async () => {
    const lever: BoardInput = { ...board, platform: "lever", region: "eu" };
    const job = (id: number) => ({ id: String(id), text: "Engineer", categories: { location: "Remote" }, hostedUrl: `https://jobs.eu.lever.co/fixture/${id}`, applyUrl: `https://jobs.eu.lever.co/fixture/${id}/apply`, workplaceType: "remote", descriptionPlain: "Full description", lists: [{ text: "Responsibilities", content: "<ul><li>Build things</li></ul>" }] });
    const first = Array.from({ length: 100 }, (_, i) => job(i));
    const pages = vi.fn<FeedRequest>().mockResolvedValueOnce(response(first)).mockResolvedValueOnce(response([job(100)]));
    const result = await fetchBoardListing(lever, {}, pages);
    expect(result.listings).toHaveLength(101);
    expect(pages.mock.calls[1][0]).toContain("api.eu.lever.co"); expect(pages.mock.calls[1][0]).toContain("skip=100");
    expect(result.listings![0].posting.description).toContain("Responsibilities");
    await expect(fetchBoardListing(lever, {}, async () => response(first))).rejects.toThrow("repeated");
  });
  it("uses URL identity for Ashby and excludes unlisted jobs", async () => {
    const ashby = { ...board, platform: "ashby" as const };
    const job = { title: "Engineer", location: "London", jobUrl: "https://jobs.ashbyhq.com/fixture/one", applyUrl: "https://jobs.ashbyhq.com/fixture/one/application", isListed: true, isRemote: true, descriptionPlain: "Full job description" };
    const result = await fetchBoardListing(ashby, {}, async () => response({ jobs: [job, { ...job, jobUrl: "https://jobs.ashbyhq.com/fixture/two", isListed: false }] }));
    expect(result.listings).toHaveLength(1);
    expect(result.listings![0].posting.externalId).toMatch(/^ashby:global:fixture:[a-f0-9]{64}$/);
    expect(result.listings![0].posting.remote).toBe(true);
  });
});
