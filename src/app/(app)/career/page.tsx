import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { SectionPanel, SectionTabs } from "@/components/section-tabs";
import { buttonClassName } from "@/components/ui/button";
import { opportunityChoices } from "@/lib/career/opportunities";
import { repositorySettings } from "@/lib/career/repositories";
import { publicistConnections } from "@/lib/studio/publicist-provider";
import { loadProfile } from "@/lib/profile-data";
import { prisma } from "@/lib/prisma";
import { opportunityContextSchema } from "@/lib/career/opportunity-schema";
import { repositoryContextSchema } from "@/lib/career/repositories";

import { careerJobKey, currentCareerPreferences, listCareerSessions, loadCareerSession } from "@/lib/career/data";
import { findLatestJob } from "@/lib/jobs/runner";

import { loadSettings } from "@/lib/settings-data";

import { CareerWorkspace } from "./workspace";
import { OpportunityForm } from "./opportunity-form";
import { RepositoryWorkspace } from "./repository-workspace";

export const metadata: Metadata = { title: "Career" };

export default async function CareerPage({ searchParams }: PageProps<"/career">) {
  const params = await searchParams;
  const id = typeof params.session === "string" ? params.session : null;
  const [sessions, session, preferences, settings] = await Promise.all([listCareerSessions(), id ? loadCareerSession(id) : null, currentCareerPreferences(), loadSettings()]);
  if (id && !session) notFound();
  const sections = [{ id: "conversations", label: "Conversations" }, { id: "opportunities", label: "Opportunity briefings" }, { id: "repositories", label: "Repositories" }];
  const implied = session?.kind === "OPPORTUNITY" || session?.kind === "PRACTICE" ? "opportunities" : session?.kind === "REPOSITORY" ? "repositories" : "conversations";
  const section = session ? implied : sections.find((s) => s.id === params.section)?.id ?? "conversations";
  const history = sessions.filter((row) => section === "opportunities" ? ["OPPORTUNITY", "PRACTICE"].includes(row.kind) : section === "repositories" ? row.kind === "REPOSITORY" : !["OPPORTUNITY", "PRACTICE", "REPOSITORY"].includes(row.kind));
  const raw = id ? await prisma.careerSession.findUnique({ where: { id }, select: { contextJson: true, linkedRecordId: true } }) : null;
  const parsedSnapshot = raw && ["OPPORTUNITY", "PRACTICE", "REPOSITORY"].includes(session!.kind) ? (session!.kind === "REPOSITORY" ? repositoryContextSchema : opportunityContextSchema).safeParse(JSON.parse(raw.contextJson)) : null;
  const snapshot: { capturedAt: string; url: string; companySourceUrl?: string; evidence?: { id: string; label: string; text: string }[]; readme?: string; posting?: string; companySource?: string } | null = parsedSnapshot?.success ? parsedSnapshot.data : null;
  const [applications, profile, repoSettings, connections] = await Promise.all([!session && section === "opportunities" ? opportunityChoices() : [], !session && section === "opportunities" ? loadProfile() : null, !session && section === "repositories" ? repositorySettings() : null, !session && section === "repositories" ? publicistConnections() : []]);
  return <>
    <PageHeader title="Career" description="Make better career decisions, prepare with your real experience, and tell the story of your work." actions={<Link href={`/career?section=${section}`} className={buttonClassName("secondary")}>{section === "opportunities" ? "New briefing" : section === "repositories" ? "Discover a repository" : "New conversation"}</Link>} />
    <div className="min-w-0 space-y-6 px-5 pb-16 lg:px-10">
      <SectionTabs scope="career" label="Career sections" current={section} entries={sections.map((s) => ({ ...s, href: `/career?section=${s.id}` }))} />
      <SectionPanel scope="career" current={section} className="space-y-6">
        {history.length > 0 && <details className="max-w-[900px] rounded-panel border border-line-card bg-card p-4"><summary className="cursor-pointer text-sm">Saved {section === "opportunities" ? "briefings and practice" : section === "repositories" ? "repository conversations" : "conversations"} ({history.length})</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{history.map((row) => <Link key={row.id} href={`/career?section=${section}&session=${row.id}`} className={`rounded-control p-3 text-sm ${row.id === id ? "bg-selected" : "hover:bg-hover"}`}><span className="block truncate">{row.title}</span><span className="text-xs text-muted">{row.state.toLowerCase()} · {row.updatedAt.slice(0, 10)}</span></Link>)}</div></details>}
        {snapshot && <details className="max-w-[900px] rounded-panel border border-line-card bg-card p-4"><summary className="cursor-pointer text-sm">Sources and saved facts · {snapshot.capturedAt?.slice(0, 10)}</summary><div className="mt-3 space-y-3 text-sm"><p className="text-muted">This conversation uses its saved snapshot. Start a new briefing after updating your profile. Source text and AI feedback require your review.</p>{snapshot.url && /^https?:\/\//i.test(snapshot.url) && <a href={snapshot.url} target="_blank" rel="noreferrer" className="block underline">Open original source</a>}{snapshot.companySourceUrl && /^https?:\/\//i.test(snapshot.companySourceUrl) && <a href={snapshot.companySourceUrl} target="_blank" rel="noreferrer" className="block underline">Company excerpt source</a>}{snapshot.evidence?.map((e: { id: string; label: string; text: string }) => <div key={e.id} className="border-t border-line pt-3"><strong>{e.label}</strong><p className="whitespace-pre-wrap text-muted">{e.text}</p><small>{e.id}</small></div>)}<details><summary className="cursor-pointer">{snapshot.readme !== undefined ? "Repository source material" : "Posting and company excerpt"}</summary><p className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap">{snapshot.readme ?? [snapshot.posting, snapshot.companySource].filter(Boolean).join("\n\n")}</p></details></div></details>}
        {session || section === "conversations" ? <CareerWorkspace key={id ?? "new"} embedded sessions={sessions} session={session} preferences={preferences} cadence={settings.careerReviewCadence} checkInsPaused={settings.careerReviewPaused} initialJob={id ? await findLatestJob(careerJobKey(id)) : null} /> : section === "opportunities" ? <OpportunityForm applications={applications} selected={typeof params.application === "string" ? params.application : ""} experienceCount={profile!.experience.length} projectCount={profile!.projects.length} /> : <RepositoryWorkspace settings={repoSettings!} connections={connections} />}
      </SectionPanel>
    </div>
  </>;
}
