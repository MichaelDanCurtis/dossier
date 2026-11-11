import { z } from "zod";

export const studioKey = "careerStudio";
export const linkedinKeys = ["linkedInAppId", "linkedInClientSecretEnc", "linkedInConnectionEnc"] as const;
export const currencies = ["USD", "CAD", "GBP", "EUR", "AUD", "NZD", "CHF", "INR"] as const;
export const httpsLink = z.string().trim().max(2000).refine((value) => {
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password; } catch { return false; }
}, "Enter an HTTPS link.");
export const careerWatchSchema = z.object({
  stage: z.enum(["SEARCHING", "EMPLOYED"]),
  employer: z.string().trim().max(200),
  role: z.string().trim().max(200),
  annualBase: z.number().int().min(0).max(100000000),
  targetBase: z.number().int().min(0).max(100000000),
  currency: z.enum(currencies),
});
export const defaultCareerWatch = { stage: "SEARCHING", employer: "", role: "", annualBase: 0, targetBase: 0, currency: "USD" } as const;
export const studioSourceInput = z.object({
  kind: z.enum(["POST", "MESSAGE", "SOURCE"]),
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().max(6000),
  url: z.union([z.literal(""), httpsLink]),
  applicationId: z.string().max(100),
});
export const studioSource = studioSourceInput.extend({
  kind: z.enum(["POST", "MESSAGE", "SOURCE", "NEWS"]),
  id: z.string().max(100), createdAt: z.iso.datetime(), publishedAt: z.iso.datetime().optional(),
  feed: z.string().optional(),
  analysis: z.object({ summary: z.string().max(1000), nextStep: z.string().max(1000) }).optional(),
});
export const publicistDraft = z.object({
  id: z.string().max(100),
  format: z.enum(["POST", "ARTICLE"]),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(16000),
  createdAt: z.iso.datetime(),
  status: z.enum(["DRAFT", "SENDING", "PUBLISHED", "CHECK_LINKEDIN"]),
  postUrn: z.string().max(300).optional(),
  sources: z.array(z.object({ title: z.string().max(200), url: z.union([z.literal(""), httpsLink]), date: z.iso.datetime() })).max(6),
});
export const studioSchema = z.object({
  watch: careerWatchSchema.default(defaultCareerWatch),
  sources: z.array(studioSource).max(80).default([]),
  drafts: z.array(publicistDraft).max(30).default([]),
  newsAuto: z.boolean().default(false),
  newsFeeds: z.array(z.enum(["aws", "cncf", "microsoft"])).max(3).default(["aws", "cncf", "microsoft"]),
  lastNewsCheck: z.iso.datetime().optional(),
});
export type Studio = z.infer<typeof studioSchema>;
export type StudioSource = z.infer<typeof studioSource>;
export type PublicistDraft = z.infer<typeof publicistDraft>;
export type CareerWatch = z.infer<typeof careerWatchSchema>;

export function normalRole(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Compare only amounts explicitly labeled with the same currency and annual cadence. */
export function annualRange(text: string, currency: CareerWatch["currency"]): { min: number; max: number } | null {
  const value = text.trim().replace(/\s+/g, " ");
  const m = /^(USD|CAD|GBP|EUR|AUD|NZD|CHF|INR)\s+((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(k)?(?:\s*(?:[-–—]|to)\s*(?:([A-Z]{3})\s+)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(k)?)?\s*(?:\/\s*(?:year|yr)|per year|a year|annual(?:ly)?)$/i.exec(value);
  if (!m || m[1].toUpperCase() !== currency) return null;
  if (m[4] && m[4].toUpperCase() !== currency) return null;
  const amount = (n: string, k: string | undefined) => Number(n.replace(/,/g, "")) * (k ? 1000 : 1);
  const min = amount(m[2], m[3]), max = m[5] ? amount(m[5], m[6]) : min;
  return min > 0 && max >= min && max <= 100000000 ? { min, max } : null;
}
