import "server-only";

import { prisma } from "@/lib/prisma";

/** A bounded, read-only snapshot. It cannot promote an observation into a fact. */
export async function careerReviewContext() {
  const [updates, opportunities] = await Promise.all([
    prisma.careerProposal.findMany({ where: { status: "ACCEPTED" }, orderBy: { acceptedAt: "desc" }, take: 12, select: { kind: true, dataJson: true, acceptedAt: true } }),
    prisma.agentCandidate.findMany({ where: { status: { in: ["SCORED", "DRAFTED"] }, score: { gte: 70 } }, orderBy: [{ score: "desc" }, { updatedAt: "desc" }], take: 5, select: { id: true, title: true, company: true, score: true, reasons: true, updatedAt: true } }),
  ]);
  return JSON.stringify({
    capturedAt: new Date().toISOString(),
    updates: updates.map((row) => ({ kind: row.kind, data: JSON.parse(row.dataJson), acceptedAt: row.acceptedAt?.toISOString() })),
    opportunities: opportunities.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
    notice: "Previously saved opportunities, not a new search. Their availability has not been rechecked. Open Agent to review them. No LinkedIn synchronization.",
  }).slice(0, 16000);
}
