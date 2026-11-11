"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { useJob } from "@/hooks/use-job";
import type { StudioSource } from "@/lib/studio/schema";

import { reviewLinkedinMessage, scoreImportedLinkedin } from "./studio-actions";

export function LinkedinIntake({ messages, jobs }: { messages: StudioSource[]; jobs: number }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId, 0, (value) => { if (value.status === "DONE") router.refresh(); });
  return <section className="space-y-3 rounded-panel border border-line-card bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-medium">LinkedIn intake</h2><Link href="/linkedin" className="text-sm underline">Open LinkedIn workspace</Link></div>
    <p className="text-sm text-muted">{jobs} saved {jobs === 1 ? "job" : "jobs"} · {messages.length} imported {messages.length === 1 ? "message" : "messages"}. Imported messages are separate from Gmail. Review uses only the message you choose.</p>
    {!!jobs && <Button size="sm" variant="secondary" disabled={busy || (!!jobId && job?.status !== "DONE" && job?.status !== "FAILED")} onClick={() => start(async () => { const result = toastResult(await scoreImportedLinkedin({})); if (result.ok) setJobId(result.data.jobId); })}>Score imported jobs</Button>}
    {job && <p className="text-sm text-muted" role="status">{job.status === "DONE" ? "Scoring finished. See Scored postings." : job.status === "FAILED" ? "Scoring failed. Check your selected scorer." : "Scoring imported jobs…"}</p>}
    {messages.slice(0, 10).map((message) => <details key={message.id} className="border-t border-line pt-3 text-sm">
      <summary className="cursor-pointer font-medium">{message.title}</summary>
      <p className="my-2 whitespace-pre-wrap break-words">{message.text}</p>
      {message.applicationId && <Link href={`/applications/${encodeURIComponent(message.applicationId)}`} className="block pb-2 underline">Open linked application</Link>}
      {message.analysis && <div className="mb-2 rounded-control bg-surface p-3"><p>{message.analysis.summary}</p><p className="mt-1 font-medium">{message.analysis.nextStep}</p></div>}
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => start(async () => { const result = toastResult(await reviewLinkedinMessage({ id: message.id })); if (result.ok) router.refresh(); })}>{busy ? "Reviewing…" : "Review with AI"}</Button>
      {message.url && <a href={message.url} target="_blank" rel="noreferrer" className="ml-3 underline">Open source</a>}
    </details>)}
  </section>;
}
