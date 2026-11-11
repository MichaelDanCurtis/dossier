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
export const publicistPreferences = z.object({
  industry: z.string().trim().max(200).default(""),
  topics: z.array(z.string().trim().min(1).max(100)).max(12).default([]),
  exclude: z.array(z.string().trim().min(1).max(100)).max(12).default([]),
  audience: z.string().trim().max(500).default(""),
  voice: z.string().trim().max(2000).default(""),
  expertise: z.string().trim().max(3000).default(""),
  connectionId: z.string().max(100).default(""),
  model: z.string().trim().max(200).default(""),
  effort: z.enum(["default", "low", "medium", "high"]).default("default"),
  imageConnectionId: z.string().max(100).default(""),
  imageModel: z.string().trim().max(200).default(""),
});
// Defaults belong on stored preferences, not on partial edits: otherwise
// changing voice could reset the separately saved industry and feed filters.
export const publicistPreferencePatch = z.object({
  industry: publicistPreferences.shape.industry.removeDefault().optional(),
  topics: publicistPreferences.shape.topics.removeDefault().optional(),
  exclude: publicistPreferences.shape.exclude.removeDefault().optional(),
  audience: publicistPreferences.shape.audience.removeDefault().optional(),
  voice: publicistPreferences.shape.voice.removeDefault().optional(),
  expertise: publicistPreferences.shape.expertise.removeDefault().optional(),
  connectionId: publicistPreferences.shape.connectionId.removeDefault().optional(),
  model: publicistPreferences.shape.model.removeDefault().optional(),
  effort: publicistPreferences.shape.effort.removeDefault().optional(),
  imageConnectionId: publicistPreferences.shape.imageConnectionId.removeDefault().optional(),
  imageModel: publicistPreferences.shape.imageModel.removeDefault().optional(),
});
export const customNewsFeed = z.object({ id: z.string().max(100), name: z.string().trim().min(1).max(100), url: httpsLink });
export const publicistTurn = z.object({
  id: z.string().max(100), role: z.enum(["user", "assistant"]), text: z.string().max(6000),
});
export const publicistAnswer = z.object({
  reply: z.string(),
  ideas: z.array(z.object({ title: z.string(), angle: z.string(), question: z.string() })),
  visual: z.object({ prompt: z.string(), altText: z.string(), photoQuery: z.string() }),
});
export const studioSchema = z.object({
  watch: careerWatchSchema.default(defaultCareerWatch),
  sources: z.array(studioSource).max(80).default([]),
  drafts: z.array(publicistDraft).max(30).default([]),
  newsAuto: z.boolean().default(false),
  newsFeeds: z.array(z.string().max(100)).max(10).default(["aws", "cncf", "microsoft"]),
  customNewsFeeds: z.array(customNewsFeed).max(10).default([]),
  publicist: publicistPreferences.default(() => publicistPreferences.parse({})),
  publicistChat: z.object({
    revision: z.number().int().nonnegative().default(0),
    messages: z.array(publicistTurn).max(30).default([]),
    ideas: z.array(z.object({ title: z.string().max(200), angle: z.string().max(1500), question: z.string().max(500) })).max(3).default([]),
    visual: z.object({ prompt: z.string().max(4000), altText: z.string().max(500), photoQuery: z.string().max(200) }).optional(),
    pending: z.object({ id: z.string(), at: z.number() }).optional(),
  }).default({ revision: 0, messages: [], ideas: [] }),
  lastNewsCheck: z.iso.datetime().optional(),
});
export type Studio = z.infer<typeof studioSchema>;
export type StudioSource = z.infer<typeof studioSource>;
export type PublicistDraft = z.infer<typeof publicistDraft>;
export type CareerWatch = z.infer<typeof careerWatchSchema>;
export type PublicistPreferences = z.infer<typeof publicistPreferences>;

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
