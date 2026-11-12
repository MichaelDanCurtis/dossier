"use server";

import { z } from "zod";
import { bridgeRequest, bridgeStatusSchema } from "@/lib/studio/linkedin-bridge";
import { revalidatePath } from "next/cache";
import { action, ActionError } from "@/lib/action";
import { importLinkedinOpportunity, linkedinImportSchema } from "@/lib/linkedin-import";
import { isAiConfigured } from "@/lib/ai/config";
import { findUnfinishedJobs, startJob } from "@/lib/jobs/runner";
import { LINKEDIN_CAREER_REVIEW_KEY, linkedinCareerReviewJob } from "@/lib/linkedin-review/jobs";
import { linkedinReviewInput } from "@/lib/linkedin-review/schema";
import { prisma } from "@/lib/prisma";

export const reviewLinkedinCollection = action(linkedinReviewInput, async input => {
  if (!(await isAiConfigured())) throw new ActionError("Choose your writing AI provider in Settings first.");
  if (input.force && input.postingIds?.length !== 1) throw new ActionError("Choose one job to review again.");
  if (input.postingIds) {
    const count = await prisma.posting.count({ where: { id: { in: input.postingIds }, source: "LINKEDIN", savedAt: { not: null }, dismissedAt: null, complete: true } });
    if (count !== new Set(input.postingIds).size) throw new ActionError("Some selected jobs are not saved in this workspace.");
  }
  const [running] = await findUnfinishedJobs(LINKEDIN_CAREER_REVIEW_KEY);
  if (running) throw new ActionError("A career review is already running. Wait for it or stop it before reviewing another collection.");
  const jobId = await startJob(linkedinCareerReviewJob, input, { key: LINKEDIN_CAREER_REVIEW_KEY });
  revalidatePath("/linkedin"); return { jobId };
});

export const importLinkedinJob = action(linkedinImportSchema, async (input) => {
  try {
    const posting = await importLinkedinOpportunity(input);
    revalidatePath("/linkedin"); revalidatePath("/jobs");
    return { id: posting.id };
  } catch (error) {
    if (error instanceof TypeError || error instanceof Error && error.message.startsWith("Use an https://www.linkedin.com")) throw new ActionError("Paste a LinkedIn job link starting https://www.linkedin.com/jobs/view/.");
    throw error;
  }
});

/** Save only a job returned by this account's bridge, never a caller-provided description. */
export const saveBridgeOpportunity = action(z.object({ url: z.string().max(2000) }), async ({ url }) => {
  const state = bridgeStatusSchema.parse(await bridgeRequest("/status"));
  const job = state.jobs.find((row) => row.url === url);
  if (!job) throw new ActionError("This opportunity is no longer in the bridge. Refresh the collection.");
  const posting = await importLinkedinOpportunity(job, "LinkedIn browser bridge · user-reviewed import");
  revalidatePath("/linkedin"); revalidatePath("/jobs");
  return { id: posting.id };
});
