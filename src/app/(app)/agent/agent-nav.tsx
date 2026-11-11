import type { ReactNode } from "react";
import { SectionPanel, SectionTabs } from "@/components/section-tabs";

const workspaces = [
  { id: "job", name: "Job agent", url: "/agent" },
  { id: "career", name: "Career agent", url: "/agent?workspace=career" },
  { id: "publicist", name: "Publicist agent", url: "/agent?workspace=publicist" },
] as const;

export function AgentNav({ current, children }: { current: typeof workspaces[number]["id"]; children: ReactNode }) {
  return <>
    <SectionTabs scope="agents" label="Agent workspaces" current={current} className="px-5 pt-2 lg:px-10" entries={workspaces.map(({ id, name, url }) => ({ id, label: name, href: url }))} />
    <SectionPanel scope="agents" current={current}>{children}</SectionPanel>
  </>;
}
