import "server-only";
import { z } from "zod";

import { agentScanResultSchema, evaluateAgentPostings } from "@/lib/agent/run";
import { defineJob } from "@/lib/jobs/runner";
import { listPostings } from "@/lib/postings";
import { loadSettings } from "@/lib/settings-data";

export const scoreLinkedinJob = defineJob({
  type: "linkedin-score",
  input: z.object({}),
  result: agentScanResultSchema,
  async run(_input, context) {
    const [settings, saved] = await Promise.all([loadSettings(), listPostings("saved")]);
    // Read the whole saved collection before applying the review budget, so
    // already-reviewed recent jobs cannot hide older jobs behind a page cap.
    const rows = saved.filter((posting) => posting.source === "LINKEDIN" && posting.complete);
    const result = await evaluateAgentPostings(rows, context, { ...settings, agentMaxScores: Math.min(10, settings.agentMaxScores), agentAutoDraft: false }, { reviewSaved: true });
    const remaining = Math.max(0, result.fresh - result.scored);
    if (result.scored) result.message = `Reviewed ${result.scored} LinkedIn ${result.scored === 1 ? "job" : "jobs"}. ${remaining ? `${remaining} still need review; run again to continue.` : "Your fit explanations are saved."} Choose a role to prepare a tailored resume. Nothing was submitted.`;
    if (result.scored && result.scored < Math.min(result.fresh, 10, settings.agentMaxScores)) result.message += " Some reviews did not finish. Check your scorer before retrying those jobs.";
    else if (!result.fresh) result.message = rows.length ? "No new jobs need review. Previously reviewed, dismissed and applied jobs are skipped. Use Score again on an individual job to refresh its assessment." : "Bring jobs in from Chrome or paste a posting to start a review.";
    return result;
  },
});
