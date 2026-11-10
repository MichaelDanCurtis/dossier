"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";
import { acknowledgePackageDifferences } from "@/lib/application-package";

export const acknowledgeEmployerHistory = action(z.object({ id: z.string().min(1), approvalHash: z.string().regex(/^[a-f0-9]{64}$/) }), async ({ id, approvalHash }) => {
  await acknowledgePackageDifferences(id, approvalHash);
  revalidatePath(`/applications/${id}`);
  return { acknowledged: true };
});
