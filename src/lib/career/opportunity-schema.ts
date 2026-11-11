import { z } from "zod";

export const opportunityInput = z.object({
  applicationId: z.string().max(150).default(""),
  title: z.string().trim().max(200),
  company: z.string().trim().max(200),
  posting: z.string().trim().max(20000),
  url: z.string().trim().max(2000).refine((s) => !s || /^https?:\/\//i.test(s), "Use an HTTP(S) posting link."),
  focus: z.string().trim().max(1500),
  // User-selected source excerpts, never an assertion that the server researched them.
  companySource: z.string().trim().max(6000),
  companySourceUrl: z.string().trim().max(2000).refine((s) => !s || /^https?:\/\//i.test(s), "Use an HTTP(S) source link."),
});
export const opportunityContextSchema = z.object({
  version: z.literal(1), capturedAt: z.iso.datetime(), applicationId: z.string(),
  title: z.string(), company: z.string(), posting: z.string(), url: z.string(), focus: z.string(),
  profile: z.string(), preferences: z.unknown(),
  evidence: z.array(z.object({ id: z.string(), label: z.string(), text: z.string() })),
  companySource: z.string(), companySourceUrl: z.string(),
});
export type OpportunityContext = z.infer<typeof opportunityContextSchema>;
export const briefingAnswerSchema = z.object({
  assessment: z.string().max(1500),
  matches: z.array(z.object({ requirement: z.string().max(300), evidenceId: z.string().max(150), explanation: z.string().max(400) })).max(4),
  tradeoffs: z.array(z.string().max(400)).max(4),
  unknowns: z.array(z.string().max(400)).max(6),
  companyNotes: z.array(z.object({ text: z.string().max(700), source: z.enum(["posting", "company-excerpt"]) })).max(4),
  questions: z.array(z.string().max(400)).max(4),
  preparation: z.array(z.string().max(400)).max(4),
});
export const practiceAnswerSchema = z.object({ reply: z.string().max(3000), question: z.string().max(1500), readyForReview: z.boolean() });
