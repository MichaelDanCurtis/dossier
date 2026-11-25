import type { Metadata } from "next";

import { loadAgentView } from "@/lib/agent/view";
import { careerWatchView, linkedinJobs, loadStudio } from "@/lib/studio/data";
import { linkedinConnectionView } from "@/lib/studio/linkedin";
import { publicistConnections } from "@/lib/studio/publicist-provider";

import { alertQueue, sourceLinks } from "@/lib/job-alerts/queue";
import { linkKey } from "@/lib/job-search/search";
import { prisma } from "@/lib/prisma";
import { formatDateTime } from "@/lib/dates";
import { MorningAlerts } from "./morning-alerts";
import { AgentNav } from "./agent-nav";
import { AgentScreen } from "./agent-screen";
import { CareerAgent } from "./career-agent";
import { LinkedinIntake } from "./linkedin-intake";
import { PublicistAgent } from "./publicist-agent";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentPage({ searchParams }: PageProps<"/agent">) {
  const { workspace } = await searchParams;
  if (workspace === "career") return <AgentNav current="career"><CareerAgent view={await careerWatchView()} /></AgentNav>;
  if (workspace === "publicist") {
    const [studio, linkedin, connections] = await Promise.all([loadStudio(), linkedinConnectionView(), publicistConnections()]);
    const { drafts, newsAuto, newsFeeds, customNewsFeeds, publicist, publicistChat } = studio;
    return <AgentNav current="publicist"><PublicistAgent studio={{ drafts, newsAuto, newsFeeds, customNewsFeeds, publicist, publicistChat: { ...publicistChat, pending: undefined }, sources: studio.sources.filter((source) => source.kind !== "MESSAGE") }} connections={connections} account={linkedin.connected && linkedin.connectionId ? { id: linkedin.connectionId, name: linkedin.name } : null} /></AgentNav>;
  }
  const [view, studio, jobs, queue, monitor, lastReview] = await Promise.all([
    loadAgentView(), loadStudio(), linkedinJobs(), alertQueue(), prisma.jobAlertMonitor.findUnique({ where: { id: "linkedin" } }),
    prisma.job.findFirst({ where: { type: "morning-alert-review" }, orderBy: { createdAt: "desc" } }),
  ]);
  const unrecognized = monitor ? await prisma.jobAlertReceipt.count({ where: { mailbox: monitor.mailbox, count: 0 } }) : 0;
  const links = sourceLinks(queue);
  const candidates = [...view.scored, ...view.belowMinimum, ...view.drafts];
  const known = new Set(candidates.map(row => linkKey(row.url)));
  for (const row of candidates) row.alertUrls = [...(links.get(linkKey(row.url)) ?? [])];
  const date = (value?: Date | null) => value ? formatDateTime(value, view.timeZone, new Date()) : null;
  const items = queue.filter(row => {
    if (!row.posting) return true;
    const key = linkKey(row.posting.url);
    if (known.has(key)) return false;
    known.add(key);
    return true;
  }).map(({ lead, posting, match, suggestions }) => ({
    url: lead.linkedinUrl, title: posting?.title || lead.title, company: posting?.company || lead.company,
    employer: match?.posting.url ?? null, complete: !!posting,
    suggestions: suggestions.map(item => ({ id: item.id, label: [item.posting.title, item.posting.company, item.posting.place].filter(Boolean).join(" · "), url: item.posting.url })),
  }));
  const reviewResult = lastReview?.result;
  const review = lastReview?.error || (reviewResult && typeof reviewResult === "object" && "message" in reviewResult && typeof reviewResult.message === "string" ? reviewResult.message : lastReview?.step);
  return <AgentNav current="job"><div className="space-y-3 px-5 pt-4 lg:px-10">
    <MorningAlerts items={items} enabled={!!monitor?.enabled} label={monitor?.labelName || ""} checked={date(monitor?.checkedAt)}
      lastAlert={date(monitor?.lastAlertAt)} retry={date(monitor?.nextCheckAt)} problem={monitor?.problem ?? null} review={review || null} unrecognized={unrecognized} />
    <LinkedinIntake messages={studio.sources.filter((source) => source.kind === "MESSAGE")} jobs={jobs.length} /></div><AgentScreen view={view} /></AgentNav>;
}
