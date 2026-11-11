import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";

import { PageHeader } from "@/components/page-header";
import { publicOrigin } from "@/lib/google/origin";
import { listPostings } from "@/lib/postings";
import { prisma } from "@/lib/prisma";
import { loadStudio } from "@/lib/studio/data";
import { linkedinConnectionView } from "@/lib/studio/linkedin";

import { LinkedinConnections } from "./connections";
import { LinkedinWorkspace } from "./workspace";

export const metadata: Metadata = { title: "LinkedIn" };

export default async function LinkedinPage({ searchParams }: PageProps<"/linkedin">) {
  const [postings, studio, view, apps, params, requestHeaders] = await Promise.all([
    listPostings("saved"), loadStudio(), linkedinConnectionView(),
    prisma.application.findMany({ orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, role: true, company: true } }),
    searchParams, headers(),
  ]);
  const notice = params.connection === "connected" ? "LinkedIn publishing account connected." : params.connection === "failed" ? "LinkedIn did not complete the connection. Check the developer app products and callback, then try again." : params.connection === "setup" ? "Save your LinkedIn developer app settings first." : "";
  const origin = publicOrigin(new Request("http://localhost/linkedin", { headers: requestHeaders }));
  return <>
    <PageHeader title="LinkedIn" description="Bring jobs and messages into Job Agent. Collect posts and industry sources for Publicist, then publish the copy you approve."
      actions={<Link href="#linkedin-jobs" className="text-sm underline">Import a job</Link>} />
    <LinkedinConnections view={view} sources={studio.sources.filter((source) => source.kind !== "NEWS")} applications={apps.map((row) => ({ id: row.id, title: [row.role, row.company].filter(Boolean).join(" · ") || "Application" }))} redirectUri={`${origin}/api/linkedin/callback`} notice={notice} />
    <div id="linkedin-jobs"><LinkedinWorkspace postings={postings.filter((posting) => posting.source === "LINKEDIN")} today={new Date().toISOString()} /></div>
  </>;
}
