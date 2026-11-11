import type { Metadata } from "next";

import { loadAgentView } from "@/lib/agent/view";
import { careerWatchView, linkedinJobs, loadStudio } from "@/lib/studio/data";
import { linkedinConnectionView } from "@/lib/studio/linkedin";

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
    const [studio, linkedin] = await Promise.all([loadStudio(), linkedinConnectionView()]);
    const { drafts, newsAuto, newsFeeds } = studio;
    return <AgentNav current="publicist"><PublicistAgent studio={{ drafts, newsAuto, newsFeeds, sources: studio.sources.filter((source) => source.kind !== "MESSAGE") }} account={linkedin.connected && linkedin.connectionId ? { id: linkedin.connectionId, name: linkedin.name } : null} /></AgentNav>;
  }
  const [view, studio, jobs] = await Promise.all([loadAgentView(), loadStudio(), linkedinJobs()]);
  return <AgentNav current="job"><div className="px-5 pt-4 lg:px-10"><LinkedinIntake messages={studio.sources.filter((source) => source.kind === "MESSAGE")} jobs={jobs.length} /></div><AgentScreen view={view} /></AgentNav>;
}
