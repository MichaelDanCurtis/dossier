"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/cn";

type Entry = { id: string; label: string; href: string; count?: string; title?: string };
const tabId = (scope: string, id: string) => `${scope}-tab-${encodeURIComponent(id)}`;

/** URL-backed tabs: arrow keys move focus; Enter/Space opens a section. */
export function SectionTabs({ scope, label, entries, current, onSelect, className }: {
  scope: string; label: string; entries: readonly Entry[]; current: string;
  onSelect?: (id: string) => void; className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = list.current;
    const active = root?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (root && active && (active.offsetLeft < root.scrollLeft || active.offsetLeft + active.offsetWidth > root.scrollLeft + root.clientWidth)) root.scrollLeft = Math.max(0, active.offsetLeft - 16);
  }, [current]);
  return <nav aria-label={label} className={cn("min-w-0", className)}>
    <div ref={list} role="tablist" aria-label={label} aria-orientation="horizontal"
      className="relative flex min-w-0 max-w-full gap-6 overflow-x-auto border-b border-line [scrollbar-width:thin]"
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>('[role="tab"]'));
        const index = tabs.indexOf(event.target as HTMLAnchorElement);
        if (index < 0) return;
        if (event.key === " ") { event.preventDefault(); tabs[index].click(); return; }
        const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
        if (next < 0) return;
        event.preventDefault();
        tabs[next].focus();
        tabs[next].scrollIntoView?.({ block: "nearest", inline: "nearest" });
      }}>
      {entries.map((entry) => <Link key={entry.id} role="tab" id={tabId(scope, entry.id)}
        aria-controls={`${scope}-panel`} aria-selected={entry.id === current}
        aria-current={entry.id === current ? "page" : undefined} tabIndex={entry.id === current ? 0 : -1}
        title={entry.title} href={entry.href} scroll={false}
        onClick={(event) => {
          if (onSelect && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onSelect(entry.id); }
        }}
        className={cn("flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 pt-3 pb-3 text-sm hover:text-ink focus-visible:outline-offset-[-3px]", entry.id === current ? "border-primary-text font-medium text-ink" : "border-transparent text-muted")}>
        {entry.label}
        {entry.count !== undefined && <>{" "}<span className="rounded-control bg-track px-1.5 py-0.5 text-xs font-normal text-muted tabular-nums">{entry.count}</span></>}
      </Link>)}
    </div>
  </nav>;
}

export function SectionPanel({ scope, current, children, className }: { scope: string; current: string; children: ReactNode; className?: string }) {
  return <div id={`${scope}-panel`} role="tabpanel" aria-labelledby={tabId(scope, current)} tabIndex={0} className={cn("min-w-0 outline-offset-4", className)}>{children}</div>;
}
