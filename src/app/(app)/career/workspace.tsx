"use client";

import { ArrowUpRight, Check, MessageCircle, Pause, Play, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { PageHeader } from "@/components/page-header";
import { toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { useJob } from "@/hooks/use-job";
import type { CareerKind, CareerPreferences, CareerProposalView, CareerSessionView } from "@/lib/career/schema";
import { searchHref } from "@/lib/job-search/search";
import type { JobView } from "@/lib/jobs/runner";

import { answerCareerQuestion, retryCareerResponse, reviewCareerProposal, saveCareerSearch, saveCareerCheckIns, setCareerSessionState, startCareerSession } from "./actions";

type Props = { sessions: { id: string; title: string; kind: string; state: string; updatedAt: string }[]; session: CareerSessionView | null; preferences: CareerPreferences | null; initialJob: JobView | null; cadence: "off" | "weekly" | "monthly"; checkInsPaused: boolean; embedded?: boolean };
const KINDS = [{ kind: "INTERVIEW", title: "Interviewer", description: "Learn what work you want, using your resume and useful follow-up questions." }, { kind: "PROJECT", title: "Project update", description: "Turn a new project into reviewed evidence, skills and a profile update." }, { kind: "REVIEW", title: "Career review", description: "Revisit your goals and what changed, with a record you can return to." }] as const;

function Proposal({ proposal, messages, busy, review }: { proposal: CareerProposalView; messages: CareerSessionView["messages"]; busy: boolean; review: (proposal: CareerProposalView, accept: boolean) => void }) {
  const { payload } = proposal;
  return <section className="rounded-panel border border-line-card bg-card p-5">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{payload.kind === "RESUME_EDIT" ? "Resume wording suggestion" : payload.kind === "PREFERENCES" ? "Job preference brief" : payload.kind === "FACT" ? "Extra career evidence" : payload.kind === "PROJECT" ? "Project proposal" : payload.kind === "CERTIFICATION" ? "Certification update" : "Career update"}</h3><span className="text-xs text-muted">{proposal.status.toLowerCase()}</span></div>
    {payload.kind === "RESUME_EDIT" ? <div className="space-y-3 text-sm"><p>{payload.data.reason}</p><div><strong>Before</strong><p className="mt-1 whitespace-pre-wrap text-muted">{payload.data.expected || "Empty"}</p></div><div><strong>Proposed wording</strong><p className="mt-1 whitespace-pre-wrap">{payload.data.text}</p></div>{payload.data.unverified.length > 0 && <p className="rounded-control border border-warning-line bg-warning-surface p-3">Check these claims against your evidence before accepting: {payload.data.unverified.join(", ")}</p>}</div> : payload.kind === "PREFERENCES" ? <div className="space-y-3 text-sm"><p>{payload.data.summary}</p><p><strong>Looking for:</strong> {payload.data.wants.join("; ") || "Not stated"}</p><p><strong>Strengths:</strong> {payload.data.strengths.join("; ") || "Not stated"}</p><p><strong>Would avoid:</strong> {payload.data.avoid.join("; ") || "Not stated"}</p><p><strong>Work style:</strong> {payload.data.workStyle.join("; ") || "Not stated"}</p><p><strong>Location:</strong> {payload.data.locations.join("; ") || "Not stated"} · {payload.data.remote}</p><p><strong>Compensation:</strong> {payload.data.compensation || "Not stated"}</p><p><strong>Travel:</strong> {payload.data.travel || "Not stated"}</p><p><strong>Tradeoffs:</strong> {payload.data.tradeoffs || "Not stated"}</p>{payload.data.searches.map((suggestion, index) => <div key={index} className="border-t border-line pt-3"><strong>Suggested search:</strong> {suggestion.query.keywords} · {[suggestion.query.place, suggestion.query.country, suggestion.query.remoteOnly ? "Remote only" : ""].filter(Boolean).join(", ") || "Location to be chosen"}<p className="mt-1 text-muted">{suggestion.reason}</p></div>)}{payload.data.unknowns.length > 0 && <p className="text-muted">Still unknown: {payload.data.unknowns.join("; ")}</p>}</div>
      : payload.kind === "PROJECT" ? <div className="space-y-2 text-sm"><strong>{payload.data.name}</strong><p className="whitespace-pre-wrap">{payload.data.bullets}</p><p>Skills: {payload.data.skills.join(", ") || "None supplied"}</p><p className="text-muted">Dates: {payload.data.startYear ? `${payload.data.startMonth ?? "?"}/${payload.data.startYear}` : "Unknown"} – {payload.data.current ? "Present" : payload.data.endYear ? `${payload.data.endMonth ?? "?"}/${payload.data.endYear}` : "Unknown"}</p>{payload.data.link && <a href={payload.data.link} target="_blank" rel="noreferrer" className="underline">Evidence link</a>}</div>
        : payload.kind === "CERTIFICATION" ? <div className="text-sm"><strong>{payload.data.name}</strong><p>{payload.data.issuer} · {payload.data.status.replaceAll("_", " ")}</p><p className="mt-2">Obtained: {payload.data.year ? `${payload.data.month ?? "?"}/${payload.data.year}` : "Not stated"} · Expires: {payload.data.expiryYear ? `${payload.data.expiryMonth ?? "?"}/${payload.data.expiryYear}` : "Not stated"}</p>{payload.data.link && <a href={payload.data.link} target="_blank" rel="noreferrer" className="underline">Verification link</a>}<p className="mt-2 text-muted">Planned/in-progress credentials stay in your career timeline. Earned credentials enter Profile only after acceptance.</p></div>
          : payload.kind === "FACT" ? <div className="text-sm"><p className="whitespace-pre-wrap">{payload.data.text}</p><p className="mt-2 text-muted">Evidence: {payload.data.evidence || "Review against your answers"}</p></div>
            : <div className="text-sm"><strong>{payload.data.title}</strong><p className="mt-2 whitespace-pre-wrap">{payload.data.details}</p><p className="mt-2 text-muted">{payload.data.happenedAt}</p></div>}
    <p className="mt-4 text-xs text-muted">Check factual claims and dates before accepting. Use a new answer to correct or replace a proposal.</p>{proposal.evidence.length > 0 && <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted">Supporting answers ({proposal.evidence.length})</summary>{proposal.evidence.map((id) => { const message = messages.find((row) => row.id === id); return message ? <blockquote key={id} className="mt-3 border-l-2 border-line-strong pl-3 whitespace-pre-wrap">{message.text}</blockquote> : null; })}</details>}
    {proposal.status === "PENDING" && <div className="mt-4 flex gap-3"><Button size="sm" disabled={busy} onClick={() => review(proposal, true)}><Check size={14} />Accept</Button><Button size="sm" variant="secondary" disabled={busy} onClick={() => review(proposal, false)}>Reject</Button></div>}
  </section>;
}

export function CareerWorkspace({ sessions, session, preferences, initialJob, cadence, checkInsPaused, embedded = false }: Props) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [checkInCadence, setCheckInCadence] = useState(cadence);
  const [paused, setPaused] = useState(checkInsPaused);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [jobId, setJobId] = useState(initialJob?.id ?? null);
  const [jobRevision, setJobRevision] = useState(0);
  const seenDone = useRef<string | null>(null);
  const liveJob = useJob<{ sessionId: string }>(jobId, jobRevision, (job) => {
    if (job.status === "DONE" && seenDone.current !== `${job.id}:${jobRevision}`) {
      seenDone.current = `${job.id}:${jobRevision}`;
      router.refresh();
    }
  });
  const job = liveJob ?? initialJob;
  const working = busy || job?.status === "QUEUED" || job?.status === "RUNNING";
  const waiting = session?.messages.at(-1)?.role === "user";

  const begin = (kind: CareerKind) => start(async () => {
    const result = toastResult(await startCareerSession({ kind, title }));
    if (result.ok) router.push(`/career?session=${result.data.id}`);
  });
  const answer = (finishing = false, skip = false) => {
    if (!session) return;
    start(async () => {
      const result = toastResult(await answerCareerQuestion({ sessionId: session.id, revision: session.revision, requestId: crypto.randomUUID(), text, finishing, skip }));
      if (result.ok) { setText(""); setJobId(result.data.jobId); router.refresh(); }
    });
  };
  const review = (proposal: CareerProposalView, accept: boolean) => start(async () => {
    const result = toastResult(await reviewCareerProposal({ id: proposal.id, revision: proposal.revision, accept }));
    if (result.ok) router.refresh();
  });
  const state = (next: "ACTIVE" | "PAUSED" | "FINISHED") => {
    if (!session) return;
    start(async () => { const result = toastResult(await setCareerSessionState({ id: session.id, revision: session.revision, state: next })); if (result.ok) router.refresh(); });
  };

  return <>
    {!embedded && <PageHeader title="Career" description="Understand the work you want, keep evidence of what you build, and review every change before it becomes part of your profile." actions={<Link className={buttonClassName("secondary")} href="/career"><Plus size={16} />New conversation</Link>} />}
    <div className={embedded ? "min-w-0" : "grid min-w-0 gap-7 px-5 pb-16 lg:grid-cols-[210px_minmax(0,1fr)] lg:px-10"}>
      {!embedded && <nav aria-label="Career conversations" className="flex min-w-0 flex-col gap-2">
        <h2 className="mb-2 text-sm font-medium">Conversations</h2>
        {sessions.length === 0 && <p className="text-sm text-muted">Your interviews and updates will appear here.</p>}
        {sessions.map((row) => <Link key={row.id} href={`/career?session=${row.id}`} aria-current={row.id === session?.id ? "page" : undefined} className={`rounded-control px-3 py-2 text-sm ${row.id === session?.id ? "bg-selected text-primary-text" : "text-muted hover:bg-hover"}`}><span className="block truncate">{row.title}</span><small className="text-xs text-muted">{row.state.toLowerCase()} · {row.updatedAt.slice(0, 10)}</small></Link>)}
      </nav>}
      <div className="flex min-w-0 max-w-[900px] flex-col gap-6">
        {!session ? <>
          <div className="rounded-panel border border-line-card bg-card p-5"><h2 className="mb-2 font-heading text-section">Start a conversation</h2><p className="mb-4 text-sm text-muted">Your configured AI receives your answers and a contact-stripped profile. Suggestions stay private and pending until you review them. You can skip, pause, correct answers and return later.</p><label className="mb-5 block text-sm">Topic or project name <input className="mt-2 block w-full rounded-control border border-line-input bg-input px-3 py-2 text-ink" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="Optional, for example: my new automation project" /></label><div className="grid gap-4 min-[700px]:grid-cols-3">{KINDS.map((item) => <div key={item.kind} className="flex flex-col gap-3"><h3 className="font-medium">{item.title}</h3><p className="flex-1 text-sm text-muted">{item.description}</p><Button variant="secondary" disabled={busy} onClick={() => begin(item.kind)}>Start {item.title.toLowerCase()}</Button></div>)}</div></div>
          {preferences && <section className="rounded-panel border border-line-card bg-card p-5"><h2 className="mb-2 font-heading text-section">Your reviewed preferences</h2><p className="text-sm">{preferences.summary}</p>{preferences.searches.map((suggestion, index) => <div key={index} className="mt-4 border-t border-line pt-4"><strong className="text-sm">{suggestion.query.keywords}</strong><p className="my-2 text-sm text-muted">{suggestion.reason}</p><div className="flex flex-wrap gap-3"><Link href={searchHref(suggestion.query)} className={buttonClassName("secondary", "sm")}>Find jobs<ArrowUpRight size={14} /></Link><Button size="sm" variant="secondary" disabled={busy} onClick={() => start(async () => { toastResult(await saveCareerSearch({ index })); })}>Save as Agent search</Button></div></div>)}</section>}
          <section className="rounded-panel border border-line-card bg-card p-5"><h2 className="mb-2 font-heading text-section">Career check-ins</h2><p className="mb-4 text-sm text-muted">Optional reviews of your confirmed updates and saved high-fit jobs. One review per current week or month after 9am in your saved time zone; missed periods are skipped. Each review uses at most two AI requests with up to 2,048 output tokens each, including one format retry. Your provider’s rates apply. Failed reviews wait for your retry.</p><div className="flex flex-wrap items-end gap-4"><label className="text-sm">Cadence<select className="mt-2 block rounded-control border border-line-input bg-input px-3 py-2" value={checkInCadence} onChange={(event) => setCheckInCadence(event.target.value as typeof checkInCadence)}><option value="off">Off</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><label className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" checked={paused} onChange={(event) => setPaused(event.target.checked)} />Pause check-ins</label><Button size="sm" variant="secondary" disabled={busy || (checkInCadence === cadence && paused === checkInsPaused)} onClick={() => start(async () => { const result = toastResult(await saveCareerCheckIns({ cadence: checkInCadence, paused })); if (result.ok) router.refresh(); })}>Save check-ins</Button><Link href="/agent" className="py-2 text-sm underline">Review saved opportunities</Link></div><p className="mt-3 text-xs text-muted">Currently {cadence === "off" ? "off" : checkInsPaused ? "paused" : cadence}. Reviews appear in your conversation history. No external account is monitored.</p></section>
          <p className="text-sm text-muted">LinkedIn live sync is not connected. You can bring career updates here yourself; external updates will need review too.</p>
        </> : <>
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-heading text-section">{session.title}</h2><p className="text-sm text-muted">{session.state.toLowerCase()} · saved as you go</p></div><div className="flex gap-3">{session.state === "PAUSED" || session.state === "FINISHED" ? <Button size="sm" variant="secondary" disabled={working} onClick={() => state("ACTIVE")}><Play size={14} />Resume</Button> : <><Button size="sm" variant="secondary" disabled={working} onClick={() => state("PAUSED")}><Pause size={14} />Pause</Button><Button size="sm" variant="secondary" disabled={working} onClick={() => state("FINISHED")}>Mark finished</Button></>}</div></div>
          <div className="flex flex-col gap-4" aria-label="Interview transcript">{session.messages.map((message) => <article key={message.id} className={`rounded-panel border border-line-card p-5 ${message.role === "assistant" ? "bg-card" : "bg-selected"}`}><p className="mb-2 text-xs font-medium text-muted">{message.role === "assistant" ? "CareerAI" : message.origin === "USER" ? "You" : message.origin === "SCHEDULE" ? "Scheduled check-in" : "Review request"}</p><p className="whitespace-pre-wrap text-sm leading-relaxed">{message.text}</p></article>)}</div>
          {working && <p role="status" className="text-sm text-muted">{job?.step || "Saving your answer…"}</p>}
          {waiting && !working && <div role="status" className="rounded-panel border border-warning-line bg-warning-surface p-4 text-sm"><p>{job?.error || "Your last answer is saved. Its response has not completed."}</p><Button size="sm" variant="secondary" className="mt-3" onClick={() => start(async () => { const result = toastResult(await retryCareerResponse({ sessionId: session.id })); if (result.ok) { setJobId(result.data.jobId); setJobRevision((value) => value + 1); } })}><RefreshCw size={14} />Retry response</Button><Link href="/settings?section=ai" className="ml-4 underline">AI settings</Link></div>}
          {["ACTIVE", "REVIEW"].includes(session.state) && !waiting && <form onSubmit={(event) => { event.preventDefault(); answer(); }} className="rounded-panel border border-line-card bg-card p-5"><label className="block text-sm font-medium">Your answer or correction<textarea className="mt-2 block min-h-28 w-full rounded-control border border-line-input bg-input px-3 py-2 text-ink" value={text} maxLength={8000} disabled={working} onChange={(event) => setText(event.target.value)} placeholder="What would you like CareerAI to understand?" /></label><div className="mt-4 flex flex-wrap gap-3"><Button type="submit" disabled={working || !text.trim()}><MessageCircle size={15} />Send answer</Button><Button variant="secondary" disabled={working} onClick={() => answer(false, true)}>Skip question</Button><Button variant="secondary" disabled={working} onClick={() => answer(true)}>Finish for review</Button></div></form>}
          {session.proposals.length > 0 && <div className="flex flex-col gap-4"><h2 className="font-heading text-section">Review proposed changes</h2>{session.proposals.filter((proposal) => proposal.status !== "SUPERSEDED").map((proposal) => <Proposal key={proposal.id} proposal={proposal} messages={session.messages} busy={working} review={review} />)}</div>}
        </>}
      </div>
    </div>
  </>;
}
