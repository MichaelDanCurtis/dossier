import type { Metadata } from "next";

import { listResumeVariants, loadResumeContext } from "@/lib/resume-variant-data";
import { prisma } from "@/lib/prisma";
import { careerJobKey, loadCareerSession } from "@/lib/career/data";
import { findLatestJob } from "@/lib/jobs/runner";
import { loadProfile } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";
import { loadThemes, loadThemeUsage } from "@/lib/theme-data";

import { ResumeWorkspace } from "./resume-workspace";

export const metadata: Metadata = { title: "Base resume" };

/** The base resume: a live preview of the profile in the chosen theme (RES-1). */
export default async function BaseResumePage({ searchParams }: PageProps<"/resume">) {
  const [params, profile, themes, settings, usage, variants, context] = await Promise.all([searchParams, loadProfile(), loadThemes(), loadSettings(), loadThemeUsage(), listResumeVariants(), loadResumeContext()]);
  const coachId = typeof params.coach === "string" ? params.coach : null;
  const coach = await prisma.careerSession.findFirst({ where: { kind: "COACH", linkedRecordId: context.variantId, ...(coachId ? { id: coachId } : {}) }, orderBy: { updatedAt: "desc" }, select: { id: true } });
  const versions = await prisma.resumeVariantVersion.findMany({ where: { variantId: context.variantId }, orderBy: { revision: "desc" }, take: 30, select: { id: true, revision: true, cause: true, createdAt: true } });
  return (
    <ResumeWorkspace
      key={context.variantId}
      profile={profile}
      variant={variants.find((row) => row.id === context.variantId)!}
      variants={variants}
      versions={versions.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))}
      coachSession={coach ? await loadCareerSession(coach.id) : null}
      coachJob={coach ? await findLatestJob(careerJobKey(coach.id)) : null}
      themes={themes}
      usage={usage}
      baseThemeId={settings.baseThemeId}
      paper={settings.paper}
      includeReferences={settings.includeRefs}
      language={settings.resumeLanguage}
      sections={settings.resumeSections}
      fitToPage={settings.fitBaseResume}
      initialPanel={params.panel === "content" || params.panel === "coach" || params.panel === "sections" ? params.panel : "themes"}
    />
  );
}
