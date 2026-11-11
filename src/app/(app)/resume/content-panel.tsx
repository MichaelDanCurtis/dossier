"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { WritingField } from "@/components/writing/writing-field";
import { isBulletUnit } from "@/lib/unit-text";
import { toastResult } from "@/components/toast";
import { profileUnits } from "@/lib/ai/tasks/tailor-resume";
import type { ProfileData } from "@/lib/profile";
import { BASE_VARIANT, editableResumeUnit, resolveResumeVariant, type ResumeVariantView } from "@/lib/resume-variants";

import { createFocusResume, saveFocusResume, selectFocusResume, restoreFocusResume, startResumeCoach } from "./content-actions";

const ResumeEditor = dynamic(() => import("@/components/writing/resume-editor").then((module) => module.ResumeEditor), { ssr: false, loading: () => <p className="text-sm text-muted">Opening editor…</p> });

type Props = {
  profile: ProfileData; variant: ResumeVariantView; savedVariant: ResumeVariantView; variants: ResumeVariantView[];
  versions: { id: string; revision: number; cause: string; createdAt: string }[];
  onChange: (value: ResumeVariantView) => void; onSaved: (value: ResumeVariantView) => void; onCoach: () => void;
};
export function ContentPanel({ profile, variant, savedVariant, variants, versions, onChange, onSaved, onCoach }: Props) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [name, setName] = useState("");
  const [rich, setRich] = useState(false);
  const dirty = JSON.stringify(variant) !== JSON.stringify(savedVariant);
  const originals = profileUnits(profile);
  const resolved = resolveResumeVariant(profile, variant);
  const edit = (id: string, text: string) => onChange({ ...variant, overrides: [...variant.overrides.filter((row) => row.id !== id), { id, text }] });
  const choose = (id: string) => {
    if (dirty && !window.confirm("Discard your unsaved resume wording and selection changes?")) return;
    start(async () => { const result = toastResult(await selectFocusResume({ id })); if (result.ok) router.refresh(); });
  };
  return <div className="flex flex-col gap-5">
    <div><h2 className="font-medium">Resume wording and focus</h2><p className="mt-2 text-sm text-muted">Preview your edits before saving. PDF downloads and new applications use the saved version. Employers, titles and dates always come from Profile.</p></div>
    <label className="text-sm">Resume in use<select aria-label="Resume variant" className="mt-2 block w-full rounded-control border border-line-input bg-input px-3 py-2" value={variant.id} disabled={busy} onChange={(event) => choose(event.target.value)}>{variants.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></label>
    {variant.id !== BASE_VARIANT && <label className="text-sm">Name<input className="mt-2 block w-full rounded-control border border-line-input bg-input px-3 py-2" value={variant.name} maxLength={80} onChange={(event) => onChange({ ...variant, name: event.target.value })} /></label>}
    <label className="text-sm">Focus for new applications<textarea className="mt-2 block min-h-20 w-full rounded-control border border-line-input bg-input px-3 py-2" value={variant.focus} maxLength={1500} onChange={(event) => onChange({ ...variant, focus: event.target.value })} placeholder="For example: emphasize platform engineering and infrastructure work" /></label>
    <p className="text-xs text-muted">A focus changes emphasis. It does not authorize invented experience or altered employment dates. Named variants keep a selected subset of your shared history; Base automatically includes new profile entries.</p>
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" aria-pressed={rich} onClick={() => setRich(!rich)}>{rich ? "Use plain text fields" : "Open document editor"}</Button>
      <p className="text-xs text-muted">Select wording and right-click, or use Help with wording.</p>
    </div>
    {originals.map((unit) => {
      const included = variant.id === BASE_VARIANT || variant.selection.includes(unit.id);
      const shown = resolved.units.find((row) => row.id === unit.id);
      return <section key={unit.id} className="border-t border-line pt-4"><div className="mb-2 flex items-start gap-2">{variant.id !== BASE_VARIANT && <input aria-label={`Include ${unit.label}`} type="checkbox" checked={included} onChange={(event) => onChange({ ...variant, selection: event.target.checked ? [...variant.selection, unit.id] : variant.selection.filter((id) => id !== unit.id) })} />}<h3 className="text-sm font-medium">{unit.label}</h3></div>{included && (editableResumeUnit(unit.id) ? <>{rich ? <ResumeEditor label={`${unit.label} wording`} value={shown?.text ?? unit.text} bullets={isBulletUnit(unit.id)} onChange={(value) => edit(unit.id, value)} /> :
        <WritingField field={`${unit.label} resume wording`} aria-label={`${unit.label} wording`} textareaClassName="min-h-28" value={shown?.text ?? unit.text} maxLength={12000} bullets={isBulletUnit(unit.id)} onText={(value) => edit(unit.id, value)} />}<button type="button" className="mt-2 text-xs text-muted underline" onClick={() => onChange({ ...variant, overrides: variant.overrides.filter((row) => row.id !== unit.id) })}>Use current profile wording</button></> : <p className="whitespace-pre-wrap text-sm text-muted">{unit.text || "Empty"} <Link href="/profile" className="underline">Edit in Profile</Link></p>)}</section>;
    })}
    <div className="sticky bottom-3 flex flex-wrap gap-3 rounded-panel border border-line-card bg-card p-3"><Button size="sm" disabled={busy || !dirty} onClick={() => start(async () => { const result = toastResult(await saveFocusResume(variant)); if (result.ok) { onSaved(result.data); router.refresh(); } })}>Save resume</Button><Button size="sm" variant="secondary" disabled={busy || !dirty} onClick={() => onChange(savedVariant)}>Cancel edits</Button><Button size="sm" variant="secondary" disabled={busy || dirty} onClick={() => start(async () => { const result = toastResult(await startResumeCoach({ variantId: variant.id })); if (result.ok) { onCoach(); router.push(`/resume?panel=coach&coach=${result.data.id}`); } })}>Discuss with AI</Button></div>
    <div className="border-t border-line pt-4"><label className="text-sm">Create a focused copy<input aria-label="New resume variant name" className="mt-2 block w-full rounded-control border border-line-input bg-input px-3 py-2" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label><Button size="sm" variant="secondary" className="mt-3" disabled={busy || dirty || !name.trim()} onClick={() => start(async () => { const result = toastResult(await createFocusResume({ name, sourceId: variant.id })); if (result.ok) router.refresh(); })}>Create variant</Button></div>
    {versions.length > 0 && <details className="text-sm"><summary className="cursor-pointer">Saved versions ({versions.length})</summary><p className="mt-2 text-xs text-muted">Restores wording and selection while keeping current factual profile details.</p>{versions.map((version) => <div key={version.id} className="mt-3 flex items-center justify-between gap-3"><span>v{version.revision} · {version.cause} · {version.createdAt.slice(0, 10)}</span><Button size="sm" variant="secondary" disabled={busy || dirty || version.revision === variant.revision} onClick={() => start(async () => { const result = toastResult(await restoreFocusResume({ id: variant.id, revision: variant.revision, versionId: version.id })); if (result.ok) { onSaved(result.data); router.refresh(); } })}>Restore</Button></div>)}</details>}
  </div>;
}
