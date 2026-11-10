"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toastResult } from "@/components/toast";
import type { CareerSessionView } from "@/lib/career/schema";
import type { JobView } from "@/lib/jobs/runner";

import { CareerWorkspace } from "../career/workspace";
import { startResumeCoach } from "./content-actions";

export function CoachPanel({ variantId, session, job }: { variantId: string; session: CareerSessionView | null; job: JobView | null }) {
  const [busy, start] = useTransition();
  const router = useRouter();
  return <div className="flex flex-col gap-5"><div><h2 className="font-medium">Base resume coach</h2><p className="mt-2 text-sm text-muted">Discuss the saved resume alongside its preview. AI suggestions show the old and proposed text; accepting one saves a new version. For new achievements, use a project interview or update Profile first.</p></div>{session ? <CareerWorkspace key={session.id} embedded sessions={[]} session={session} initialJob={job} preferences={null} cadence="off" checkInsPaused={false} /> : <Button variant="secondary" disabled={busy} onClick={() => start(async () => { const result = toastResult(await startResumeCoach({ variantId })); if (result.ok) router.push(`/resume?panel=coach&coach=${result.data.id}`); })}>Start resume conversation</Button>}<p className="text-xs text-muted">Earlier coach conversations remain in Career. Nothing is sent to an employer.</p></div>;
}
