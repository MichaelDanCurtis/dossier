import "server-only";

import https from "node:https";
import { parse } from "node-html-parser";
import { z } from "zod";
import { guardedLookup } from "@/lib/posting-fetch";
import { foundPostingSchema, linkKey, type FoundPosting } from "@/lib/job-search/search";
import { recordHash } from "@/lib/record-hash";

export const boardInputSchema = z.object({ platform: z.enum(["greenhouse", "lever", "ashby"]), region: z.enum(["global", "us", "eu"]), boardToken: z.string().trim().regex(/^[A-Za-z0-9_-]{1,100}$/, "Enter the board name, not a URL."), company: z.string().trim().min(1).max(300), enabled: z.boolean(), intervalHours: z.number().int().min(6).max(168) });
export type BoardInput = z.infer<typeof boardInputSchema>;
export type Listing = { posting: FoundPosting; applicationUrl: string; version: string };
export type FeedResponse = { status: number; body: unknown; etag: string | null; lastModified: string | null };
export type FeedRequest = (url: string, headers?: Record<string, string>) => Promise<FeedResponse>;

/** Fixed public ATS hosts, public DNS at connection time, no redirects or credentials. */
export const requestFeed: FeedRequest = (address, headers = {}) => new Promise((resolve, reject) => {
  const url = new URL(address);
  if (url.protocol !== "https:" || !["boards-api.greenhouse.io", "api.lever.co", "api.eu.lever.co", "api.ashbyhq.com"].includes(url.hostname) || url.port || url.username || url.password) return reject(new Error("Unsupported company feed address."));
  const request = https.get(url, { lookup: guardedLookup, headers: { accept: "application/json", "user-agent": "Dossier-company-watchlist/1.0", ...headers }, signal: AbortSignal.timeout(30000) }, (response) => {
    const chunks: Buffer[] = []; let bytes = 0;
    response.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 12 * 1024 * 1024) response.destroy(new Error("The company feed exceeded the 12 MiB response limit.")); else chunks.push(chunk); });
    response.on("error", reject);
    response.on("end", () => {
      try {
        const status = response.statusCode ?? 0;
        if (status !== 200 && status !== 304) throw new Error(`The company feed returned HTTP ${status}. Existing postings were retained.`);
        resolve({ status, body: status === 304 ? null : JSON.parse(Buffer.concat(chunks).toString("utf8")), etag: String(response.headers.etag ?? "") || null, lastModified: String(response.headers["last-modified"] ?? "") || null });
      } catch (error) { reject(error); }
    });
  });
  request.on("error", reject);
});

const link = z.url().refine((value) => /^https:\/\//i.test(value), "The feed returned a non-HTTPS link.");
const date = (value: string | number | null | undefined) => value == null ? null : Number.isNaN(new Date(value).getTime()) ? null : new Date(value).toISOString();
export function plainDescription(html: string): string {
  let root = parse(html);
  // Greenhouse may HTML-encode the HTML once as well as JSON-encoding it.
  if (/&lt;\/?(?:p|div|ul|li|br)\b/i.test(html)) root = parse(root.text);
  root.querySelectorAll("script,style,noscript,iframe,form").forEach((node) => node.remove());
  return root.structuredText.trim();
}
const base = (board: BoardInput, id: string, title: string, place: string, url: string, description: string, remote: boolean | null, postedAt: string | null, salary = ""): FoundPosting => foundPostingSchema.parse({ source: "DIRECT", externalId: `${board.platform}:${board.region}:${board.boardToken}:${id}`, title, company: board.company, place, url, description, remote, postedAt, salary, via: board.platform, complete: !!description });

const greenhouseJob = z.object({ id: z.number().int(), internal_job_id: z.number().int().nullable(), title: z.string(), location: z.object({ name: z.string() }), absolute_url: link, updated_at: z.string(), content: z.string().optional() });
const leverJob = z.object({ id: z.string().min(1), text: z.string(), categories: z.object({ location: z.string().nullish() }), hostedUrl: link, applyUrl: link, workplaceType: z.string().optional(), createdAt: z.number().optional(), descriptionPlain: z.string().optional(), description: z.string().optional(), lists: z.array(z.object({ text: z.string(), content: z.string() })).optional(), additionalPlain: z.string().optional(), additional: z.string().optional(), salaryRange: z.object({ currency: z.string(), interval: z.string(), min: z.number(), max: z.number() }).optional() });
const ashbyJob = z.object({ title: z.string(), location: z.string(), jobUrl: link, applyUrl: link, isListed: z.boolean(), isRemote: z.boolean().optional(), workplaceType: z.string().optional(), descriptionPlain: z.string().optional(), descriptionHtml: z.string().optional(), publishedAt: z.string().optional(), compensation: z.object({ scrapeableCompensationSalarySummary: z.string().optional(), compensationTierSummary: z.string().optional() }).optional() });

export function metadataUrl(board: BoardInput): string {
  if (board.platform === "greenhouse") return `https://boards-api.greenhouse.io/v1/boards/${board.boardToken}/jobs`;
  if (board.platform === "ashby") return `https://api.ashbyhq.com/posting-api/job-board/${board.boardToken}?includeCompensation=true`;
  return `https://${board.region === "eu" ? "api.eu.lever.co" : "api.lever.co"}/v0/postings/${board.boardToken}?mode=json&limit=100&skip=0`;
}

/** Reject the whole listing on malformed/partial data; never close against a partial page. */
export async function fetchBoardListing(board: BoardInput, headers: Record<string, string>, request: FeedRequest = requestFeed): Promise<{ listings: Listing[] | null; etag: string | null; lastModified: string | null }> {
  const response = await request(metadataUrl(board), board.platform === "lever" ? {} : headers);
  if (response.status === 304) return { listings: null, etag: response.etag, lastModified: response.lastModified };
  let listings: Listing[];
  if (board.platform === "greenhouse") {
    const result = z.object({ jobs: z.array(greenhouseJob).max(10000), meta: z.object({ total: z.number().int() }) }).parse(response.body);
    if (result.jobs.length !== result.meta.total) throw new Error("The company listing was incomplete. Existing postings were retained.");
    listings = result.jobs.filter((job) => job.internal_job_id !== null).map((job) => ({ posting: base(board, String(job.id), job.title, job.location.name, job.absolute_url, job.content ? plainDescription(job.content) : "", null, null), applicationUrl: job.absolute_url, version: job.updated_at }));
  } else if (board.platform === "ashby") {
    const result = z.object({ jobs: z.array(ashbyJob).max(10000) }).parse(response.body);
    listings = result.jobs.filter((job) => job.isListed).map((job) => ({ posting: base(board, recordHash(linkKey(job.jobUrl)), job.title, job.location, job.jobUrl, job.descriptionPlain || plainDescription(job.descriptionHtml ?? ""), job.isRemote ?? (job.workplaceType === "Remote" ? true : job.workplaceType === "OnSite" ? false : null), date(job.publishedAt), job.compensation?.scrapeableCompensationSalarySummary ?? job.compensation?.compensationTierSummary ?? ""), applicationUrl: job.applyUrl, version: recordHash(job) }));
  } else {
    const all: z.infer<typeof leverJob>[] = []; const seen = new Set<string>();
    let body = response.body;
    for (let page = 0; ; page++) {
      const jobs = z.array(leverJob).max(100).parse(body);
      for (const job of jobs) { if (seen.has(job.id)) throw new Error("Lever repeated a listing page. Existing postings were retained."); seen.add(job.id); all.push(job); }
      if (jobs.length < 100) break;
      if (page >= 19) throw new Error("Lever exceeded the 2,000-role scan limit. Existing postings were retained.");
      const next = new URL(metadataUrl(board)); next.searchParams.set("skip", String((page + 1) * 100));
      const pageResponse = await request(next.toString());
      if (pageResponse.status !== 200) throw new Error("Lever pagination did not complete. Existing postings were retained.");
      body = pageResponse.body;
    }
    listings = all.map((job) => { const description = [job.descriptionPlain || plainDescription(job.description ?? ""), ...(job.lists ?? []).map((list) => `${list.text}\n${plainDescription(list.content)}`), job.additionalPlain || plainDescription(job.additional ?? "")].filter(Boolean).join("\n\n"); const salary = job.salaryRange ? `${job.salaryRange.currency} ${job.salaryRange.min}–${job.salaryRange.max} / ${job.salaryRange.interval}` : ""; return { posting: base(board, job.id, job.text, job.categories.location ?? "", job.hostedUrl, description, job.workplaceType === "remote" ? true : job.workplaceType === "on-site" ? false : null, date(job.createdAt), salary), applicationUrl: job.applyUrl, version: recordHash(job) }; });
  }
  if (new Set(listings.map((row) => row.posting.externalId)).size !== listings.length) throw new Error("The feed contained duplicate source IDs. Existing postings were retained.");
  return { listings, etag: board.platform === "lever" ? null : response.etag, lastModified: board.platform === "lever" ? null : response.lastModified };
}
export async function fetchGreenhouseDetail(board: BoardInput, externalId: string, request: FeedRequest = requestFeed): Promise<string> {
  const id = externalId.split(":").at(-1)!;
  if (!/^\d+$/.test(id)) throw new Error("Invalid Greenhouse posting ID.");
  const response = await request(`https://boards-api.greenhouse.io/v1/boards/${board.boardToken}/jobs/${id}`);
  const job = z.object({ id: z.number(), content: z.string().min(1) }).parse(response.body);
  if (String(job.id) !== id) throw new Error("Greenhouse returned another role's details.");
  return plainDescription(job.content);
}
