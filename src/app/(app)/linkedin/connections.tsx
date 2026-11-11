"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { linkedinConnectionView } from "@/lib/studio/linkedin";
import type { StudioSource } from "@/lib/studio/schema";

import { addStudioSource, configureLinkedin, disconnectLinkedin, removeStudioSource } from "../agent/studio-actions";

type Input = { kind: "POST" | "MESSAGE" | "SOURCE"; title: string; text: string; url: string; applicationId: string };
const blank: Input = { kind: "POST", title: "", text: "", url: "", applicationId: "" };
const control = "mt-1 block w-full rounded-control border border-line-input bg-input px-3 py-2";

export function LinkedinConnections({ view, sources, applications, redirectUri, notice, section }: {
  view: Awaited<ReturnType<typeof linkedinConnectionView>>;
  sources: StudioSource[];
  applications: { id: string; title: string }[];
  redirectUri: string;
  notice: string;
  section: "publishing" | "feed" | "messages";
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const initial = { ...blank, kind: section === "messages" ? "MESSAGE" as const : "POST" as const };
  const [item, setItem] = useState<Input>(initial);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  return <div className="max-w-[960px] space-y-5">
    {section === "publishing" ? <section id="publishing" className="space-y-3 rounded-panel border border-line-card bg-card p-5">
      <h2 className="font-medium">LinkedIn publishing</h2>
      {notice && <p role="status" className="text-sm">{notice}</p>}
      <p className="text-sm text-muted">{view.connected ? `Connected as ${view.name} · access expires ${new Date(view.expiresAt!).toISOString().slice(0, 10)}.` : "Connect a LinkedIn developer app to publish reviewed text posts. This connection does not read your feed or inbox."}</p>
      <div className="flex flex-wrap gap-2">
        {view.configured && !view.connected && <a href="/api/linkedin/connect" className={buttonClassName("primary", "sm")}>Connect LinkedIn</a>}
        {view.connected && <Button size="sm" variant="secondary" disabled={busy} onClick={() => start(async () => { const r = toastResult(await disconnectLinkedin({})); if (r.ok) router.refresh(); })}>Disconnect here</Button>}
        <Link href="/agent?workspace=publicist" className={buttonClassName("secondary", "sm")}>Open Publicist agent</Link>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">Developer app setup</summary>
        <p className="my-2 text-muted">In your <a href="https://www.linkedin.com/developers/apps" className="underline" target="_blank" rel="noreferrer">LinkedIn developer app</a>, enable Sign In with LinkedIn using OpenID Connect and Share on LinkedIn. Add this authorized redirect URL:</p>
        <code className="block break-all rounded-control border border-line p-2 text-xs">{redirectUri}</code>
        <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); start(async () => {
          const r = toastResult(await configureLinkedin({ clientId, clientSecret }));
          if (r.ok) { setClientSecret(""); setClientId(""); router.refresh(); }
        }); }}>
          <label>Client ID<input className={control} required value={clientId} maxLength={250} onChange={(e) => setClientId(e.target.value)} /></label>
          <label>Client secret<input className={control} type="password" autoComplete="new-password" value={clientSecret} maxLength={2000} onChange={(e) => setClientSecret(e.target.value)} /></label>
          <div className="sm:col-span-2"><Button type="submit" size="sm" variant="secondary" disabled={busy}>Save developer app</Button></div>
        </form>
      </details>
    </section> :
    <section className="space-y-3 rounded-panel border border-line-card bg-card p-5">
      <h2 className="font-medium">{section === "messages" ? "Recruiter messages" : "Saved feed & sources"}</h2>
      <p className="text-sm text-muted">{section === "messages" ? "Keep recruiter messages with the relevant application and review them privately in Job Agent." : "Keep LinkedIn posts and industry excerpts to use as sources for Publicist drafts."}</p>
      {section === "messages" && <Link href="/agent" className="inline-block text-sm underline">Review messages in Job Agent →</Link>}
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); start(async () => {
        const r = toastResult(await addStudioSource(item));
        if (r.ok) { setItem(initial); router.refresh(); }
      }); }}>
        {section === "feed" && <label className="text-sm">What are you adding?<select aria-label="What are you adding?" className={control} value={item.kind} onChange={(e) => setItem({ ...item, kind: e.target.value as Input["kind"], applicationId: "" })}><option value="POST">LinkedIn post</option><option value="SOURCE">Industry source</option></select></label>}
        <label className="text-sm">Title or sender<input required className={control} value={item.title} maxLength={200} onChange={(e) => setItem({ ...item, title: e.target.value })} /></label>
        <label className="text-sm sm:col-span-2">Source link (optional)<input className={control} type="url" value={item.url} maxLength={2000} onChange={(e) => setItem({ ...item, url: e.target.value })} /></label>
        {item.kind === "MESSAGE" && <label className="text-sm sm:col-span-2">Link to an application (optional)<select aria-label="Link to an application (optional)" className={control} value={item.applicationId} onChange={(e) => setItem({ ...item, applicationId: e.target.value })}><option value="">No application</option>{applications.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label>}
        <Textarea className="sm:col-span-2" label="Relevant excerpt or notes" rows={4} maxLength={6000} value={item.text} onChange={(e) => setItem({ ...item, text: e.target.value })} />
        <div className="sm:col-span-2"><Button type="submit" size="sm" disabled={busy}>Save item</Button></div>
      </form>
      <ul className="divide-y divide-line">{sources.filter((source) => section === "messages" ? source.kind === "MESSAGE" : source.kind !== "MESSAGE").map((source) => <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" key={source.id}>
        <span>{source.url ? <a href={source.url} target="_blank" rel="noreferrer" className="underline">{source.title}</a> : source.title} <span className="text-muted">· {source.kind === "MESSAGE" ? "Message" : source.kind === "POST" ? "Post" : "Source"}</span></span>
        <Button size="sm" variant="text" disabled={busy} aria-label={`Remove ${source.title}`} onClick={() => start(async () => { const r = toastResult(await removeStudioSource({ id: source.id })); if (r.ok) router.refresh(); })}>Remove</Button>
      </li>)}</ul>
    </section>}
  </div>;
}
