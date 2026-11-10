import { z } from "zod";

import { LanguageLevel, CustomSectionFormat } from "@/generated/prisma/enums";
import type { ProfileData } from "@/lib/profile";

const text = z.string();
const year = z.number().int().nullable();
const month = z.number().int().min(1).max(12).nullable();
const span = { startYear: year, startMonth: month, endYear: year, endMonth: month, current: z.boolean() };
/** Complete internal document snapshot; never a public portfolio allowlist. */
export const profileSnapshotSchema: z.ZodType<ProfileData> = z.object({
  basics: z.object({ name: text, headline: text, email: text, phone: text, dob: text, website: text, address: text, city: text, country: text, linkedin: text, summary: text, showAge: z.boolean() }),
  photo: z.object({ src: text, onResumes: z.boolean() }).nullable(),
  skills: z.array(z.object({ id: text, name: text, group: text })),
  languages: z.array(z.object({ id: text, name: text, level: z.enum(LanguageLevel) })),
  experience: z.array(z.object({ id: text, role: text, company: text, location: text, descriptor: text, volunteering: z.boolean(), bullets: text, skillIds: z.array(text), ...span })),
  projects: z.array(z.object({ id: text, name: text, link: text, bullets: text, skillIds: z.array(text), ...span })),
  education: z.array(z.object({ id: text, degree: text, school: text, notes: text, ...span })),
  certifications: z.array(z.object({ id: text, name: text, issuer: text, year, month, expiryYear: year, expiryMonth: month, credentialId: text, link: text, onResumes: z.boolean() })),
  publications: z.array(z.object({ id: text, citation: text, link: text, onResumes: z.boolean() })),
  references: z.array(z.object({ id: text, name: text, relation: text, company: text, email: text, phone: text })),
  customSections: z.array(z.object({ id: text, title: text, format: z.enum(CustomSectionFormat), items: z.array(z.object({ id: text, title: text, subtitle: text, details: text, link: text, onResumes: z.boolean(), ...span })) })),
  facts: z.array(z.object({ id: text, text })),
});
