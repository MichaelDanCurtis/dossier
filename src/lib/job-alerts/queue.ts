import "server-only";

import { agentDedupeKey } from "@/lib/agent/candidates";
import { foundPostingSchema, linkKey, type FoundPosting } from "@/lib/job-search/search";
import { foundFromPosting } from "@/lib/postings";
import { prisma } from "@/lib/prisma";
import { employerLink } from "./parse";

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
type Listing = { id: string; posting: FoundPosting; applicationUrl: string };

function indexListing(index: Map<string, Listing[]>, key: string, listing: Listing) {
  if (!key) return;
  const entries = index.get(key);
  if (entries) entries.push(listing);
  else index.set(key, [listing]);
}

export async function alertQueue() {
  const leads = await prisma.jobAlertLead.findMany({ where: { passed: false }, orderBy: [{ received: "desc" }, { linkedinUrl: "asc" }] });
  if (!leads.length) return [];
  const [boards, saved, dismissed, applied] = await Promise.all([
    prisma.companyPosting.findMany({ where: { closedAt: null, board: { enabled: true } }, select: { id: true, postingJson: true, applicationUrl: true } }),
    prisma.posting.findMany({ where: { OR: [{ source: "LINKEDIN" }, { dismissedAt: { not: null } }, { applicationId: { not: null } }] } }),
    prisma.agentCandidate.findMany({ where: { status: { in: ["DISMISSED", "APPROVED"] } }, select: { dedupeKey: true } }),
    prisma.application.findMany({ where: { postingUrl: { not: "" }, awaitingReview: false }, select: { postingUrl: true } }),
  ]);
  const byId = new Map<string, Listing>();
  const byEmployerUrl = new Map<string, Listing[]>();
  const byTitle = new Map<string, Listing[]>();
  for (const row of boards) {
    const listing = { id: row.id, posting: foundPostingSchema.parse(JSON.parse(row.postingJson)), applicationUrl: row.applicationUrl };
    byId.set(row.id, listing);
    indexListing(byTitle, normalize(listing.posting.title), listing);
    for (const key of new Set([employerLink(listing.posting.url), employerLink(row.applicationUrl)])) indexListing(byEmployerUrl, key, listing);
  }
  const byLinkedinUrl = new Map(saved.filter(row => row.source === "LINKEDIN" && row.complete && row.savedAt).map(row => [row.url, foundFromPosting(row)]));
  const hidden = new Set([...applied.map(row => linkKey(row.postingUrl)), ...saved.filter(row => row.dismissedAt || row.applicationId).map(row => linkKey(row.url))]);
  const dismissedKeys = new Set(dismissed.map(row => row.dedupeKey));
  return leads.flatMap(lead => {
    const exact = byEmployerUrl.get(lead.employerUrl);
    const match = lead.boardRowId ? byId.get(lead.boardRowId) : exact?.length === 1 ? exact[0] : undefined;
    if ((lead.boardRowId && !match) || hidden.has(linkKey(lead.linkedinUrl))) return [];
    const posting = match?.posting.complete ? match.posting : byLinkedinUrl.get(lead.linkedinUrl);
    if (posting && (hidden.has(linkKey(posting.url)) || dismissedKeys.has(agentDedupeKey(posting)))) return [];
    const suggestions = match ? [] : (byTitle.get(normalize(lead.title)) ?? [])
      .filter(row => !lead.company || normalize(row.posting.company) === normalize(lead.company)).slice(0, 8);
    return [{ lead, posting, match, suggestions }];
  });
}

export type AlertQueue = Awaited<ReturnType<typeof alertQueue>>;
export function sourceLinks(queue: AlertQueue) {
  const links = new Map<string, Set<string>>();
  for (const { lead, posting } of queue) {
    if (!posting) continue;
    const key = linkKey(posting.url);
    const urls = links.get(key) ?? new Set<string>();
    urls.add(lead.linkedinUrl);
    links.set(key, urls);
  }
  return links;
}
