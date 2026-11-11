import "server-only";
import { z } from "zod";

import { agentScanResultSchema, evaluateAgentPostings } from "@/lib/agent/run";
import { defineJob } from "@/lib/jobs/runner";
import { foundFromPosting } from "@/lib/postings";
import { loadSettings } from "@/lib/settings-data";

import { linkedinJobs } from "./data";

export const scoreLinkedinJob = defineJob({
  type: "linkedin-score",
  input: z.object({}),
  result: agentScanResultSchema,
  async run(_input, context) {
    const [settings, rows] = await Promise.all([loadSettings(), linkedinJobs()]);
    return evaluateAgentPostings(rows.map(foundFromPosting), context, { ...settings, agentMaxScores: Math.min(10, settings.agentMaxScores), agentAutoDraft: false });
  },
});
