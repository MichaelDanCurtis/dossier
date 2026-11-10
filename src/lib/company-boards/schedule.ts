import "server-only";

import { findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { companyBoardJob } from "./jobs";

export const companyBoardJobKey = (id: string) => `company-board:${id}`;
export async function checkCompanyBoardSchedule(now = new Date()) {
  const due = await prisma.companyBoard.findMany({
    where: { enabled: true, AND: [
      { OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      { OR: [{ lastAttempt: null }, { lastAttempt: { lt: new Date(now.getTime() - 15 * 60000) } }] },
      { OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }, { postings: { some: { closedAt: null, needsDetails: true, OR: [{ detailRetryAt: null }, { detailRetryAt: { lte: now } }] } } }] },
    ] }, orderBy: { lastAttempt: "asc" }, take: 3, select: { id: true },
  });
  for (const row of due) if (!(await findUnfinishedJobs(companyBoardJobKey(row.id))).length) await startJob(companyBoardJob, { boardId: row.id, force: false }, { key: companyBoardJobKey(row.id) });
}
const scheduleGlobal = globalThis as unknown as { dossierCompanyTimer?: ReturnType<typeof setInterval> };
export function startCompanyBoardSchedule() {
  if (scheduleGlobal.dossierCompanyTimer) return;
  const check = () => void checkCompanyBoardSchedule().catch((error: unknown) => logServerError("company watchlist", error));
  scheduleGlobal.dossierCompanyTimer = setInterval(check, 15 * 60000);
  scheduleGlobal.dossierCompanyTimer.unref?.(); check();
}
