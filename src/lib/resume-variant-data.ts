import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { ActionError } from "@/lib/action";
import { profileUnits } from "@/lib/ai/tasks/tailor-resume";
import { documentLabels } from "@/lib/document-labels";
import { lockForTransaction } from "@/lib/db-lock";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { BASE_VARIANT, editableResumeUnit, resolveResumeVariant, variantOverridesSchema, variantSelectionSchema, type ResumeVariantView } from "@/lib/resume-variants";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { cleanUnitText } from "@/lib/unit-text";

const VARIANT_LOCK = 1381190981;
function view(row: { id: string; name: string; focus: string; revision: number; selectionJson: string; overridesJson: string }): ResumeVariantView {
  return { id: row.id, name: row.name, focus: row.focus, revision: row.revision, selection: variantSelectionSchema.parse(JSON.parse(row.selectionJson)), overrides: variantOverridesSchema.parse(JSON.parse(row.overridesJson)) };
}
export async function listResumeVariants(db: Prisma.TransactionClient = prisma): Promise<ResumeVariantView[]> {
  const rows = await db.resumeVariant.findMany({ orderBy: { createdAt: "asc" } });
  const base = rows.find((row) => row.id === BASE_VARIANT);
  return [base ? view(base) : { id: BASE_VARIANT, name: "Base resume", focus: "", revision: 0, selection: [], overrides: [] }, ...rows.filter((row) => row.id !== BASE_VARIANT).map(view)];
}
export async function loadResumeContext(id?: string, db: Prisma.TransactionClient = prisma) {
  const [profile, settings, variants] = await Promise.all([loadProfile(db), loadSettings(db), listResumeVariants(db)]);
  const variant = variants.find((row) => row.id === (id ?? settings.activeResumeVariantId ?? BASE_VARIANT)) ?? (id ? undefined : variants[0]);
  if (!variant) throw new ActionError("That resume variant no longer exists. Choose another in Base resume.");
  return resolveResumeVariant(profile, variant, documentLabels(settings.resumeLanguage));
}
export async function createResumeVariant(name: string, sourceId: string) {
  return prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, VARIANT_LOCK);
    if (await tx.resumeVariant.count() >= 25) throw new ActionError("Keep up to 25 resume variants. Rename or reuse one before adding another.");
    const variants = await listResumeVariants(tx);
    const source = variants.find((row) => row.id === sourceId);
    if (!source) throw new ActionError("The resume you were copying no longer exists.");
    const profile = await loadProfile(tx);
    const selection = source.id === BASE_VARIANT ? profileUnits(profile).map((unit) => unit.id) : source.selection;
    const row = await tx.resumeVariant.create({ data: { name, focus: source.focus, selectionJson: JSON.stringify(selection), overridesJson: JSON.stringify(source.overrides) } });
    await tx.resumeVariantVersion.create({ data: { variantId: row.id, revision: 0, name: row.name, focus: row.focus, selectionJson: row.selectionJson, overridesJson: row.overridesJson, cause: "Created" } });
    return view(row);
  });
}
export async function saveResumeVariant(input: ResumeVariantView, cause = "Edited", db?: Prisma.TransactionClient): Promise<ResumeVariantView> {
  if (!db) return prisma.$transaction((tx) => saveResumeVariant(input, cause, tx));
  await lockForTransaction(db, VARIANT_LOCK);
  const existing = (await listResumeVariants(db)).find((row) => row.id === input.id);
  if (!existing || existing.revision !== input.revision) throw new ActionError("This resume changed. Reload to review the latest version before saving.");
  const profile = await loadProfile(db);
  const originals = profileUnits(profile);
  const ids = new Set(originals.map((unit) => unit.id));
  const selection = [...new Set(variantSelectionSchema.parse(input.selection))].filter((id) => ids.has(id));
  const overrides = variantOverridesSchema.parse(input.overrides).filter((row) => {
    if (ids.has(row.id)) return true;
    // A removed Profile entry must not strand a variant with an invisible edit
    // that the user cannot remove from the editor. Only unchanged saved orphans go.
    if (existing.overrides.some((old) => old.id === row.id && old.text === row.text)) return false;
    throw new ActionError("Edit factual headings, credentials and citations in Profile. Only existing resume wording can be changed here.");
  });
  if (new Set(overrides.map((row) => row.id)).size !== overrides.length || overrides.some((row) => !ids.has(row.id) || !editableResumeUnit(row.id))) throw new ActionError("Edit factual headings, credentials and citations in Profile. Only existing resume wording can be changed here.");
  const data = { name: input.id === BASE_VARIANT ? "Base resume" : input.name.trim(), focus: input.focus.trim(), selectionJson: JSON.stringify(selection), overridesJson: JSON.stringify(overrides.map((row) => ({ id: row.id, text: cleanUnitText(row.id, row.text) }))), revision: input.revision + 1 };
  if (!data.name || data.name.length > 80 || data.focus.length > 1500) throw new ActionError("Use a resume name up to 80 characters and a focus up to 1,500 characters.");
  const row = await db.resumeVariant.upsert({ where: { id: input.id }, create: { id: input.id, ...data }, update: data });
  await db.resumeVariantVersion.create({ data: { variantId: row.id, revision: row.revision, name: row.name, focus: row.focus, selectionJson: row.selectionJson, overridesJson: row.overridesJson, cause } });
  return view(row);
}
export async function restoreResumeVariantVersion(id: string, revision: number, versionId: string) {
  return prisma.$transaction(async (tx) => {
    const previous = await tx.resumeVariantVersion.findFirst({ where: { id: versionId, variantId: id } });
    if (!previous) throw new ActionError("That saved resume version no longer exists.");
    const restored = view({ ...previous, id, revision });
    // Removed profile entries cannot be restored as invented factual records.
    const ids = new Set(profileUnits(await loadProfile(tx)).map((unit) => unit.id));
    restored.overrides = restored.overrides.filter((row) => ids.has(row.id));
    restored.selection = restored.selection.filter((entry) => ids.has(entry));
    return saveResumeVariant(restored, "Restored version", tx);
  });
}
export async function selectResumeVariant(id: string) {
  await loadResumeContext(id);
  await saveSettings({ activeResumeVariantId: id });
}
