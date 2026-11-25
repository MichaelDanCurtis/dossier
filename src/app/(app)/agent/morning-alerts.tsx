"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toastResult } from "@/components/toast";
import { setAlertLabel, checkAlertMail, changeAlert } from "./alert-actions";

export type AlertItem = {
  url: string; title: string; company: string; employer: string | null; complete: boolean;
  suggestions: { id: string; label: string; url: string }[];
};
type Props = {
  items: AlertItem[]; label: string; enabled: boolean; checked: string | null;
  lastAlert: string | null; retry: string | null; problem: string | null; unrecognized: number; review: string | null;
};

export function MorningAlerts(props: Props) {
  const [label, setLabel] = useState(props.label || "Inbox");
  const [busy, start] = useTransition();
  const router = useRouter();
  const configure = (value: string | null) => start(async () => {
    if (toastResult(await setAlertLabel({ label: value })).ok) router.refresh();
  });
  const choose = (url: string, choice: "pass" | "match" | "prepare", boardId?: string) => start(async () => {
    const result = toastResult(await changeAlert({ url, choice, boardId }));
    if (result.ok && result.data) router.push(result.data);
    else router.refresh();
  });
  return <section className="space-y-3 rounded-panel border border-line-card bg-card p-5">
    <h2 className="font-heading text-section">LinkedIn job alerts</h2>
    <details open={!props.enabled || undefined}><summary className="cursor-pointer">Mailbox and monitoring</summary>
      <p className="my-2 text-sm text-muted">Enable daily email alerts for your searches on LinkedIn. CareerAI checks the Gmail label you choose hourly for LinkedIn job alerts, starting with the past 30 days. Up to five new roles with full descriptions can use your configured scorer each day.</p>
      <p className="mb-2 text-sm">Start a LinkedIn search, set your location, then turn on its job alert and choose daily email delivery. Try <a className="underline" href="https://www.linkedin.com/jobs/search/?keywords=forward%20deployed%20engineer" target="_blank" rel="noreferrer">Forward deployed engineer</a> · <a className="underline" href="https://www.linkedin.com/jobs/search/?keywords=AI%20platform%20lead" target="_blank" rel="noreferrer">AI platform lead</a>.</p>
      <div className="flex flex-wrap items-end gap-2"><label className="text-sm">Gmail label<input value={label} onChange={e => setLabel(e.target.value)} className="block rounded-control border border-line bg-input p-2" /></label>
        <Button disabled={busy || !label.trim()} onClick={() => configure(label)}>{props.enabled ? "Update label" : "Enable monitoring"}</Button>
        {props.enabled && <Button variant="secondary" disabled={busy} onClick={() => configure(null)}>Pause</Button>}
        <Link className="underline" href="/settings?section=google">Gmail connection</Link></div>
    </details>
    <p className="text-sm">{props.enabled ? "Monitoring " + props.label : "Monitoring off"}{props.checked && " · Last checked " + props.checked}{props.lastAlert && " · Latest alert " + props.lastAlert}{props.enabled && props.retry && " · Next check " + props.retry}</p>
    {props.problem && <p role="alert">{props.problem}</p>}
    {props.unrecognized > 0 && <p className="text-sm">{props.unrecognized} alert emails had no recognizable job links.</p>}
    {props.review && <p className="text-sm">Latest fit review · {props.review}</p>}
    {props.enabled && !props.checked && <Button variant="secondary" disabled={busy} onClick={() => start(async () => { toastResult(await checkAlertMail({})); router.refresh(); })}>Check for alerts</Button>}
    <p className="text-sm"><Link className="underline" href="/companies">Manage employer watchlist</Link> · <Link className="underline" href="/settings?section=agent">Manage recurring searches</Link></p>
    {props.items.length > 0 && <details><summary>Alerts awaiting review ({props.items.length})</summary>
      <ul className="divide-y divide-line">{props.items.map(item => <li key={item.url} className="space-y-2 py-3 text-sm">
        <strong>{item.title}</strong> {item.company} · <a className="underline" href={item.url} target="_blank" rel="noreferrer">LinkedIn posting</a>
        {item.employer && <> · <a className="underline" href={item.employer} target="_blank" rel="noreferrer">Employer listing</a></>}
        <p>{item.complete ? "Full description available for review." : "Only a lead so far. Confirm the employer listing or add the full description."}</p>
        {item.suggestions.map(s => <div key={s.id}><a href={s.url} target="_blank" rel="noreferrer" className="underline">{s.label}</a> <Button size="sm" variant="secondary" disabled={busy} onClick={() => choose(item.url, "match", s.id)}>Same opening</Button></div>)}
        <div className="flex items-center gap-3">{item.complete ? <Button size="sm" disabled={busy} onClick={() => choose(item.url, "prepare")}>Prepare résumé</Button> : <Link className="underline" href={`/linkedin?section=jobs&alert=${encodeURIComponent(item.url)}#paste-job`}>Add full posting</Link>}
        <Button size="sm" variant="text" disabled={busy} onClick={() => choose(item.url, "pass")}>Pass</Button></div>
      </li>)}</ul></details>}
  </section>;
}
