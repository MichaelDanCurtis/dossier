"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toastResult } from "@/components/toast";
import type { GithubConnectionView } from "@/lib/career/github-schema";
import { allowPrivateGithubRepository, connectedGithubRepositories, connectPrivateGithub, disconnectPrivateGithub, removePrivateGithubRepository } from "./actions";

const control = "mt-2 block w-full rounded-control border border-line-input bg-input px-3 py-2 text-ink";
type Row = { name: string; description: string; fork: boolean; private: boolean };
export function GithubConnection({ initial, disabled, onPreview, onAccessChanged }: { initial: GithubConnectionView; disabled: boolean; onPreview: (name: string) => void; onAccessChanged: () => void }) {
  const [view, setView] = useState(initial);
  const [token, setToken] = useState("");
  const [busy, start] = useTransition();
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [name, setName] = useState("");
  const locked = disabled || busy;
  const update = (next: GithubConnectionView) => { setView(next); onAccessChanged(); };
  const list = (next: number) => start(async () => { const result = toastResult(await connectedGithubRepositories({ page: next })); if (result.ok) { setRows((prev) => next === 1 ? result.data : [...prev, ...result.data]); setPage(next); setMore(result.data.length === 30); } });
  const allow = (repository: string) => start(async () => { const r = toastResult(await allowPrivateGithubRepository({ name: repository })); if (r.ok) { update(r.data); setName(""); } });
  return <section className="space-y-4 rounded-panel border border-line-card bg-card p-5" aria-label="Private GitHub connection">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-heading text-section">Private GitHub access</h3>{view.state === "connected" && <span className="text-sm text-success">Connected as {view.login}</span>}</div>
    <p className="text-sm text-muted">Choose which repositories CareerAI may research. It reads selected documentation and never pushes code, changes repository settings or runs repository scripts. Reading a repository does not establish your personal contribution.</p>
    {view.state !== "connected" && <p className="text-sm">{view.state === "unreadable" ? "The saved connection cannot be read. Replace it below." : "Connect a read-only token to include private repositories."}</p>}
    <details open={view.state !== "connected"}>
      <summary className="cursor-pointer text-sm">{view.state === "connected" ? "Replace token or review setup" : "Set up read-only GitHub access"}</summary>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
        <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer" className="underline">GitHub’s fine-grained token form</a>. Name it CareerAI and choose an expiration.</li>
        <li>Choose the resource owner and <strong>Only select repositories</strong>. Select the repositories you want CareerAI to read.</li>
        <li>Under Repository permissions, set <strong>Contents: Read-only</strong>. Metadata read access is included. No write or account permissions are needed.</li>
        <li>Generate the token on GitHub, then paste it into the field below. Organization access may need approval from its owner.</li>
      </ol>
      <p className="mt-3 text-xs text-muted">Your token is encrypted on this private CareerAI instance. It is never returned to the browser, sent to an AI model or included in data exports. Replacing it clears the repository selections below. <a href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens" target="_blank" rel="noreferrer" className="underline">GitHub token guide</a></p>
      <form onSubmit={(event) => { event.preventDefault(); start(async () => { const result = toastResult(await connectPrivateGithub({ token })); if (result.ok) { update(result.data); setToken(""); setRows([]); setPage(0); setMore(false); } }); }} className="mt-4 space-y-3">
        <label className="block text-sm">Fine-grained GitHub token<input type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} className={control} maxLength={256} placeholder="github_pat_…" disabled={locked} /></label>
        <Button type="submit" disabled={locked || !token.trim()}>{view.state === "connected" ? "Replace GitHub connection" : "Connect GitHub"}</Button>
      </form>
    </details>
    {view.state === "connected" && <>
      {view.expiresAt && <p className="text-xs text-muted">GitHub token expiration: {view.expiresAt}</p>}
      <div className="flex flex-wrap gap-3"><Button variant="secondary" disabled={locked} onClick={() => list(1)}>List accessible repositories</Button><Button variant="secondary" disabled={locked} onClick={() => start(async () => { const r = toastResult(await disconnectPrivateGithub({})); if (r.ok) { update(r.data); setRows([]); setToken(""); setMore(false); } })}>Disconnect GitHub</Button></div>
      <p className="text-xs text-muted">Disconnect stops new reads and analysis. Saved research remains in your private history. To revoke the token itself, use GitHub’s token settings.</p>
      <div className="space-y-3 border-t border-line pt-4"><h4 className="font-medium">Repositories allowed for research ({view.repositories.length}/30)</h4>{view.repositories.length === 0 && <p className="text-sm text-muted">Allow a repository below before previewing private documentation.</p>}
        <ul className="divide-y divide-line">{view.repositories.map((repo) => <li key={repo.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><span className="min-w-0 break-words text-sm">{repo.name} <small className="text-muted">· {repo.private ? "Private" : "Public"}</small></span><span className="flex gap-2"><Button size="sm" variant="secondary" disabled={locked} onClick={() => onPreview(repo.name)}>Preview documentation</Button><Button size="sm" variant="secondary" disabled={locked} onClick={() => start(async () => { const r = toastResult(await removePrivateGithubRepository({ name: repo.name })); if (r.ok) update(r.data); })}>Remove access</Button></span></li>)}</ul>
      </div>
      {rows.length > 0 && <div><h4 className="mb-2 font-medium">Available through your GitHub token</h4><ul className="max-h-96 divide-y divide-line overflow-auto">{rows.map((repo) => <li key={repo.name} className="flex items-center justify-between gap-4 py-3"><div className="min-w-0"><strong className="break-words text-sm">{repo.name}</strong><p className="text-xs text-muted">{repo.private ? "Private" : "Public"}{repo.fork ? " · Fork" : ""}</p><p className="text-sm text-muted">{repo.description}</p></div><Button size="sm" variant="secondary" disabled={locked || view.repositories.length >= 30 || view.repositories.some((r) => r.name === repo.name)} onClick={() => allow(repo.name)}>{view.repositories.some((r) => r.name === repo.name) ? "Allowed" : "Allow research"}</Button></li>)}</ul></div>}
      {more && <Button variant="secondary" disabled={locked} onClick={() => list(page + 1)}>More accessible repositories</Button>}
      <form onSubmit={(e) => { e.preventDefault(); allow(name); }} className="flex flex-wrap items-end gap-3"><label className="min-w-52 flex-1 text-sm">Or allow a repository by name<input className={control} value={name} onChange={(e) => setName(e.target.value)} placeholder="owner/repository" maxLength={150} disabled={locked} /></label><Button variant="secondary" type="submit" disabled={locked || !name.trim() || view.repositories.length >= 30}>Allow research</Button></form>
    </>}
    {busy && <p role="status" className="text-sm text-muted">Checking GitHub…</p>}
  </section>;
}
