import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { profileForPrompt } from "@/lib/ai/tasks/prompt-parts";
import { currentCareerPreferences } from "@/lib/career/data";
import type { FoundPosting, ShownPosting } from "@/lib/job-search/search";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { formatDateRange } from "@/lib/profile";
import { recordHash } from "@/lib/record-hash";
import { storedLinkedinReview, type LinkedinCareerReview } from "./schema";

export async function linkedinCareerContext(db: Prisma.TransactionClient = prisma) {
  const [profile, preferences] = await Promise.all([loadProfile(db), currentCareerPreferences(db)]);
  const candidate = profileForPrompt(profile).slice(0, 30000);
  const evidence = [...profile.experience.slice(0, 25).map(row => ({ id: `experience:${row.id}`, label: `${row.role} · ${row.company} · ${formatDateRange(row)}`.slice(0, 500), text: row.bullets.slice(0, 1800) })), ...profile.projects.slice(0, 25).map(row => ({ id: `project:${row.id}`, label: row.name.slice(0, 500), text: row.bullets.slice(0, 1800) }))];
  return { candidate, preferences, evidence, hash: recordHash({ candidate, preferences, evidence, version: 1 }), experienceCount: profile.experience.length, projectCount: profile.projects.length };
}
export const linkedinPostingHash = (posting: Pick<FoundPosting, "title" | "company" | "place" | "remote" | "salary" | "description" | "url" | "complete">) => recordHash({ title: posting.title, company: posting.company, place: posting.place, remote: posting.remote, salary: posting.salary, description: posting.description, url: posting.url, complete: posting.complete });
export function currentLinkedinReview(raw: string, posting: Parameters<typeof linkedinPostingHash>[0], contextHash: string): LinkedinCareerReview | null {
  try { const review = storedLinkedinReview.parse(JSON.parse(raw)); return review.contextHash === contextHash && review.postingHash === linkedinPostingHash(posting) ? review : null; } catch { return null; }
}
export async function linkedinReviewView(postings: ShownPosting[]) {
  const [context, rows] = await Promise.all([linkedinCareerContext(), prisma.posting.findMany({ where: { source: "LINKEDIN", id: { in: postings.flatMap(posting => posting.state.postingId ? [posting.state.postingId] : []) } }, select: { id: true, careerReviewJson: true } })]);
  const stored = new Map(rows.map(row => [row.id, row.careerReviewJson]));
  const reviews: Record<string, LinkedinCareerReview> = {};
  for (const posting of postings) { const id = posting.state.postingId; const review = id ? currentLinkedinReview(stored.get(id) || "", posting, context.hash) : null; if (id && review) reviews[id] = review; }
  return { reviews, experienceCount: context.experienceCount, projectCount: context.projectCount, hasPreferences: !!context.preferences };
}
