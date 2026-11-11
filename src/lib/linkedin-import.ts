import "server-only";

import { z } from "zod";
import { foundPostingSchema } from "@/lib/job-search/search";
import { savePosting } from "@/lib/postings";
import { recordHash } from "@/lib/record-hash";

export const linkedinImportSchema = z.object({ url: z.string().trim().max(2000), title: z.string().trim().min(1).max(500), company: z.string().trim().min(1).max(300), place: z.string().trim().max(300), remote: z.boolean(), salary: z.string().trim().max(300).default(""), text: z.string().trim().min(80, "Paste the full job description, at least 80 characters.").max(100000) });
export function canonicalLinkedinJob(value: string): string {
  const url = new URL(value);
  const match = /^\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/.exec(url.pathname);
  if (url.protocol !== "https:" || !["linkedin.com", "www.linkedin.com"].includes(url.hostname) || url.username || url.password || url.port || !match) throw new Error("Use an https://www.linkedin.com/jobs/view/... job link.");
  return `https://www.linkedin.com/jobs/view/${match[1]}/`;
}
export async function importLinkedinOpportunity(raw: z.input<typeof linkedinImportSchema>) {
  const input = linkedinImportSchema.parse(raw);
  const url = canonicalLinkedinJob(input.url);
  const posting = foundPostingSchema.parse({ source: "LINKEDIN", externalId: `linkedin:${recordHash(url)}`, url, title: input.title, company: input.company, place: input.place, remote: input.remote ? true : null, description: input.text, complete: true, salary: input.salary, postedAt: null, via: "User-supplied LinkedIn posting" });
  return savePosting(posting);
}
