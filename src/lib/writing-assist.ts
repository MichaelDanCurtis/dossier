import { z } from "zod";

export const writingInput = z.object({
  field: z.string().trim().min(1).max(500),
  text: z.string().max(12000),
  notes: z.string().trim().max(2500),
  bullets: z.boolean(),
});

export const writingAnswer = z.object({
  text: z.string(),
  reason: z.string(),
  question: z.string(),
});

export type WritingSuggestion = z.infer<typeof writingAnswer> & { unverified: string[] };

/** A pending suggestion must never replace text changed while the AI was working. */
export function replaceWritingSelection(current: string, original: string, start: number, end: number, replacement: string, limit: number): string | null {
  if (current !== original || start < 0 || end < start || end > original.length || !replacement.trim()) return null;
  const next = original.slice(0, start) + replacement + original.slice(end);
  return next.length <= limit ? next : null;
}
