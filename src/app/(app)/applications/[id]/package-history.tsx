"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toastResult } from "@/components/toast";
import type { PackageConflict } from "@/lib/application-package";

import { acknowledgeEmployerHistory } from "./package-actions";

export function PackageHistory({ applicationId, review, variantName }: { applicationId: string; review: { conflicts: PackageConflict[]; approvalHash: string; approved: boolean }; variantName: string | null }) {
  const [busy, start] = useTransition();
  const router = useRouter();
  return <details className="mx-5 my-4 rounded-panel border border-line-card bg-card p-4 lg:mx-10" open={review.conflicts.length > 0}><summary className="cursor-pointer text-sm font-medium">Employer history{variantName ? ` · started from ${variantName}` : ""}{review.conflicts.length ? ` · ${review.conflicts.length} package difference${review.conflicts.length === 1 ? "" : "s"}` : ""}</summary><p className="mt-3 text-sm text-muted">Exports and sends keep an immutable copy of the exact package. Comparisons use the employer name as written, ignoring case and whitespace. Related companies and aliases are not automatically linked. Older Sent applications contribute their available frozen copy; that is not proof of their exact original export. Different emphasis and ordinary omissions are allowed. Switching between concurrent job histories prompts a review.</p>{review.conflicts.length === 0 ? <p className="mt-3 text-sm text-muted">No contradictory shared employment or credential details found in previously exported/sent packages or recent preparations for this employer.</p> : <><div className="mt-3 space-y-3">{review.conflicts.map((conflict) => <div key={conflict.packageId} className="rounded-control border border-warning-line bg-warning-surface p-3 text-sm"><strong>{conflict.company} · {conflict.role}</strong><p className="text-xs text-muted">{conflict.pending ? "Another package is being prepared; completion is not confirmed." : "Previously exported or marked sent."}</p><ul className="mt-2 list-disc pl-5">{conflict.differences.map((difference, index) => <li key={index}>{difference}</li>)}</ul></div>)}</div><p className="mt-3 text-sm">Check the profile and resume before continuing. If the differences are a deliberate correction, acknowledge this exact package below. Later content or history changes require another review.</p><div className="mt-3 flex flex-wrap gap-3"><Link href="/profile" className="text-sm underline">Review Profile</Link><Button size="sm" variant="secondary" disabled={busy || review.approved} onClick={() => start(async () => { const result = toastResult(await acknowledgeEmployerHistory({ id: applicationId, approvalHash: review.approvalHash })); if (result.ok) router.refresh(); })}>{review.approved ? "Differences acknowledged for this package" : "I reviewed these differences"}</Button></div></>}</details>;
}
