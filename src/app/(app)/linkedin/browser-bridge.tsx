"use client";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast, toastResult } from "@/components/toast";
import type { BridgeStatus } from "@/lib/studio/linkedin-bridge";
import { saveBridgeOpportunity } from "./actions";

const control = "mt-1 block w-full rounded-control border border-line-input bg-input px-3 py-2 text-sm";
async function call(operation: string, data?: unknown) {
  const response = await fetch(`/api/linkedin/bridge/${operation}`, data === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The browser bridge is unavailable.");
  return result;
}
export function LinkedinBrowserBridge({ configured }: { configured: boolean }) {
  const [status, setStatus] = useState<BridgeStatus>(), [problem, setProblem] = useState("");
  const [keywords, setKeywords] = useState(""), [location, setLocation] = useState("");
  const [manualId, setManualId] = useState(""), [screen, setScreen] = useState<{ image: string; url: string; uploadRequested: boolean }>();
  const [text, setText] = useState(""), [showText, setShowText] = useState(false), [chosen, setChosen] = useState("");
  const [busy, start] = useTransition(), router = useRouter(), params = useSearchParams();
  const visible = params.get("section") === "browser", inputBusy = useRef(false);
  const refresh = useCallback(async () => { try { setStatus(await call("status")); setProblem(""); } catch (error) { setProblem((error as Error).message); } }, []);
  useEffect(() => { if (!configured || !visible) return; const first = setTimeout(() => { void refresh(); }, 0); const timer = setInterval(() => { void refresh(); }, 5000); return () => { clearTimeout(first); clearInterval(timer); }; }, [configured, visible, refresh]);
  const screenRef = useCallback(async () => { if (manualId) setScreen(await call("screen", { manualId })); }, [manualId]);
  useEffect(() => {
    if (!manualId || !visible) return;
    let active = true, timer: ReturnType<typeof setTimeout>;
    const next = async () => {
      try { const result = await call("screen", { manualId }); if (active) setScreen(result); }
      catch (error) { if (active) { setProblem((error as Error).message); setManualId(""); setScreen(undefined); } }
      finally { if (active) timer = setTimeout(() => { void next(); }, 3000); }
    };
    void next(); return () => { active = false; clearTimeout(timer); };
  }, [manualId, visible]);
  const run = (operation: string, input: unknown = {}) => start(async () => {
    try { const result = await call(operation, input); if (operation === "open") setManualId(result.manualId); if (operation === "close" || operation === "disconnect") { setManualId(""); setScreen(undefined); } await refresh(); }
    catch (error) { toast((error as Error).message); }
  });
  const send = async (input: object) => {
    if (inputBusy.current) return;
    inputBusy.current = true;
    try { await call("input", { ...input, manualId, approved: true }); await screenRef(); }
    catch (error) { toast((error as Error).message); }
    finally { inputBusy.current = false; }
  };
  if (!configured) return <section className="rounded-panel border border-line-card bg-card p-5"><h2 className="font-medium">LinkedIn browser bridge</h2><p className="mt-2 text-sm text-muted">A private browser service needs to be installed for this workspace. Your host can enable it without sharing sessions between accounts.</p></section>;
  return <div className="space-y-5">
    <section className="space-y-3 rounded-panel border border-line-card bg-card p-5">
      <h2 className="font-heading text-section">Your LinkedIn browser</h2>
      <p className="text-sm text-muted">Sign into LinkedIn on the server. Its browser profile stays in your private workspace. CareerAI collects opportunities only when you start a search. It never submits applications, posts or messages through the collector.</p>
      <p className="text-xs text-muted">Collection is limited to one search page and eight descriptions, 30 seconds between navigations, 15 minutes between runs, and 40 pages per UTC day. Verification, access errors or rate limits stop the run. These limits reduce load; LinkedIn’s automation restrictions still apply.</p>
      {problem && <p role="alert" className="text-sm">{problem}</p>}
      <p role="status" className="text-sm">{status?.message || "Checking bridge…"} {status && `(${status.dayPages}/${status.limits.dayPages} pages today)`}</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => run("open")}>Open browser / sign in</Button>
        <Button variant="secondary" disabled={busy || !status?.running} onClick={() => run("stop")}>Stop collection</Button>
        <Button variant="secondary" disabled={busy} onClick={() => { if (window.confirm("Remove this workspace’s LinkedIn browser login and unsaved collected opportunities? Saved CareerAI jobs stay available.")) run("disconnect"); }}>Disconnect browser</Button>
      </div>
    </section>
    {manualId && <section className="space-y-3 rounded-panel border border-line-card bg-card p-4">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium">You are controlling LinkedIn</h3><Button size="sm" variant="secondary" disabled={busy} onClick={() => run("close", { manualId })}>Close browser control</Button></div>
      <p className="text-sm text-muted">Review every application and post in LinkedIn, then click its final Submit or Post button yourself. Click a field, enter text below, and send it to that field. Clicking the browser focuses keyboard controls. Collection is paused while you have control.</p>
      <p className="break-all text-xs text-muted">{screen?.url}</p>
      {screen && <Image unoptimized src={`data:image/jpeg;base64,${screen.image}`} width={1280} height={900} alt="Interactive LinkedIn browser. Click to control; use Tab, Enter and arrow keys after focusing." tabIndex={0} role="application" className="h-auto w-full rounded-control border border-line focus:outline-2 focus:outline-offset-2" onClick={(event) => {
        event.currentTarget.focus(); const bounds = event.currentTarget.getBoundingClientRect();
        void send({ kind: "click", x: Math.floor((event.clientX - bounds.left) * 1280 / bounds.width), y: Math.floor((event.clientY - bounds.top) * 900 / bounds.height) });
      }} onKeyDown={(event) => {
        const key = event.key === "a" && (event.ctrlKey || event.metaKey) ? "ControlOrMeta+A" : event.key === "Tab" && event.shiftKey ? "Shift+Tab" : event.key;
        if (["Tab", "Shift+Tab", "Enter", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Escape", "ControlOrMeta+A"].includes(key)) { event.preventDefault(); void send({ kind: "key", key }); }
      }} />}
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); const value = text; setText(""); void send({ kind: "text", text: value }); }}>
        <label className="min-w-48 flex-1 text-sm">Text for selected browser field<input aria-label="Text for selected browser field" className={control} type={showText ? "text" : "password"} autoComplete="off" maxLength={4000} value={text} onChange={(event) => setText(event.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showText} onChange={(event) => setShowText(event.target.checked)} />Show text</label>
        <Button size="sm" type="submit" disabled={!text || busy}>Enter text in browser</Button>
      </form>
      <div className="flex flex-wrap gap-2">{["Tab", "Enter", "Backspace", "ControlOrMeta+A"].map((key) => <Button size="sm" variant="secondary" key={key} onClick={() => { void send({ kind: "key", key }); }}>{key === "ControlOrMeta+A" ? "Select all" : key}</Button>)}
        <Button size="sm" variant="secondary" onClick={() => { void send({ kind: "scroll", y: -600 }); }}>Scroll up</Button><Button size="sm" variant="secondary" onClick={() => { void send({ kind: "scroll", y: 600 }); }}>Scroll down</Button>
      </div>
      {screen?.uploadRequested && <label className="block text-sm">LinkedIn is asking for a file. Choose a reviewed document or image to upload (up to 10 MB).<input type="file" accept=".pdf,.docx,.png,.jpg,.jpeg,.webp" className={control} onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
        if (file.size > 10 * 1024 * 1024) { toast("Choose a file up to 10 MB."); return; }
        if (!window.confirm(`Upload ${file.name} to the LinkedIn form you are reviewing?`)) return;
        const reader = new FileReader(); reader.onload = () => { void send({ kind: "upload", name: file.name.replace(/[^a-zA-Z0-9 _.-]/g, "_"), data: String(reader.result).split(",")[1] }); }; reader.readAsDataURL(file);
      }} /></label>}
    </section>}
    <form className="grid gap-3 rounded-panel border border-line-card bg-card p-5 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); run("collect", { keywords, location, approved: true }); }}>
      <h2 className="font-medium sm:col-span-2">Find opportunities to review</h2>
      <label className="text-sm">Role, skills or keywords<input className={control} required maxLength={200} value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="Platform engineering, Azure, infrastructure…" /></label>
      <label className="text-sm">Location<input className={control} maxLength={200} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="City, country or remote" /></label>
      <p className="text-xs text-muted sm:col-span-2">Sign in first, then close browser control. Search results reflect LinkedIn’s matching; review the description before saving. Nothing is applied to or marked Sent.</p>
      <Button type="submit" disabled={busy || !!manualId || !!status?.running || !!status?.manual}>Collect matching jobs</Button>
    </form>
    <div className="space-y-3">{status?.jobs.map((job) => <article key={job.url} className="space-y-3 rounded-panel border border-line-card bg-card p-5">
      <h3 className="font-medium">{job.title} · {job.company}</h3><p className="text-sm text-muted">{job.place} · Collected {new Date(job.collectedAt).toLocaleString()}</p>
      <details className="text-sm"><summary className="cursor-pointer">Review description</summary><p className="mt-3 whitespace-pre-wrap">{job.text}</p></details>
      <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy} onClick={() => start(async () => { const result = toastResult(await saveBridgeOpportunity({ url: job.url })); if (result.ok) { toast("Saved opportunity. Review it in Jobs or Job Agent."); router.refresh(); } })}>Save to CareerAI</Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setChosen(chosen === job.url ? "" : job.url)}>Review application on LinkedIn</Button>
        <a className="self-center text-sm underline" href={job.url} target="_blank" rel="noreferrer">Open original ↗</a>
      </div>
      {chosen === job.url && <div className="space-y-2 border-t border-line pt-3"><p className="text-sm">Continue to {job.title} at {job.company}? You will review the form and submit it yourself in the browser. CareerAI will not send the application.</p><Button size="sm" disabled={busy} onClick={() => { setChosen(""); run("open", { url: job.url }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Continue to review · nothing sent</Button></div>}
    </article>)}</div>
  </div>;
}
