"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toastResult } from "@/components/toast";
import { prepareOpportunity } from "./actions";

const control = "mt-2 block w-full rounded-control border border-line-input bg-input px-3 py-2 text-ink";
export function OpportunityForm({ applications, selected = "", experienceCount, projectCount }: { applications: { id: string; title: string; company: string }[]; selected?: string; experienceCount: number; projectCount: number }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [applicationId, setApplication] = useState(applications.some((a) => a.id === selected) ? selected : "");
  const [input, setInput] = useState({ title: "", company: "", posting: "", url: "", focus: "", companySource: "", companySourceUrl: "" });
  const field = (name: keyof typeof input) => ({ value: input[name], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setInput((prev) => ({ ...prev, [name]: event.target.value })) });
  return <form className="max-w-[900px] space-y-6" onSubmit={(event) => { event.preventDefault(); start(async () => { const result = toastResult(await prepareOpportunity({ ...input, applicationId })); if (result.ok) router.push(`/career?section=opportunities&session=${result.data.id}`); }); }}>
    <section className="space-y-4 rounded-panel border border-line-card bg-card p-5">
      <h2 className="font-heading text-section">Is this opportunity worth your time?</h2>
      <p className="text-sm text-muted">Compare a real opening with your saved experience, projects and reviewed preferences. Get relevant examples, tradeoffs, questions for the employer and a preparation plan, then practice the interview.</p>
      <p className="text-sm">Using {experienceCount} experience entries and {projectCount} confirmed projects. {projectCount === 0 && "Add or review projects in Profile or Repositories to bring them into future briefings."}</p>
      <label className="block text-sm">Opportunity<select className={control} value={applicationId} onChange={(e) => setApplication(e.target.value)}><option value="">Paste a new opportunity</option>{applications.map((app) => <option key={app.id} value={app.id}>{app.title} {app.company && `· ${app.company}`}</option>)}</select></label>
      {!applicationId && <><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Role<input className={control} maxLength={200} {...field("title")} /></label><label className="text-sm">Company<input className={control} maxLength={200} {...field("company")} /></label></div><label className="block text-sm">Posting link<input type="url" className={control} maxLength={2000} {...field("url")} /></label><label className="block text-sm">Job description<textarea required minLength={80} maxLength={20000} rows={8} className={control} {...field("posting")} /></label></>}
      <label className="block text-sm">What matters for this decision?<textarea rows={3} className={control} maxLength={1500} placeholder="For example: hands-on AI architecture, leadership scope, remote work, or a concern about this role." {...field("focus")} /></label>
      <details><summary className="cursor-pointer text-sm">Add a company source (optional)</summary><p className="mt-3 text-sm text-muted">Paste a relevant excerpt from the company’s site or another source you trust, with its link. The briefing uses supplied material; it does not search the web.</p><label className="mt-3 block text-sm">Source link<input type="url" className={control} maxLength={2000} {...field("companySourceUrl")} /></label><label className="mt-3 block text-sm">Company excerpt<textarea rows={4} className={control} maxLength={6000} {...field("companySource")} /></label></details>
      <p className="text-xs text-muted">Your configured AI receives the posting, your focus and a contact-stripped profile snapshot. Up to two requests with at most 6,000 output tokens each, including a format retry; your provider’s rates apply. No application is sent.</p>
      <Button type="submit" disabled={busy}>{busy ? "Preparing…" : "Prepare opportunity briefing"}</Button>
    </section>
  </form>;
}
