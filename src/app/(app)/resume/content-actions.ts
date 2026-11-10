"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";
import { createResumeVariant, saveResumeVariant, selectResumeVariant, restoreResumeVariantVersion } from "@/lib/resume-variant-data";
import { variantSelectionSchema, variantOverridesSchema } from "@/lib/resume-variants";
import { createCareerSession } from "@/lib/career/data";

export const createFocusResume = action(z.object({ name: z.string().trim().min(1).max(80), sourceId: z.string() }), async ({ name, sourceId }) => {
  const created = await createResumeVariant(name, sourceId);
  await selectResumeVariant(created.id);
  revalidatePath("/resume");
  return created;
});
export const saveFocusResume = action(z.object({ id: z.string(), name: z.string().trim().min(1).max(80), focus: z.string().max(1500), revision: z.number().int().nonnegative(), selection: variantSelectionSchema, overrides: variantOverridesSchema }), async (input) => {
  const saved = await saveResumeVariant(input);
  revalidatePath("/resume");
  return saved;
});
export const selectFocusResume = action(z.object({ id: z.string() }), async ({ id }) => {
  await selectResumeVariant(id);
  revalidatePath("/resume");
  return { selected: id };
});
export const restoreFocusResume = action(z.object({ id: z.string(), revision: z.number().int().nonnegative(), versionId: z.string() }), async ({ id, revision, versionId }) => {
  const saved = await restoreResumeVariantVersion(id, revision, versionId);
  revalidatePath("/resume");
  return saved;
});
export const startResumeCoach = action(z.object({ variantId: z.string() }), async ({ variantId }) => {
  return { id: await createCareerSession("COACH", "Resume coach", { variantId }) };
});
