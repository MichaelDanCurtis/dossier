import { z } from "zod";

import { searchQuerySchema } from "@/lib/job-search/search";

export const CAREER_KINDS = ["INTERVIEW", "PROJECT", "REVIEW", "COACH"] as const;
export const careerKindSchema = z.enum(CAREER_KINDS);
export type CareerKind = z.infer<typeof careerKindSchema>;
const short = z.string().trim().max(300);
const list = z.array(z.string().trim().min(1).max(300)).max(12);
const year = z.number().int().min(1900).max(2200).nullable();
const month = z.number().int().min(1).max(12).nullable();
const web = z.string().max(2000).refine((value) => !value || /^https?:\/\//i.test(value), "Use an http(s) evidence link.");
const span = { startYear: year, startMonth: month, endYear: year, endMonth: month, current: z.boolean() };

export const careerPreferencesSchema = z.object({
  summary: z.string().max(1500),
  wants: list,
  strengths: list,
  avoid: list,
  workStyle: list,
  locations: list,
  remote: z.enum(["any", "remote", "hybrid", "onsite"]),
  compensation: z.string().max(500),
  travel: z.string().max(500),
  tradeoffs: z.string().max(1000),
  unknowns: list,
  searches: z.array(z.object({ query: searchQuerySchema, reason: z.string().max(1000) })).max(3),
});
export type CareerPreferences = z.infer<typeof careerPreferencesSchema>;

export const careerProposalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("RESUME_EDIT"), data: z.object({ variantId: z.string().max(150), variantRevision: z.number().int().nonnegative(), unitId: z.string().max(150), expected: z.string().max(12000), text: z.string().max(12000), reason: z.string().max(1500), unverified: z.array(z.string().max(300)).max(100) }) }),
  z.object({ kind: z.literal("PREFERENCES"), data: careerPreferencesSchema }),
  z.object({ kind: z.literal("PROJECT"), data: z.object({ targetId: z.string().max(100).nullable(), name: short.min(1), bullets: z.string().max(6000), skills: list, link: web, ...span }) }),
  z.object({ kind: z.literal("CERTIFICATION"), data: z.object({ targetId: z.string().max(100).nullable(), name: short.min(1), issuer: short, status: z.enum(["planned", "in_progress", "earned", "expired"]), year, month, expiryYear: year, expiryMonth: month, link: web }) }),
  z.object({ kind: z.literal("FACT"), data: z.object({ text: z.string().trim().min(1).max(1000), evidence: z.string().max(1000) }) }),
  z.object({ kind: z.literal("UPDATE"), data: z.object({ title: short.min(1), details: z.string().max(6000), happenedAt: z.string().max(80), skills: list, evidence: z.array(web).max(10) }) }),
]);
export type CareerProposalInput = z.infer<typeof careerProposalSchema>;

export const careerAnswerSchema = z.object({
  reply: z.string().max(2000),
  question: z.string().max(1500),
  readyForReview: z.boolean(),
  proposals: z.array(z.object({ proposal: careerProposalSchema, evidenceMessageIds: z.array(z.string().max(100)).max(20) })).max(3),
});
export type CareerAnswer = z.infer<typeof careerAnswerSchema>;

// Saved searches accept older records without `experience`; strict AI APIs require
// every output field. Keep that transport rule separate from the durable format.
const aiPreferences = careerPreferencesSchema.extend({
  searches: z.array(careerPreferencesSchema.shape.searches.element.extend({
    query: searchQuerySchema.extend({ experience: searchQuerySchema.shape.experience.unwrap() }),
  })).max(3),
});
const aiProposal = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PREFERENCES"), data: aiPreferences }),
  ...careerProposalSchema.options.filter((option) => option.shape.kind.value !== "PREFERENCES"),
]);
export const careerAiAnswerSchema = careerAnswerSchema.extend({
  proposals: z.array(z.object({ proposal: aiProposal, evidenceMessageIds: z.array(z.string().max(100)).max(20) })).max(3),
});

export type CareerMessageView = { id: string; role: string; origin: string; text: string; createdAt: string };
export type CareerProposalView = { id: string; revision: number; status: string; payload: CareerProposalInput; evidence: string[]; acceptedAt: string | null };
export type CareerSessionView = { id: string; title: string; kind: CareerKind; state: string; revision: number; createdAt: string; messages: CareerMessageView[]; proposals: CareerProposalView[] };
