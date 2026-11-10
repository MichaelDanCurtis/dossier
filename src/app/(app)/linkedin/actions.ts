"use server";

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
