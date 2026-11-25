import "server-only";

import { z } from "zod";
import { agentScanResultSchema, evaluateAgentPostings, newPostings } from "@/lib/agent/run";
import { withAgentScanLock } from "@/lib/agent/scan-lock";
import { defineJob, startJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import type { FoundPosting } from "@/lib/job-search/search";
import { alertQueue } from "./queue";

const type = "morning-alert-review";
const budgetKey = "morningAlertReviewLastReservedAt";

// Job history can be swept after one hour. Keep the paid-call budget separately.
async function canReview(now: Date) {
  const last = await prisma.setting.findUnique({ where: { key: budgetKey } });
  return !last || +now - Number(last.value) >= 86400000;
}

async function reviewable(limit: number) {
  const queue = await alertQueue();
  const unique = new Map<string, FoundPosting>();
  for (const { posting } of queue) if (posting) unique.set(posting.url, posting);
  const postings = [...unique.values()];
  const fresh: FoundPosting[] = [];
  for (let offset = 0; offset < postings.length && fresh.length < limit; offset += 75) {
    fresh.push(...await newPostings(postings.slice(offset, offset + 75), { reviewSaved: true }));
  }
  return fresh.slice(0, limit);
}

export const alertReviewJob = defineJob({
  type, input: z.object({}), result: agentScanResultSchema,
  async run(_, context) {
    const result = await withAgentScanLock(async signal => {
      const settings = await loadSettings();
      const limit = Math.min(5, settings.agentMaxScores);
      const now = new Date();
      const enabled = await prisma.jobAlertMonitor.findFirst({ where: { enabled: true } });
      const postings = enabled && await canReview(now) ? await reviewable(limit) : [];
      if (postings.length) {
        const value = String(+now);
        await prisma.setting.upsert({ where: { key: budgetKey }, create: { key: budgetKey, value }, update: { value } });
      }
      return evaluateAgentPostings(postings, { ...context, signal: AbortSignal.any([context.signal, signal]) },
        { ...settings, agentAutoDraft: false, agentMaxScores: limit }, { reviewSaved: true });
    });
    if (!result) throw new Error("Another search is running. The next alert check will retry.");
    return result;
  },
});

export async function scheduleAlertReview() {
  if (!await canReview(new Date())) return;
  const running = await prisma.job.findFirst({ where: { type, status: { in: ["QUEUED", "RUNNING"] } } });
  if (!running && (await reviewable(1)).length) await startJob(alertReviewJob, {}, { key: type });
}
