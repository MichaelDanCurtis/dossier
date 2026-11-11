"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { checkBoard } from "@/app/(app)/companies/actions";
import { startCareerSession } from "@/app/(app)/career/actions";
import { PageHeader } from "@/components/page-header";
import { toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { useJob } from "@/hooks/use-job";
import type { careerWatchView } from "@/lib/studio/data";
import { currencies } from "@/lib/studio/schema";

import { saveCareerWatch } from "./studio-actions";

const input = "mt-1 block w-full rounded-control border border-line-input bg-input px-3 py-2";

export function CareerAgent({ view }: { view: Awaited<ReturnType<typeof careerWatchView>> }) {
  const router = useRouter();
  const [watch, setWatch] = useState(view.watch);
  const [busy, start] = useTransition();
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId, 0, (result) => { if (result.status === "DONE") router.refresh(); });
  const money = (value: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: view.watch.currency, maximumFractionDigits: 0 }).format(value);
  return <>
    <PageHeader title="Career agent" description="Keep track of your current role, published opportunities and the pay ranges you can actually compare." />
    <div className="space-y-5 px-5 pb-8 lg:px-10">
      <form className="grid gap-4 rounded-panel border border-line-card bg-card p-5 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(e) => { e.preventDefault(); start(async () => { const result = toastResult(await saveCareerWatch(watch)); if (result.ok) router.refresh(); }); }}>
        <label className="text-sm">Career status<select aria-label="Career status" className={input} value={watch.stage} onChange={(e) => setWatch({ ...watch, stage: e.target.value === "EMPLOYED" ? "EMPLOYED" : "SEARCHING" })}><option value="SEARCHING">Searching</option><option value="EMPLOYED">In a role</option></select></label>
        <label className="text-sm">Current employer<input className={input} value={watch.employer} maxLength={200} onChange={(e) => setWatch({ ...watch, employer: e.target.value })} /></label>
        <label className="text-sm">Role to watch<input className={input} value={watch.role} maxLength={200} onChange={(e) => setWatch({ ...watch, role: e.target.value })} /></label>
        <label className="text-sm">Currency<select aria-label="Currency" className={input} value={watch.currency} onChange={(e) => setWatch({ ...watch, currency: e.target.value as typeof watch.currency })}>{currencies.map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="text-sm">Current annual base pay<input className={input} type="number" min={0} max={100000000} value={watch.annualBase || ""} onChange={(e) => setWatch({ ...watch, annualBase: Number(e.target.value) })} /></label>
        <label className="text-sm">Target annual base pay<input className={input} type="number" min={0} max={100000000} value={watch.targetBase || ""} onChange={(e) => setWatch({ ...watch, targetBase: Number(e.target.value) })} /></label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-3"><Button type="submit" disabled={busy}>Save career watch</Button><p className="text-xs text-muted">Pay stays in your private workspace and is not sent to the drafting model.</p></div>
      </form>
      <section className="space-y-3 rounded-panel border border-line-card bg-card p-5">
        <h2 className="font-medium">Your employer’s board</h2>
        <p className="text-sm text-muted">Matches use the exact employer name and the role phrase on a company board you follow. A listing does not establish why it was posted.</p>
        {!view.boards.length && <p className="text-sm">No matching board configured. <Link className="underline" href="/companies">Add an employer board</Link>.</p>}
        {view.boards.map((board) => <div key={board.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{board.company} · {board.lastSuccess ? `checked ${board.lastSuccess.slice(0, 10)}` : "not checked yet"} · {board.enabled ? "checks on" : "manual checks"}</span>
          <Button size="sm" variant="secondary" disabled={busy || (!!jobId && job?.status !== "DONE" && job?.status !== "FAILED")} onClick={() => start(async () => { const result = toastResult(await checkBoard({ id: board.id })); if (result.ok) setJobId(result.data.jobId); })}>Check board now</Button></div>)}
        {job && <p role="status" className="text-sm text-muted">{job.status === "DONE" ? "Board checked." : job.status === "FAILED" ? "Board check failed. See Company boards." : "Checking the board…"}</p>}
        {view.boards.length > 0 && !view.employerRoles.length && <p className="text-sm text-muted">No matching role in the cached postings.</p>}
        {view.employerRoles.map((row) => <a key={row.url} href={row.url} className="block text-sm underline" target="_blank" rel="noreferrer">{row.title} · {row.place}</a>)}
      </section>
      <section className="space-y-3 rounded-panel border border-line-card bg-card p-5">
        <h2 className="font-medium">Comparable published pay</h2>
        <p className="text-sm text-muted">Shows saved jobs and cached company roles with an explicit annual range in your currency. These postings are individual comparisons; they do not establish a market median or total compensation.</p>
        {!view.comparisons.length && <p className="text-sm">No comparable pay ranges yet. Ranges such as “USD 120,000–160,000/year” can be compared. Ambiguous amounts stay unranked.</p>}
        {view.comparisons.map((row) => <div key={row.url} className="border-t border-line py-2 text-sm">
          <a href={row.url} target="_blank" rel="noreferrer" className="font-medium underline">{row.title} · {row.company}</a>
          <p>{row.salary}{row.range && view.watch.annualBase > 0 ? ` · ${view.watch.annualBase < row.range.min ? `${money(row.range.min - view.watch.annualBase)} below the listed minimum` : view.watch.annualBase > row.range.max ? "current pay above the listed range" : "current pay within the listed range"}` : ""}{row.range && view.watch.targetBase > 0 ? ` · ${view.watch.targetBase <= row.range.max ? "range can meet target" : "below target"}` : ""}</p>
        </div>)}
        {view.otherRoles.length > 0 && <details className="text-sm"><summary>Matching roles without comparable pay ({view.otherRoles.length})</summary>{view.otherRoles.map((row) => <p key={row.url} className="py-1"><a className="underline" href={row.url} target="_blank" rel="noreferrer">{row.title} · {row.company}</a>{row.salary ? ` · ${row.salary}` : ""}</p>)}</details>}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => start(async () => {
            const result = toastResult(await startCareerSession({ kind: "REVIEW", title: view.watch.role ? `${view.watch.role} career review` : "Career watch review" }));
            if (result.ok) router.push(`/career?session=${result.data.id}`);
          })}>Discuss with career AI</Button>
          <Link href={view.watch.role ? `/jobs?q=${encodeURIComponent(view.watch.role)}` : "/jobs"} className={buttonClassName("secondary", "sm")}>Search for opportunities</Link><Link href="/career" className={buttonClassName("secondary", "sm")}>Career check-ins</Link>
        </div>
      </section>
    </div>
  </>;
}
