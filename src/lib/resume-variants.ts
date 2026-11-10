import { z } from "zod";

import type { DocumentLabels } from "@/lib/document-labels";
import { unitsSchema, type Unit } from "@/lib/application-data";
import { profileUnits } from "@/lib/ai/tasks/tailor-resume";
import type { ProfileData } from "@/lib/profile";
import { profileSnapshotSchema } from "@/lib/profile-snapshot";

export const BASE_VARIANT = "base";
export const variantSelectionSchema = z.array(z.string().min(1).max(150)).max(2000);
export const variantOverridesSchema = z.array(z.object({ id: z.string().min(1).max(150), text: z.string().max(12000) })).max(1000);
export type ResumeVariantView = { id: string; name: string; focus: string; revision: number; selection: string[]; overrides: { id: string; text: string }[] };
export const resumeContextSchema = z.object({
  schemaVersion: z.literal(1),
  variantId: z.string(), variantName: z.string(), variantRevision: z.number().int(), focus: z.string(),
  profile: profileSnapshotSchema,
  units: unitsSchema,
});
export type ResumeContext = z.infer<typeof resumeContextSchema>;
export const editableResumeUnit = (id: string) => id === "summary" || /^(experience|project|education):/.test(id);

/** Selection changes emphasis, never the factual employer, title or dates. */
export function resolveResumeVariant(profile: ProfileData, variant: ResumeVariantView, labels?: DocumentLabels): ResumeContext {
  const originals = profileUnits(profile, labels);
  const selected = new Set(variant.selection);
  const overrides = new Map(variant.overrides.map((row) => [row.id, row.text]));
  const units: Unit[] = originals.filter((unit) => variant.id === BASE_VARIANT || selected.has(unit.id)).map((unit) => ({ ...unit, text: editableResumeUnit(unit.id) ? overrides.get(unit.id) ?? unit.text : unit.text }));
  const text = (id: string) => units.find((unit) => unit.id === id)?.text;
  const effective: ProfileData = {
    ...profile,
    basics: { ...profile.basics, summary: text("summary") ?? "" },
    experience: profile.experience.filter((row) => text(`experience:${row.id}`) !== undefined).map((row) => ({ ...row, bullets: text(`experience:${row.id}`)! })),
    projects: profile.projects.filter((row) => text(`project:${row.id}`) !== undefined).map((row) => ({ ...row, bullets: text(`project:${row.id}`)! })),
    education: profile.education.filter((row) => text(`education:${row.id}`) !== undefined).map((row) => ({ ...row, notes: text(`education:${row.id}`)! })),
    skills: text("skills") === undefined ? [] : profile.skills,
    languages: text("languages") === undefined ? [] : profile.languages,
    certifications: profile.certifications.filter((row) => text(`certification:${row.id}`) !== undefined),
    publications: profile.publications.filter((row) => text(`publication:${row.id}`) !== undefined),
    customSections: profile.customSections.map((section) => ({ ...section, items: section.items.filter((row) => section.format === "INLINE" ? text(`custom-inline:${section.id}`) !== undefined : text(`custom-${section.format === "ENTRIES" ? "entry" : "line"}:${row.id}`) !== undefined) })).filter((section) => section.items.length > 0),
  };
  return { schemaVersion: 1, variantId: variant.id, variantName: variant.name, variantRevision: variant.revision, focus: variant.focus, profile: effective, units };
}
