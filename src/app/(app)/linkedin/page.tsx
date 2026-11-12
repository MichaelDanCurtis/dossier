import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";

import { ChromeJobExtension } from "./chrome-extension";
import { PageHeader } from "@/components/page-header";
import { publicOrigin } from "@/lib/google/origin";
import { listPostings } from "@/lib/postings";
import { prisma } from "@/lib/prisma";
import { agentScanResultSchema } from "@/lib/agent/run";
import { findLatestJob } from "@/lib/jobs/runner";
import { scoringProblem } from "@/lib/scoring";
import { loadSettings } from "@/lib/settings-data";
import { loadStudio } from "@/lib/studio/data";
import { linkedinConnectionView } from "@/lib/studio/linkedin";

import { bridgeConfigured } from "@/lib/studio/linkedin-bridge";
import { LinkedinBrowserBridge } from "./browser-bridge";
import { LinkedinConnections } from "./connections";
import { LinkedinWorkspace } from "./workspace";
import { LinkedinTabs } from "./section-tabs";

export const metadata: Metadata = { title: "LinkedIn" };

export default async function LinkedinPage({ searchParams }: PageProps<"/linkedin">) {
  const [postings, studio, view, apps, params, requestHeaders, latestReview, settings, scoringIssue] = await Promise.all([
    listPostings("saved"), loadStudio(), linkedinConnectionView(),
    prisma.application.findMany({ orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, role: true, company: true } }),
    searchParams, headers(),
    findLatestJob("linkedin-score"), loadSettings(), scoringProblem(),
  ]);
  const notice = params.connection === "connected" ? "LinkedIn publishing account connected." : params.connection === "failed" ? "LinkedIn did not complete the connection. Check the developer app products and callback, then try again." : params.connection === "setup" ? "Save your LinkedIn developer app settings first." : "";
  const origin = publicOrigin(new Request("http://localhost/linkedin", { headers: requestHeaders }));
  const connection = { view, applications: apps.map((row) => ({ id: row.id, title: [row.role, row.company].filter(Boolean).join(" · ") || "Application" })), redirectUri: `${origin}/api/linkedin/callback`, notice };
  return <>
    <PageHeader title="LinkedIn" description="Review relevant opportunities, understand the fit, and prepare a tailored résumé for the jobs you choose."
      actions={<Link href="/linkedin?section=extension" className="text-sm underline">Connect Chrome</Link>} />
    <LinkedinTabs
      extension={<ChromeJobExtension available={process.env.DOSSIER_ACCOUNT_GATEWAY === "on"} />}
      browser={<LinkedinBrowserBridge configured={bridgeConfigured()} />}
      jobs={<LinkedinWorkspace postings={postings.filter((posting) => posting.source === "LINKEDIN")} today={new Date().toISOString()} reviewLimit={Math.min(10, settings.agentMaxScores)} scoringIssue={scoringIssue} latestReview={latestReview ? { ...latestReview, result: agentScanResultSchema.safeParse(latestReview.result).data ?? null } : null} />}
      feed={<LinkedinConnections {...connection} section="feed" sources={studio.sources.filter((source) => source.kind !== "NEWS" && source.kind !== "MESSAGE")} />}
      messages={<LinkedinConnections {...connection} section="messages" sources={studio.sources.filter((source) => source.kind === "MESSAGE")} />}
      publishing={<LinkedinConnections {...connection} section="publishing" sources={[]} />}
    />
  </>;
}
