"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { PageHeader } from "@/components/page-header";
import { toast, toastResult } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveFile } from "@/lib/save-file";
import type { PublicistDraft, Studio } from "@/lib/studio/schema";

import { createPublicistDraft, editPublicistDraft, publishPublicistPost, refreshStudioNews, removePublicistDraft, saveNewsWatch } from "./studio-actions";

const feeds = { aws: "AWS News", cncf: "CNCF", microsoft: "Microsoft Security" } as const;

type Account = { id: string; name: string } | null;

function DraftCard({ draft, account }: { draft: PublicistDraft; account: Account }) {
  const router = useRouter();
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const [baseline, setBaseline] = useState({ title: draft.title, body: draft.body });
  const [approvedFor, setApprovedFor] = useState<string>();
  const approved = !!account && approvedFor === account.id;
  const setApproved = (value: boolean) => setApprovedFor(value ? account?.id : undefined);
  const [busy, start] = useTransition();
  const dirty = title !== baseline.title || body !== baseline.body;
  const stale = (baseline.body !== draft.body && draft.body !== body) || (baseline.title !== draft.title && draft.title !== title);
  const copy = async () => {
    try { await navigator.clipboard.writeText(body); toast("Draft copied."); } catch { toast("Could not copy the draft. Select and copy the text."); }
  };
  const download = () => saveFile(new Blob([`# ${title}\n\n${body}\n\n${draft.sources.length ? "## Sources\n" + draft.sources.map((source) => `- ${source.title} (${source.date.slice(0, 10)}) ${source.url}`).join("\n") : ""}`], { type: "text/markdown" }), "careerai-publicist-draft.md");
  return <article className="space-y-3 rounded-panel border border-line-card bg-card p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">{draft.title}</h3><span className="text-xs text-muted">{draft.format === "POST" ? "LinkedIn post" : "Article"} · {draft.status === "PUBLISHED" ? "Published" : draft.status === "DRAFT" ? "Draft" : "Check delivery on LinkedIn"}</span></div>
    {draft.status === "DRAFT" ? <>
      <label className="block text-sm">Draft title<input className="mt-1 block w-full rounded-control border border-line-input bg-input px-3 py-2" value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); setApproved(false); }} /></label>
      <Textarea label="Draft copy" rows={8} value={body} maxLength={16000} onChange={(e) => { setBody(e.target.value); setApproved(false); }} />
    </> : <p className="whitespace-pre-wrap break-words text-sm">{draft.body}</p>}
    {draft.sources.length > 0 && <ul className="space-y-1 text-xs text-muted">{draft.sources.map((source, i) => <li key={i}>{source.url ? <a href={source.url} target="_blank" rel="noreferrer" className="underline">{source.title}</a> : source.title} · {source.date.slice(0, 10)}</li>)}</ul>}
    {stale && <p className="text-sm text-danger">This draft changed in another tab. Reload before saving.</p>}
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" onClick={() => void copy()}>Copy draft</Button>
      <Button variant="secondary" size="sm" onClick={download}>Download Markdown</Button>
      {draft.status === "DRAFT" && <>
        <Button variant="secondary" size="sm" disabled={!dirty || stale || busy || !body.trim() || !title.trim()} onClick={() => start(async () => {
          const result = toastResult(await editPublicistDraft({ id: draft.id, expected: baseline.body, expectedTitle: baseline.title, title, body }));
          if (result.ok) { setBaseline({ title: result.data.title, body: result.data.body }); setTitle(result.data.title); setBody(result.data.body); setApproved(false); router.refresh(); }
        })}>Save draft edits</Button>
        <Button variant="text" size="sm" disabled={busy} onClick={() => { if (!window.confirm("Remove this saved draft?")) return; start(async () => { const result = toastResult(await removePublicistDraft({ id: draft.id })); if (result.ok) router.refresh(); }); }}>Remove draft</Button>
      </>}
    </div>
    {draft.status === "PUBLISHED" && draft.postUrn && <a href={`https://www.linkedin.com/feed/update/${encodeURIComponent(draft.postUrn)}/`} className="text-sm underline" target="_blank" rel="noreferrer">Open published post</a>}
    {(draft.status === "SENDING" || draft.status === "CHECK_LINKEDIN") && <p className="text-sm text-muted">CareerAI will not retry this post. Check LinkedIn for the result.</p>}
    {draft.status === "DRAFT" && draft.format === "POST" && <div className="space-y-2 border-t border-line pt-3">
      {!account ? <p className="text-sm text-muted"><Link href="/linkedin#publishing" className="underline">Connect LinkedIn</Link> to publish from here, or copy the draft.</p> : draft.body.length > 3000 ? <p className="text-sm text-muted">Shorten and save the draft to 3,000 characters or fewer to publish.</p> : <>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={approved} disabled={dirty || stale || busy} onChange={(e) => setApproved(e.target.checked)} /> I reviewed this exact saved text and approve posting it publicly as {account.name || "the connected LinkedIn member"}.</label>
        <Button size="sm" disabled={!approved || dirty || stale || busy || body !== draft.body} onClick={() => start(async () => {
          setApproved(false);
          const result = toastResult(await publishPublicistPost({ id: draft.id, expected: draft.body, connectionId: account.id, approved: true }));
          if (result.ok) toast("Published to LinkedIn.");
          router.refresh();
        })}>Publish to LinkedIn</Button>
      </>}
    </div>}
  </article>;
}

export function PublicistAgent({ studio, account }: { studio: Pick<Studio, "drafts" | "newsAuto" | "newsFeeds" | "sources">; account: Account }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [format, setFormat] = useState<"POST" | "ARTICLE">("POST");
  const [topic, setTopic] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [feedKeys, setFeedKeys] = useState<(keyof typeof feeds)[]>(studio.newsFeeds);
  const sources = studio.sources.filter((source) => source.kind !== "MESSAGE");
  return <>
    <PageHeader title="Publicist agent" description="Turn your work and selected industry sources into posts and articles you can review, edit and publish." />
    <div className="space-y-5 px-5 pb-8 lg:px-10">
      <section className="space-y-3 rounded-panel border border-line-card bg-card p-5">
        <h2 className="font-medium">Industry sources</h2>
        <p className="text-sm text-muted">Refresh publisher feeds on demand or <Link className="underline" href="/linkedin#saved-context">add a LinkedIn post or article</Link>. Private recruiter messages and salary are excluded.</p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {Object.entries(feeds).map(([id, name]) => <label key={id} className="flex gap-1.5"><input type="checkbox" checked={feedKeys.includes(id as keyof typeof feeds)} onChange={(e) => setFeedKeys(e.target.checked ? [...feedKeys, id as keyof typeof feeds] : feedKeys.filter((key) => key !== id))} /> {name}</label>)}
          <Button variant="secondary" size="sm" disabled={busy || !feedKeys.length} onClick={() => start(async () => { const r = toastResult(await refreshStudioNews({ feeds: feedKeys })); if (r.ok) { if (r.data.errors.length) toast(`Could not refresh: ${r.data.errors.join(", ")}`); router.refresh(); } })}>Refresh industry news</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <Button variant="secondary" size="sm" disabled={busy || !feedKeys.length} onClick={() => start(async () => {
            const r = toastResult(await saveNewsWatch({ enabled: !studio.newsAuto, feeds: feedKeys }));
            if (r.ok) router.refresh();
          })}>{studio.newsAuto ? "Pause daily news checks" : "Enable daily news checks"}</Button>
          {studio.newsAuto ? `Daily checks on: ${studio.newsFeeds.map((key) => feeds[key]).join(", ")}.` : "Daily checks off."} Checks collect sources only.
        </div>
        {!sources.length && <p className="text-sm text-muted">No sources saved. You can also draft directly from your own brief.</p>}
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {sources.map((source) => <div className="flex items-start gap-2 border-t border-line pt-2 text-sm" key={source.id}>
            <input type="checkbox" aria-label={`Use ${source.title}`} checked={selected.includes(source.id)} disabled={!selected.includes(source.id) && selected.length >= 6} onChange={(e) => setSelected(e.target.checked ? [...selected, source.id] : selected.filter((id) => id !== source.id))} />
            <div>{source.url ? <a href={source.url} className="underline" target="_blank" rel="noreferrer">{source.title}</a> : source.title} <span className="text-xs text-muted">· {source.publishedAt?.slice(0, 10) ?? "Imported"}</span>
              {source.text && <p className="line-clamp-2 text-xs text-muted">{source.text}</p>}
            </div>
          </div>)}
        </div>
      </section>
      <form className="space-y-3 rounded-panel border border-line-card bg-card p-5" onSubmit={(e) => { e.preventDefault(); start(async () => {
        const r = toastResult(await createPublicistDraft({ format, topic, sourceIds: selected.filter((id) => sources.some((s) => s.id === id)) }));
        if (r.ok) { setTopic(""); router.refresh(); }
      }); }}>
        <h2 className="font-medium">Draft something</h2>
        <label className="flex flex-wrap items-center gap-2 text-sm">Format<select aria-label="Format" className="rounded-control border border-line-input bg-input px-3 py-2" value={format} onChange={(e) => setFormat(e.target.value === "ARTICLE" ? "ARTICLE" : "POST")}><option value="POST">LinkedIn post</option><option value="ARTICLE">Article</option></select></label>
        <Textarea label="Your brief" rows={4} value={topic} maxLength={4000} placeholder="What did you build, learn or notice? Include what you can share publicly and the audience you want to reach." onChange={(e) => setTopic(e.target.value)} />
        <p className="text-xs text-muted">Only your brief and selected source excerpts go to your AI provider. Drafts stay here until you publish or copy them.</p>
        <Button type="submit" disabled={busy || topic.trim().length < 5}>{busy ? "Working…" : "Generate draft"}</Button>
      </form>
      {studio.drafts.map((draft) => <DraftCard key={draft.id} draft={draft} account={account} />)}
    </div>
  </>;
}
