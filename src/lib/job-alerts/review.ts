import "server-only";
import { z } from "zod";
import { agentScanResultSchema, evaluateAgentPostings } from "@/lib/agent/run";
import { withAgentScanLock } from "@/lib/agent/scan-lock";
import { defineJob, startJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import { alertQueue } from "./queue";

const type = "morning-alert-review";
export const alertReviewJob = defineJob({
  type, input: z.object({}), result: agentScanResultSchema,
  async run(_, context) {
    const result = await withAgentScanLock(async signal => {
      const settings = await loadSettings();
      const queue = await alertQueue();
      const monitor = await prisma.jobAlertMonitor.findFirst({ where: { enabled: true } });
      const postings = monitor ? queue.flatMap(row => row.posting ? [row.posting] : []) : [];
      return evaluateAgentPostings(postings, { ...context, signal: AbortSignal.any([context.signal, signal]) },
        { ...settings, agentAutoDraft: false, agentMaxScores: Math.min(5, settings.agentMaxScores) }, { reviewSaved: true });
    });
    if (!result) throw new Error("Another search is running. Try the shortlist review again later.");
    return result;
  },
});

export async function scheduleAlertReview() {
  const since = new Date(Date.now() - 86400000);
  const recent = await prisma.job.findFirst({ where: { type, OR: [{ createdAt: { gte: since } }, { status: { in: ["QUEUED", "RUNNING"] } }] } });
  if (recent) return;
  if ((await alertQueue()).some(row => row.posting)) await startJob(alertReviewJob, {}, { key: type });
}
