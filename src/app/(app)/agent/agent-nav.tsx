import Link from "next/link";

const workspaces = [
  { id: "job", name: "Job agent", url: "/agent" },
  { id: "career", name: "Career agent", url: "/agent?workspace=career" },
  { id: "publicist", name: "Publicist agent", url: "/agent?workspace=publicist" },
] as const;

export function AgentNav({ current }: { current: typeof workspaces[number]["id"] }) {
  return <nav className="flex flex-wrap gap-2 border-b border-line px-5 py-3 lg:px-10" aria-label="Agent workspaces">
    {workspaces.map(({ id, name, url }) => <Link key={id} href={url} aria-current={id === current ? "page" : undefined}
      className={`rounded-control px-3 py-1.5 text-sm font-medium ${id === current ? "bg-selected text-ink" : "text-muted hover:bg-hover hover:text-ink"}`}>{name}</Link>)}
  </nav>;
}
