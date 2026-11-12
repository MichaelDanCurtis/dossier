"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { useJob } from "@/hooks/use-job";
import type { AgentScanResult } from "@/lib/agent/run";
import type { ShownPosting } from "@/lib/job-search/search";
import type { JobView } from "@/lib/jobs/runner";
import { cancel } from "@/lib/jobs/actions";
import { scoreImportedLinkedin } from "../agent/studio-actions";
import { PostingResults } from "../jobs/posting-results";

export type LinkedinReviewProps = {
  postings: ShownPosting[];
  today: string;
  latestReview: JobView<AgentScanResult> | null;
  reviewLimit: number;
  scoringIssue: string | null;
};

export function LinkedinJobReview({ postings, today, latestReview, reviewLimit, scoringIssue }: LinkedinReviewProps) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [startedId, setStartedId] = useState<string | null>(null);
  const [view, setView] = useState("all");
  const refreshed = useRef(latestReview?.status === "DONE" || latestReview?.status === "FAILED" ? latestReview.id : null);
  const id = startedId ?? latestReview?.id ?? null;
  const watched = useJob<AgentScanResult>(id, 0, (job) => {
    if ((job.status === "DONE" || job.status === "FAILED") && refreshed.current !== job.id) {
      refreshed.current = job.id;
      router.refresh();
    }
  });
  const job = watched ?? (latestReview?.id === id ? latestReview : null);
  const running = !!id && (!job || job.status === "QUEUED" || job.status === "RUNNING");
  const reviewed = postings.filter((posting) => !!posting.state.score).length;
  const pending = postings.filter((posting) => !posting.state.score && !posting.state.applicationId && !posting.state.dismissed).length;
  const shown = postings.filter((posting) => view === "reviewed" ? !!posting.state.score : view === "unreviewed" ? !posting.state.score && !posting.state.applicationId : true)
    .toSorted((a, b) => (b.state.score?.score ?? -1) - (a.state.score?.score ?? -1));

  return <section className="space-y-5" aria-label="LinkedIn job review">
    <div className="space-y-4 rounded-panel border border-line-card bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-heading text-section">Which jobs are worth pursuing?</h2><p className="mt-2 max-w-2xl text-sm text-muted">Bring in full job descriptions from your normal Chrome browser. AI compares them with your saved experience and projects, explains the fit and concerns, and puts the strongest matches first.</p></div>
        <Link href="/linkedin?section=extension" className={buttonClassName("secondary")}>Connect Chrome / save jobs</Link>
      </div>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        {[ ["Saved jobs", postings.length], ["Reviewed", reviewed], ["Need review", pending] ].map(([label, count]) => <div key={label} className="rounded-control bg-surface p-3"><dt className="text-muted">{label}</dt><dd className="mt-1 text-xl font-semibold">{count}</dd></div>)}
      </dl>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy || running || !pending || !!scoringIssue} onClick={() => start(async () => {
          const result = toastResult(await scoreImportedLinkedin({}));
          if (result.ok) setStartedId(result.data.jobId);
        })}>{busy || running ? "Reviewing jobs…" : `Review ${Math.min(reviewLimit, pending)} ${Math.min(reviewLimit, pending) === 1 ? "job" : "jobs"} with AI`}</Button>
        {running && id && <Button variant="secondary" disabled={busy} onClick={() => start(async () => { toastResult(await cancel({ id })); })}>Stop review</Button>}
        <label className="flex items-center gap-2 text-sm">Show<select className="rounded-control border border-line-input bg-input px-3 py-2" value={view} onChange={(event) => setView(event.target.value)}><option value="all">All jobs · strongest fit first</option><option value="reviewed">Reviewed jobs</option><option value="unreviewed">Needs review</option></select></label>
      </div>
      {scoringIssue && <p className="text-sm text-warning">{scoringIssue} <Link href="/settings?section=scoring" className="underline">Set up job scoring</Link>.</p>}
      <p className="text-xs text-muted">Uses your selected scorer, up to {reviewLimit} new jobs per run. Previously reviewed jobs are skipped; use Score again on a job to reassess it. Your provider’s rates apply.</p>
      {job && <p role="status" className="text-sm">{running ? job.step || "Starting your review…" : job.status === "FAILED" ? job.error || "Review failed. Check your scoring settings and try again." : job.result?.message}</p>}
      <p className="text-sm text-muted">Choose <strong className="font-medium text-ink">Prepare tailored résumé</strong> on a role to open the posting and document workflow. Review the wording and PDF before submitting on LinkedIn yourself.</p>
    </div>
    <PostingResults key={JSON.stringify(shown.map((posting) => [posting.externalId, posting.state.score]))} mode="collection" postings={shown} today={today} embedded startLabel="Prepare tailored résumé →" emptyMessage={postings.length ? "No jobs in this view. Choose All jobs to see your saved opportunities." : "No LinkedIn jobs saved yet. Connect the Chrome extension and save a full posting, or paste one below."} />
  </section>;
}
