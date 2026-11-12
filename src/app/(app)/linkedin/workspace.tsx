"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { LinkedinJobReview, type LinkedinReviewProps } from "./job-review";
import { importLinkedinJob } from "./actions";

const control = "mt-2 block w-full rounded-control border border-line-input bg-input px-3 py-2";
export function LinkedinWorkspace(props: LinkedinReviewProps) {
  const [draft, setDraft] = useState({ url: "", title: "", company: "", place: "", remote: false, salary: "", text: "" });
  const [busy, start] = useTransition(); const router = useRouter();
  return <div className="space-y-6">
    <LinkedinJobReview {...props} />
    <details className="rounded-panel border border-line-card bg-card p-5">
      <summary className="cursor-pointer font-medium">Paste a job manually</summary>
      <p className="mt-3 text-sm text-muted">Paste the full description and its LinkedIn link. You can also save jobs through your normal Chrome browser using the extension. LinkedIn cookies stay in Chrome.</p>
      <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); start(async () => { const result = toastResult(await importLinkedinJob(draft)); if (result.ok) { setDraft({ url: "", title: "", company: "", place: "", remote: false, salary: "", text: "" }); router.refresh(); } }); }}>
        <label className="text-sm sm:col-span-2">LinkedIn job link<input className={control} required type="url" value={draft.url} maxLength={2000} placeholder="https://www.linkedin.com/jobs/view/123456789/" onChange={(event) => setDraft({ ...draft, url: event.target.value })} /></label>
        <label className="text-sm">Role<input className={control} required value={draft.title} maxLength={500} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label className="text-sm">Company<input className={control} required value={draft.company} maxLength={300} onChange={(event) => setDraft({ ...draft, company: event.target.value })} /></label>
        <label className="text-sm">Location<input className={control} value={draft.place} maxLength={300} onChange={(event) => setDraft({ ...draft, place: event.target.value })} /></label>
        <label className="text-sm">Published pay (optional)<input className={control} value={draft.salary} maxLength={300} placeholder="USD 120,000–160,000/year" onChange={(event) => setDraft({ ...draft, salary: event.target.value })} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.remote} onChange={(event) => setDraft({ ...draft, remote: event.target.checked })} />Posting explicitly says remote</label>
        <label className="text-sm sm:col-span-2">Full posting text<textarea className={`${control} min-h-40`} required minLength={80} maxLength={100000} value={draft.text} onChange={(event) => setDraft({ ...draft, text: event.target.value })} /></label>
        <Button type="submit" disabled={busy}>Save opportunity</Button>
      </form>
    </details>
    <div className="flex flex-wrap gap-4 text-sm"><Link className={buttonClassName("secondary")} href="https://www.linkedin.com/jobs/" target="_blank" rel="noreferrer">Find roles on LinkedIn ↗</Link><Link href="/career" className="self-center underline">Update your career goals and project evidence</Link></div>
  </div>;
}
