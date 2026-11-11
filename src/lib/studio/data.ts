import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { companyPostings } from "@/lib/company-boards/data";
import { lockForTransaction } from "@/lib/db-lock";
import { foundFromPosting } from "@/lib/postings";
import { prisma } from "@/lib/prisma";
import { safeLink } from "@/lib/job-search/search";

import { annualRange, normalRole, studioKey, studioSchema, type Studio } from "./schema";

export const STUDIO_LOCK = 1128354373;

export async function loadStudio(db: Prisma.TransactionClient = prisma): Promise<Studio> {
  return (await studioSnapshot(db)).studio;
}

export async function studioSnapshot(db: Prisma.TransactionClient = prisma) {
  const row = await db.setting.findUnique({ where: { key: studioKey } });
  if (row) {
    try { return { studio: studioSchema.parse(JSON.parse(row.value)), version: row.updatedAt.toISOString() }; } catch { /* Invalid old/imported data is never executed. */ }
  }
  return { studio: studioSchema.parse({}), version: null };
}

export async function updateStudio<T>(change: (studio: Studio, tx: Prisma.TransactionClient) => Promise<T> | T): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, STUDIO_LOCK);
    const studio = await loadStudio(tx);
    const result = await change(studio, tx);
    const value = JSON.stringify(studioSchema.parse(studio));
    await tx.setting.upsert({ where: { key: studioKey }, create: { key: studioKey, value }, update: { value } });
    return result;
  });
}

export async function careerWatchView() {
  const { watch } = await loadStudio();
  const employer = normalRole(watch.employer);
  const role = normalRole(watch.role);
  const [boards, direct, saved, candidates] = await Promise.all([
    prisma.companyBoard.findMany({ select: { id: true, company: true, lastSuccess: true, enabled: true } }),
    companyPostings({}),
    prisma.posting.findMany({ where: { savedAt: { not: null }, dismissedAt: null }, orderBy: { updatedAt: "desc" }, take: 75 }),
    prisma.agentCandidate.findMany({ where: { status: { in: ["SCORED", "DRAFTED"] } }, orderBy: { updatedAt: "desc" }, take: 75 }),
  ]);
  const matchesRole = (title: string) => !!role && (normalRole(title) === role || normalRole(title).includes(role));
  const seen = new Set<string>();
  const postings = [...direct, ...saved.map(foundFromPosting), ...candidates].flatMap((p) => {
    const url = safeLink(p.url);
    if (!url || seen.has(url) || !matchesRole(p.title)) return [];
    seen.add(url);
    return [{ title: p.title, company: p.company, place: p.place, url, salary: p.salary, range: annualRange(p.salary, watch.currency), direct: p.source === "DIRECT" }];
  });
  const employerRoles = postings.filter((p) => !!employer && normalRole(p.company) === employer && p.direct);
  return {
    watch, boards: boards.filter((b) => employer && normalRole(b.company) === employer).map((b) => ({ ...b, lastSuccess: b.lastSuccess?.toISOString() ?? null })),
    employerRoles: employerRoles.slice(0, 10), comparisons: postings.filter((p) => p.range).slice(0, 12), otherRoles: postings.filter((p) => !p.range).slice(0, 10),
  };
}

export async function linkedinJobs() {
  return prisma.posting.findMany({ where: { source: "LINKEDIN", complete: true, savedAt: { not: null }, dismissedAt: null }, orderBy: { updatedAt: "desc" }, take: 50 });
}
