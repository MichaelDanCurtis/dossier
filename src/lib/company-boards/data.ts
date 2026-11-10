import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ActionError } from "@/lib/action";
import { lockForTransaction } from "@/lib/db-lock";
import { foundPostingSchema, linkKey, type FoundPosting } from "@/lib/job-search/search";
import { prisma } from "@/lib/prisma";
import { recordHash } from "@/lib/record-hash";
import { boardInputSchema, fetchBoardListing, fetchGreenhouseDetail, requestFeed, type BoardInput, type FeedRequest, type Listing } from "./feeds";

const BOARD_LOCK = 1146244946;
const listingSchema = z.array(z.object({ posting: foundPostingSchema, applicationUrl: z.string(), version: z.string() })).max(10000);
const HOUR = 3600000;
const rowsOf = (value: string | null): Listing[] | null => { try { const parsed = listingSchema.safeParse(JSON.parse(value ?? "null")); return parsed.success ? parsed.data : null; } catch { return null; } };

export async function addCompanyBoard(input: BoardInput) {
  const data = boardInputSchema.parse(input);
  if (data.platform !== "lever" && data.region !== "global") throw new ActionError("Choose Global for Greenhouse and Ashby. The EU option is for Lever.");
  return prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, BOARD_LOCK);
    if (await tx.companyBoard.count() >= 25) throw new ActionError("Keep up to 25 company boards per account.");
    if (await tx.companyBoard.findUnique({ where: { platform_region_boardToken: { platform: data.platform, region: data.region, boardToken: data.boardToken } } })) throw new ActionError("That board is already in your watchlist.");
    return tx.companyBoard.create({ data });
  });
}
export async function listCompanyBoards() {
  const boards = await prisma.companyBoard.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { postings: true } } } });
  return Promise.all(boards.map(async (row) => ({ id: row.id, company: row.company, platform: row.platform, boardToken: row.boardToken, enabled: row.enabled, intervalHours: row.intervalHours, lastSuccess: row.lastSuccess?.toISOString() ?? null, nextCheckAt: row.nextCheckAt?.toISOString() ?? null, error: row.error, pendingDisappearance: !!row.pendingListingJson, found: row._count.postings, awaitingDetails: await prisma.companyPosting.count({ where: { boardId: row.id, needsDetails: true, closedAt: null } }) })));
}
export async function changeCompanyBoard(id: string, change: "enable" | "pause" | "remove" | "confirm-disappearance") {
  return prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, BOARD_LOCK);
    const board = await tx.companyBoard.findUnique({ where: { id } });
    if (!board) throw new ActionError("That company board no longer exists.");
    if (change === "remove") { await tx.companyBoard.delete({ where: { id } }); return; }
    if (change === "confirm-disappearance") {
      if (!board.pendingListingJson) throw new ActionError("There is no listing change waiting for confirmation.");
      const pending = z.object({ hash: z.string(), previous: z.number(), incoming: z.number() }).parse(JSON.parse(board.pendingListingJson));
      await tx.companyBoard.update({ where: { id }, data: { allowedDisappearanceHash: pending.hash, nextCheckAt: new Date(), etag: null, lastModified: null, generation: { increment: 1 }, leaseToken: null, leaseUntil: null } });
    } else await tx.companyBoard.update({ where: { id }, data: { enabled: change === "enable", generation: { increment: 1 }, leaseToken: null, leaseUntil: null } });
  });
}

/** A stale worker cannot overwrite a newer scan or a paused/imported watchlist. */
export async function scanCompanyBoard(id: string, { now = new Date(), force = false, request, signal }: { now?: Date; force?: boolean; request?: FeedRequest; signal?: AbortSignal } = {}) {
  const guardedRequest: FeedRequest = async (url, headers) => { signal?.throwIfAborted(); const result = await (request ?? requestFeed)(url, headers); signal?.throwIfAborted(); return result; };
  const claim = await prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, BOARD_LOCK);
    const board = await tx.companyBoard.findUnique({ where: { id } });
    if (!board) throw new ActionError("That company board no longer exists.");
    if (board.leaseUntil && board.leaseUntil > now) throw new ActionError("This company board is already being checked.");
    if (board.lastAttempt && now.getTime() - board.lastAttempt.getTime() < 5 * 60000) throw new ActionError("This board was checked recently. Wait five minutes before checking again.");
    const leaseToken = randomUUID();
    const leased = await tx.companyBoard.update({ where: { id }, data: { generation: { increment: 1 }, leaseToken, leaseUntil: new Date(now.getTime() + 15 * 60000), lastAttempt: now } });
    return { ...leased, leaseToken, board: boardInputSchema.parse(leased) };
  });
  try {
    const cached = claim.listingSchema === 1 && claim.listingAt ? rowsOf(claim.listingJson) : null;
    const due = force || !cached || !claim.nextCheckAt || claim.nextCheckAt <= now;
    let listings = cached; let observed = false;
    let etag = claim.etag, lastModified = claim.lastModified;
    if (due) {
      const headers: Record<string, string> = {};
      if (cached && claim.etag) headers["if-none-match"] = claim.etag;
      if (cached && claim.lastModified) headers["if-modified-since"] = claim.lastModified;
      let answer = await fetchBoardListing(claim.board, headers, guardedRequest);
      if (answer.listings === null && !cached) answer = await fetchBoardListing(claim.board, {}, guardedRequest);
      if (answer.listings === null && !cached) throw new Error("The feed returned 304 without a valid saved listing. Existing postings were retained.");
      listings = answer.listings ?? cached;
      etag = answer.etag ?? etag; lastModified = answer.lastModified ?? lastModified;
      observed = true;
    }
    if (!listings) throw new Error("No complete company listing is available.");
    const old = await prisma.companyPosting.findMany({ where: { boardId: id } });
    const previous = new Map(old.map((row) => [row.externalId, row]));
    const ids = listings.map((row) => row.posting.externalId).sort();
    const active = old.filter((row) => !row.closedAt);
    const incoming = new Set(ids);
    const missing = active.filter((row) => !incoming.has(row.externalId)).length;
    const listingHash = recordHash(ids);
    const massDrop = observed && missing > 0 && (ids.length === 0 || missing >= Math.max(3, active.length / 2));
    if (massDrop && claim.allowedDisappearanceHash !== listingHash) {
      await prisma.companyBoard.updateMany({ where: { id, generation: claim.generation, leaseToken: claim.leaseToken }, data: { pendingListingJson: JSON.stringify({ hash: listingHash, previous: active.length, incoming: ids.length }), error: `The listing lost ${missing} of ${active.length} open roles. Review this change before closure tracking continues.`, leaseToken: null, leaseUntil: null, nextCheckAt: new Date(now.getTime() + claim.intervalHours * HOUR) } });
      return { found: old.length, enriched: 0, needsConfirmation: true };
    }
    const details = new Map<string, { text?: string; error?: string }>();
    if (claim.board.platform === "greenhouse") {
      const pending = listings.filter((item) => {
        const row = previous.get(item.posting.externalId);
        return !item.posting.complete && (!row || row.sourceVersion !== item.version || row.needsDetails && (!row.detailRetryAt || row.detailRetryAt <= now));
      }).sort((a, b) => (previous.get(a.posting.externalId)?.detailsCheckedAt?.getTime() ?? 0) - (previous.get(b.posting.externalId)?.detailsCheckedAt?.getTime() ?? 0)).slice(0, 10);
      for (const item of pending) {
        try { const text = await fetchGreenhouseDetail(claim.board, item.posting.externalId, guardedRequest); foundPostingSchema.parse({ ...item.posting, description: text, complete: !!text }); details.set(item.posting.externalId, { text }); }
        catch { details.set(item.posting.externalId, { error: "The posting details could not be read. They will be retried later." }); }
      }
    }
    return await prisma.$transaction(async (tx) => {
      await lockForTransaction(tx, BOARD_LOCK);
      signal?.throwIfAborted();
      if (!await tx.companyBoard.findFirst({ where: { id, generation: claim.generation, leaseToken: claim.leaseToken } })) throw new ActionError("A newer board change replaced this scan. Its results were discarded.");
      for (const item of listings!) {
        const prior = previous.get(item.posting.externalId);
        const detail = details.get(item.posting.externalId);
        const retained = prior && prior.sourceVersion === item.version ? foundPostingSchema.parse(JSON.parse(prior.postingJson)) : null;
        const posting = { ...item.posting, description: detail?.text ?? (item.posting.complete ? item.posting.description : retained?.description ?? ""), complete: !!(detail?.text || item.posting.complete || retained?.complete) };
        const fields = { originalUrl: posting.url, applicationUrl: item.applicationUrl, urlKey: linkKey(posting.url), postingJson: JSON.stringify(posting), contentHash: recordHash(posting), sourceVersion: item.version, needsDetails: !posting.complete && claim.platform === "greenhouse", lastSeen: now, closedAt: null, missingScans: 0, lastMissingAt: null, ...(detail ? { detailsCheckedAt: now, detailError: detail.error ?? null, detailRetryAt: detail.error ? new Date(now.getTime() + HOUR) : null } : {}) };
        await tx.companyPosting.upsert({ where: { boardId_externalId: { boardId: id, externalId: posting.externalId } }, create: { boardId: id, externalId: posting.externalId, ...fields, firstSeen: now }, update: fields });
      }
      if (observed) for (const row of old.filter((row) => !incoming.has(row.externalId) && !row.closedAt)) {
        if (row.lastMissingAt && now.getTime() - row.lastMissingAt.getTime() < claim.intervalHours * HOUR) continue;
        await tx.companyPosting.update({ where: { id: row.id }, data: { missingScans: { increment: 1 }, lastMissingAt: now, ...(row.missingScans >= 1 ? { closedAt: now } : {}) } });
      }
      await tx.companyBoard.update({ where: { id }, data: { ...(observed ? { listingJson: JSON.stringify(listings), listingSchema: 1, listingAt: now, etag, lastModified, nextCheckAt: new Date(now.getTime() + claim.intervalHours * HOUR) } : {}), lastSuccess: observed ? now : claim.lastSuccess, error: observed ? null : claim.error, failureCount: observed ? 0 : claim.failureCount, leaseToken: null, leaseUntil: null, pendingListingJson: null, allowedDisappearanceHash: massDrop ? listingHash : null } });
      return { found: listings!.length, enriched: [...details.values()].filter((row) => row.text).length, needsConfirmation: false };
    }, { timeout: 60000 });
  } catch (error) {
    await prisma.companyBoard.updateMany({ where: { id, generation: claim.generation, leaseToken: claim.leaseToken }, data: { error: error instanceof ActionError ? error.message : "The board check failed. Existing roles were retained; check the board name and try again later.", failureCount: { increment: 1 }, nextCheckAt: new Date(now.getTime() + Math.min(72, claim.intervalHours * 2 ** Math.min(claim.failureCount, 4)) * HOUR), leaseToken: null, leaseUntil: null } });
    throw error;
  }
}

/** Local cache filtering: no claim of country or distance coverage. */
export async function companyPostings({ boardId, keywords = "", remoteOnly = false, closed = false }: { boardId?: string; keywords?: string; remoteOnly?: boolean; closed?: boolean } = {}): Promise<FoundPosting[]> {
  const rows = await prisma.companyPosting.findMany({ where: { ...(boardId ? { boardId } : {}), closedAt: closed ? { not: null } : null }, orderBy: { firstSeen: "desc" }, take: 10000 });
  const terms = keywords.toLowerCase().split(/\s+/).filter(Boolean);
  const urls = new Set<string>();
  return rows.flatMap((row) => {
    const parsed = foundPostingSchema.safeParse(JSON.parse(row.postingJson));
    if (!parsed.success || urls.has(row.urlKey)) return [];
    const posting = parsed.data;
    if (remoteOnly && posting.remote !== true || !terms.every((term) => `${posting.title} ${posting.company} ${posting.place} ${posting.description}`.toLowerCase().includes(term))) return [];
    urls.add(row.urlKey); return [posting];
  }).slice(0, 500);
}
