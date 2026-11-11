"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { SectionPanel, SectionTabs } from "@/components/section-tabs";

const sections = [
  { id: "browser", label: "Browser bridge" },
  { id: "jobs", label: "Jobs" },
  { id: "feed", label: "Feed & sources" },
  { id: "messages", label: "Messages" },
  { id: "publishing", label: "Publishing" },
] as const;
type Section = typeof sections[number]["id"];

/** Keep imports and credentials in memory while changing tabs or using Back. */
export function LinkedinTabs({ jobs, feed, messages, publishing, browser }: Record<Section, ReactNode>) {
  const params = useSearchParams();
  const section = sections.find((item) => item.id === params.get("section"))?.id ?? (params.has("connection") ? "publishing" : "jobs");
  useEffect(() => {
    const legacy = { "#publishing": "publishing", "#saved-context": "feed", "#linkedin-jobs": "jobs" }[window.location.hash];
    if (legacy && !new URLSearchParams(window.location.search).has("section")) {
      const url = new URL(window.location.href); url.searchParams.set("section", legacy); url.hash = "";
      window.history.replaceState(null, "", url);
    }
  }, []);
  const panels = { jobs, feed, messages, publishing, browser };
  return <div className="min-w-0 space-y-6 px-5 pb-10 lg:px-10">
    <SectionTabs scope="linkedin" label="LinkedIn sections" current={section}
      entries={sections.map((item) => ({ ...item, href: `/linkedin?section=${item.id}` }))}
      onSelect={(id) => {
        const url = new URL(window.location.href); url.searchParams.set("section", id); url.hash = "";
        window.history.pushState(null, "", url);
      }} />
    <SectionPanel scope="linkedin" current={section}>
      {sections.map(({ id }) => <div key={id} hidden={section !== id}>{panels[id]}</div>)}
    </SectionPanel>
  </div>;
}
