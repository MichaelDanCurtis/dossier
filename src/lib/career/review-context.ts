import "server-only";

import { careerWatchView } from "@/lib/studio/data";
import { prisma } from "@/lib/prisma";

/** A bounded, read-only snapshot. It cannot promote an observation into a fact. */
export async function careerReviewContext() {
  const [updates, opportunities, market] = await Promise.all([
    prisma.careerProposal.findMany({ where: { status: "ACCEPTED" }, orderBy: { acceptedAt: "desc" }, take: 12, select: { kind: true, dataJson: true, acceptedAt: true } }),
    prisma.agentCandidate.findMany({ where: { status: { in: ["SCORED", "DRAFTED"] }, score: { gte: 70 } }, orderBy: [{ score: "desc" }, { updatedAt: "desc" }], take: 5, select: { id: true, title: true, company: true, score: true, reasons: true, updatedAt: true } }),
    careerWatchView(),
  ]);
  return JSON.stringify({
    capturedAt: new Date().toISOString(),
    updates: updates.map((row) => ({ kind: row.kind, data: JSON.parse(row.dataJson), acceptedAt: row.acceptedAt?.toISOString() })),
    opportunities: opportunities.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
    careerWatch: market.watch.role ? {
      status: market.watch.stage, role: market.watch.role, employer: market.watch.employer,
      observedMatchingEmployerRoles: market.employerRoles.length,
      comparablePublishedRanges: market.comparisons.length,
      employerRoles: market.employerRoles.slice(0, 5).map(({ title, url }) => ({ title, url })),
      publishedPay: market.comparisons.slice(0, 5).map(({ title, company, url, salary, range }) => ({
        title, company, url, publishedPay: salary,
        currentPayPosition: !market.watch.annualBase || !range ? "not compared" : market.watch.annualBase < range.min ? "below this published range" : market.watch.annualBase > range.max ? "above this published range" : "within this published range",
        meetsTarget: !market.watch.targetBase || !range ? "not compared" : market.watch.targetBase <= range.max ? "range can meet target" : "below target",
      })),
      note: "Cached company boards and saved opportunities. A matching employer listing does not establish why it was posted. No personal salary is included.",
    } : null,
    notice: "Previously saved opportunities, not a new search. Their availability has not been rechecked. Open Agent to review them. No LinkedIn synchronization.",
  }).slice(0, 16000);
}
