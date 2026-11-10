import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { careerJobKey, currentCareerPreferences, listCareerSessions, loadCareerSession } from "@/lib/career/data";
import { findLatestJob } from "@/lib/jobs/runner";

import { loadSettings } from "@/lib/settings-data";

import { CareerWorkspace } from "./workspace";

export const metadata: Metadata = { title: "Career" };

export default async function CareerPage({ searchParams }: PageProps<"/career">) {
  const params = await searchParams;
  const id = typeof params.session === "string" ? params.session : null;
  const [sessions, session, preferences, settings] = await Promise.all([listCareerSessions(), id ? loadCareerSession(id) : null, currentCareerPreferences(), loadSettings()]);
  if (id && !session) notFound();
  return <CareerWorkspace key={id ?? "new"} sessions={sessions} session={session} preferences={preferences} cadence={settings.careerReviewCadence} checkInsPaused={settings.careerReviewPaused} initialJob={id ? await findLatestJob(careerJobKey(id)) : null} />;
}
