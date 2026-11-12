import { z } from "zod";

export const linkedinReviewInput = z.object({ postingIds: z.array(z.string().min(1).max(100)).min(1).max(50).optional(), force: z.boolean().default(false) }).strict();
export const linkedinReviewAnswer = z.object({
  score: z.number().int().min(0).max(100),
  recommendation: z.enum(["PURSUE", "EXPLORE", "PASS"]),
  summary: z.string().min(1).max(1200),
  careerFit: z.string().min(1).max(800),
  matches: z.array(z.object({ evidenceId: z.string().min(1).max(100), requirement: z.string().min(1).max(300), explanation: z.string().min(1).max(500) })).max(4),
  gaps: z.array(z.string().min(1).max(300)).max(5),
  questions: z.array(z.string().min(1).max(300)).max(3),
});
export const storedLinkedinReview = linkedinReviewAnswer.extend({
  version: z.literal(1), contextHash: z.string().length(64), postingHash: z.string().length(64), reviewedAt: z.iso.datetime(), model: z.string().max(300), provider: z.string().max(100), truncated: z.boolean(),
  matches: z.array(linkedinReviewAnswer.shape.matches.element.extend({ label: z.string().max(500) })).max(4),
});
export type LinkedinCareerReview = z.infer<typeof storedLinkedinReview>;
export const linkedinReviewResult = z.object({ found: z.number(), reviewed: z.number(), skipped: z.number(), failed: z.number(), remaining: z.number(), message: z.string() });
export type LinkedinReviewResult = z.infer<typeof linkedinReviewResult>;
