"use client";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Button, buttonClassName } from "@/components/ui/button";
import { copyText } from "@/lib/copy-text";

type Connection = { id: string; createdAt: number; expiresAt: number; lastUsedAt: number | null };
export function ChromeJobExtension({ available }: { available: boolean }) {
  const [connections, setConnections] = useState<Connection[]>([]), [pair, setPair] = useState<{ code: string; expiresAt: number }>();
  const [problem, setProblem] = useState(""), [notice, setNotice] = useState(""), [busy, start] = useTransition();
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/_accounts/api/job-extension", { cache: "no-store", signal });
    if (!response.ok) throw new Error("Extension connections could not be loaded. Refresh to try again.");
    const result = await response.json(); if (!signal?.aborted) setConnections(result.connections);
  }, []);
  useEffect(() => {
    if (!available) return;
    const controller = new AbortController();
    void fetch("/_accounts/api/job-extension", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Extension connections could not be loaded. Refresh to try again.");
      const result = await response.json(); if (!controller.signal.aborted) setConnections(result.connections);
    }).catch((error) => { if (!controller.signal.aborted) setProblem(error.message); });
    return () => controller.abort();
  }, [available]);
  const operate = (operation: string, id = "") => start(async () => {
    setProblem(""); setNotice("");
    try {
      const response = await fetch("/_accounts/api/job-extension", { method: "POST", body: new URLSearchParams({ operation, id }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "The extension operation failed.");
      if (operation === "pair") setPair(result); else { setPair(undefined); setConnections(result.connections); setNotice("Extension access revoked."); }
      await load();
    } catch (error) { setProblem(error instanceof Error ? error.message : "The extension operation failed."); }
  });
  return <div className="max-w-[960px] space-y-5">
    <section className="space-y-3 rounded-panel border border-line-card bg-card p-5">
      <h2 className="font-heading text-section">Collect LinkedIn jobs from your own Chrome</h2>
      <p className="text-sm text-muted">Choose up to ten results from a search. The extension reads their full descriptions in your signed-in tab and saves them for AI career review. LinkedIn cookies stay in Chrome.</p>
      <ol className="list-inside list-decimal space-y-2 text-sm">
        <li><a download href="/careerai-job-clipper.zip" className="underline">Download the CareerAI Chrome extension</a> and unzip it.</li>
        <li>Open <code>chrome://extensions</code> in Chrome, enable Developer mode, choose <strong>Load unpacked</strong>, and select the unzipped folder containing <code>manifest.json</code>.</li>
        <li>Pin CareerAI from Chrome’s extensions menu. Generate a pairing code below and paste it into the extension.</li>
        <li>Open a LinkedIn job search, click the CareerAI toolbar icon, then <strong>Choose jobs from this search</strong>.</li>
        <li>Choose up to ten results and start collection. Keep its progress page and the LinkedIn tab open. You can stop at any time.</li>
        <li>Press <strong>Open CareerAI review</strong>, then review the jobs with AI. Prepare a résumé only for the roles you choose.</li>
      </ol>
      <p className="text-sm text-muted">Already installed? Replace the files in the existing extension folder with this download, then press Reload at <code>chrome://extensions</code>. Keep the existing installation to preserve its pairing. Version 0.2.1 fixes title capture on individual job pages without new browser permissions.</p>
      <p className="text-xs text-muted">This is a private unpacked extension. It has no cookie access, background crawler, application submission or publishing controls. LinkedIn’s restrictions on extensions and copying data still apply.</p>
    </section>
    {available ? <section className="space-y-4 rounded-panel border border-line-card bg-card p-5">
      <h2 className="font-medium">Connect this Chrome to your account</h2>
      <p className="text-sm text-muted">The pairing code works once and expires in five minutes. Connected extensions can only save LinkedIn jobs; they cannot read your profile or send applications or posts.</p>
      {problem && <p role="alert" className="text-sm text-error">{problem}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      <Button disabled={busy} onClick={() => operate("pair")}>Create pairing code</Button>
      {pair && <div className="space-y-2 rounded-control border border-line bg-input p-4"><p className="text-sm">Paste this code into the extension before {new Date(pair.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. Creating another code replaces this one.</p><code aria-label="Extension pairing code" className="block select-all break-all text-sm">{pair.code}</code><Button size="sm" variant="secondary" disabled={busy} onClick={() => start(async () => { setNotice(await copyText(pair.code) ? "Pairing code copied." : "Select and copy the pairing code."); })}>Copy pairing code</Button></div>}
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">Connected extensions · {connections.length}</h3><Button size="sm" variant="text" disabled={busy} onClick={() => start(async () => { try { await load(); } catch { setProblem("Connections could not be refreshed."); } })}>Refresh connections</Button></div>
      <ul className="divide-y divide-line">{connections.map((connection) => <li key={connection.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><div>Chrome extension · {connection.id.slice(-6)}<p className="text-xs text-muted">Connected {new Date(connection.createdAt).toLocaleDateString()} · expires {new Date(connection.expiresAt).toLocaleDateString()}{connection.lastUsedAt ? ` · last used ${new Date(connection.lastUsedAt).toLocaleDateString()}` : " · not used yet"}</p></div><Button size="sm" variant="secondary" disabled={busy} onClick={() => operate("revoke", connection.id)}>Revoke access</Button></li>)}</ul>
      {(connections.length > 0 || pair) && <Button size="sm" variant="secondary" disabled={busy} onClick={() => operate("revoke", "all")}>Revoke all extension access and pairing codes</Button>}
    </section> : <p className="text-sm text-muted">Extension pairing requires CareerAI’s private-account gateway. Your host needs to enable it for this installation.</p>}
    <a className={buttonClassName("secondary", "sm")} href="/linkedin?section=jobs">View saved LinkedIn jobs</a>
  </div>;
}
