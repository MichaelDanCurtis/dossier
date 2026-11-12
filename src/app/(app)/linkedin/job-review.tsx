"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { useJob } from "@/hooks/use-job";
import type { ShownPosting } from "@/lib/job-search/search";
import { postingKey } from "@/lib/job-search/search";
import type { JobView } from "@/lib/jobs/runner";
import { cancel } from "@/lib/jobs/actions";
import type { LinkedinCareerReview, LinkedinReviewResult } from "@/lib/linkedin-review/schema";
import { useStartApplication } from "../jobs/use-start-application";
import { reviewLinkedinCollection } from "./actions";

export type LinkedinReviewProps = {
  postings: ShownPosting[]; today: string; latestReview: JobView<LinkedinReviewResult> | null; reviewLimit: number; scoringIssue: string | null;
  reviews: Record<string, LinkedinCareerReview>; modelName: string; experienceCount: number; projectCount: number; hasPreferences: boolean;
  collectionIds?: string[]; invalidCollection?: boolean;
  timeZone?: string;
};
const recommendation = { PURSUE: "Worth pursuing", EXPLORE: "Worth exploring", PASS: "Lower priority" };

export function LinkedinJobReview({ postings, latestReview, reviewLimit, scoringIssue, reviews, modelName, experienceCount, projectCount, hasPreferences, collectionIds, invalidCollection, timeZone = "UTC" }: LinkedinReviewProps) {
  const router = useRouter();
  const [busy, start] = useTransition(), [startedId, setStartedId] = useState<string | null>(null), [view, setView] = useState("all");
  const refreshed = useRef(latestReview?.status === "DONE" || latestReview?.status === "FAILED" ? latestReview.id : null);
  const id = startedId ?? latestReview?.id ?? null;
  const watched = useJob<LinkedinReviewResult>(id, 0, job => { if ((job.status === "DONE" || job.status === "FAILED") && refreshed.current !== job.id) { refreshed.current = job.id; router.refresh(); } });
  const job = watched ?? (latestReview?.id === id ? latestReview : null);
  const running = !!id && (!job || job.status === "QUEUED" || job.status === "RUNNING");
  const collection = invalidCollection ? [] : collectionIds ? postings.filter(posting => collectionIds.includes(posting.state.postingId || "")) : postings;
  const reviewed = collection.filter(posting => !!reviews[posting.state.postingId || ""]).length;
  const pending = collection.length - reviewed;
  const shown = collection.filter(posting => { const review = reviews[posting.state.postingId || ""]; return view === "unreviewed" ? !review : view === "recommended" ? !!review && review.recommendation !== "PASS" : true; })
    .toSorted((a, b) => (reviews[b.state.postingId || ""]?.score ?? -1) - (reviews[a.state.postingId || ""]?.score ?? -1));
  const { starting, start: prepare } = useStartApplication();
  const review = (postingId?: string) => start(async () => {
    const result = toastResult(await reviewLinkedinCollection({ ...(postingId ? { postingIds: [postingId], force: true } : { postingIds: collectionIds, force: false }) }));
    if (result.ok) setStartedId(result.data.jobId);
  });
  return <section className="space-y-5" aria-label="LinkedIn job review">
    <div className="space-y-4 rounded-panel border border-line-card bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-heading text-section">Which jobs fit the career you want?</h2><p className="mt-2 max-w-2xl text-sm text-muted">Collect a batch from your LinkedIn search in Chrome. AI reads the full job descriptions, considers your work history and reviewed career preferences, and explains which roles are worth your time.</p></div><Link href="/linkedin?section=extension" className={buttonClassName("secondary")}>Set up Chrome collection</Link></div>
      {(collectionIds || invalidCollection) && <p className="text-sm">{collectionIds ? "Showing the jobs saved by this Chrome collection." : "This collection link could not be read."} <Link href="/linkedin?section=jobs" className="underline">Show all saved jobs</Link>.</p>}
      <dl className="grid grid-cols-3 gap-3 text-sm">{[["Saved jobs", collection.length], ["Career reviewed", reviewed], ["Need review", pending]].map(([label, count]) => <div key={label} className="rounded-control bg-surface p-3"><dt className="text-muted">{label}</dt><dd className="mt-1 text-xl font-semibold">{count}</dd></div>)}</dl>
      <div className="flex flex-wrap items-center gap-3"><Button disabled={busy || running || !pending || !!scoringIssue || !!invalidCollection} onClick={() => review()}>{busy || running ? "Reviewing jobs…" : pending ? `Review ${Math.min(reviewLimit, pending)} ${Math.min(reviewLimit, pending) === 1 ? "job" : "jobs"} with AI` : collection.length ? "All jobs reviewed" : "Review jobs with AI"}</Button>{running && id && <Button variant="secondary" disabled={busy} onClick={() => start(async () => { toastResult(await cancel({ id })); })}>Stop review</Button>}<label className="flex items-center gap-2 text-sm">Show<select className="rounded-control border border-line-input bg-input px-3 py-2" value={view} onChange={event => setView(event.target.value)}><option value="all">All jobs · strongest fit first</option><option value="recommended">Worth pursuing or exploring</option><option value="unreviewed">Needs review</option></select></label></div>
      {scoringIssue && <p className="text-sm text-warning">{scoringIssue} <Link href="/settings?section=ai" className="underline">Set up your AI provider</Link>.</p>}
      <p className="text-xs text-muted">Using {modelName} · {experienceCount} experience entries · {projectCount} confirmed projects. {hasPreferences ? "Your reviewed career preferences guide the assessment." : "Career preferences are not confirmed yet; inferred direction is labeled as such."} <Link href="/career" className="underline">Review your career direction</Link>.</p>
      <p className="text-xs text-muted">Up to {reviewLimit} new reviews per run. Provider format retries can add usage; your provider’s rates apply. Résumés are prepared only for the jobs you choose. You review and submit applications yourself.</p>
      {job && <p role="status" className="text-sm">{running ? job.step || "Starting your career review…" : job.status === "FAILED" ? job.error || "Review failed. Your saved jobs are intact." : job.result?.message}</p>}
    </div>
    {!shown.length && <p className="rounded-panel border border-line-card bg-card p-5 text-sm text-muted">{invalidCollection || collectionIds && !collection.length ? "This collection is not available in this account. Open All saved jobs or collect again from Chrome." : !collection.length ? "No LinkedIn jobs saved yet. Use the Chrome extension to collect a search, or paste a full posting below." : "No jobs in this view. Choose All jobs to see the rest."}</p>}
    <div className="grid gap-4" aria-label="Ranked opportunities">{shown.map(posting => {
      const postingId = posting.state.postingId, assessment = reviews[postingId || ""];
      return <article key={postingKey(posting)} className="space-y-3 rounded-panel border border-line-card bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-heading text-section">{posting.title}</h3><p className="mt-1 text-sm text-muted">{[posting.company, posting.place, posting.remote ? "Remote" : "", posting.salary].filter(Boolean).join(" · ")}</p></div><span className="rounded-control border border-line px-3 py-1 text-sm">{assessment ? `${recommendation[assessment.recommendation]} · ${assessment.score}/100` : "Needs career review"}</span></div>
        {assessment ? <><p className="text-sm">{assessment.summary}</p><p className="text-sm text-muted">{assessment.careerFit}</p><details className="text-sm"><summary className="cursor-pointer font-medium">Relevant experience, gaps and questions</summary><div className="mt-3 space-y-3">{assessment.matches.map((match, index) => <p key={index}><strong>{match.requirement}</strong><br />{match.explanation}<br /><span className="text-muted">Evidence: {match.label}</span></p>)}{!!assessment.gaps.length && <div><p className="font-medium">Evidence to clarify</p><ul className="list-disc space-y-1 pl-5 text-muted">{assessment.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul></div>}{!!assessment.questions.length && <div><p className="font-medium">Questions worth asking</p><ul className="list-disc space-y-1 pl-5 text-muted">{assessment.questions.map((question, index) => <li key={index}>{question}</li>)}</ul></div>}<p className="text-xs text-muted">Reviewed by {assessment.model} on {new Date(assessment.reviewedAt).toLocaleDateString("en-US", { timeZone })}. {assessment.truncated && "AI used the first 20,000 characters; the full description is saved below."} A fit assessment does not predict a hiring decision.</p></div></details></> : <p className="text-sm text-muted">Review this role with AI to get a career summary supported by your saved experience and projects.</p>}
        <details className="text-sm"><summary className="cursor-pointer">Full job description</summary><p className="mt-3 whitespace-pre-wrap break-words text-muted">{posting.description}</p></details>
        <div className="flex flex-wrap items-center gap-2">{posting.state.applicationId ? <Link href={`/applications/${encodeURIComponent(posting.state.applicationId)}`} className={buttonClassName()}>Open résumé / application</Link> : <Button disabled={!!starting} onClick={() => { const { state, ...found } = posting; void state; void prepare(found, postingKey(posting)); }}>{starting === postingKey(posting) ? "Opening…" : "Prepare tailored résumé →"}</Button>}<Button variant="secondary" disabled={busy || running || !!scoringIssue || !postingId} onClick={() => review(postingId!)}>{assessment ? "Review again" : "Review this job"}</Button><a href={posting.url} target="_blank" rel="noreferrer" className={buttonClassName("secondary")}>View on LinkedIn ↗</a></div>
        {posting.state.applicationId && <p className="text-xs text-muted">An application record exists for this role. Check its status there; preparing a résumé does not submit it.</p>}
      </article>;
    })}</div>
  </section>;
}
