import "server-only";

import { z } from "zod";
import { agentScanResultSchema, evaluateAgentPostings } from "@/lib/agent/run";
import { defineJob } from "@/lib/jobs/runner";
import { loadSettings } from "@/lib/settings-data";
import { companyPostings, scanCompanyBoard } from "./data";

export const companyBoardJob = defineJob({
  type: "company-board",
  input: z.object({ boardId: z.string(), force: z.boolean().default(false) }),
  result: z.object({ found: z.number(), enriched: z.number(), needsConfirmation: z.boolean() }),
  async run({ boardId, force }, { step, signal }) {
    signal.throwIfAborted();
    await step("Checking the employer's published roles and queued descriptions");
    return scanCompanyBoard(boardId, { force, signal });
  },
});
export const companyScoreJob = defineJob({
  type: "company-score",
  input: z.object({ boardId: z.string().optional(), keywords: z.string().max(200), remoteOnly: z.boolean() }),
  result: agentScanResultSchema,
  async run(input, context) {
    const postings = (await companyPostings(input)).filter((row) => row.complete);
    const settings = await loadSettings();
    return evaluateAgentPostings(postings, context, { ...settings, agentMaxScores: Math.min(10, settings.agentMaxScores), agentAutoDraft: false });
  },
});
