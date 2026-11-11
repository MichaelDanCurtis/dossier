"use server";

import { z } from "zod";
import { bridgeRequest, bridgeStatusSchema } from "@/lib/studio/linkedin-bridge";
import { revalidatePath } from "next/cache";
import { action, ActionError } from "@/lib/action";
import { importLinkedinOpportunity, linkedinImportSchema } from "@/lib/linkedin-import";

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
