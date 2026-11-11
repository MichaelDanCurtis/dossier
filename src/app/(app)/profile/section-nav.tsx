"use client";

import { DndContext } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useState } from "react";

import { DragHandle, MoveButton, useRowSorting } from "@/components/reorder-controls";
import { cn } from "@/lib/cn";
import { SectionTabs } from "@/components/section-tabs";

import { sectionHref, type NavSection, type ProfilePage } from "./sections";

type Row = NavSection & { count: string };

/**
 * Profile tabs show counts; the optional reorder control retains drag handles
 * and keyboard buttons without taking up a second navigation column.
 */
export function SectionNav({ rows, current, onMove }: { rows: Row[]; current: ProfilePage; onMove: (rows: string[]) => void }) {
  const [announcement, setAnnouncement] = useState("");
  const keys = rows.map((row) => row.id as string);
  const { move, context } = useRowSorting({ keys, nameOf: (key) => rows.find((row) => row.id === key)?.label ?? "", onMove, announce: setAnnouncement });

  return (
    <div className="min-w-0 space-y-3">
      <SectionTabs scope="profile" label="Profile sections" current={current} entries={[
        ...rows.map((row) => ({ id: row.id, label: row.label, count: row.count, title: row.optional ? "Optional section" : undefined, href: sectionHref(row.id) })),
        { id: "new", label: "+ Add a section", href: sectionHref("new") },
      ]} />
      <details className="text-sm">
        <summary className="w-fit cursor-pointer text-muted hover:text-ink">Reorder sections</summary>
        <p className="mt-3 max-w-xl text-xs text-muted">Drag or use the arrow buttons. Resumes use this order unless one has its own.</p>
        <div className="mt-3 max-w-md rounded-panel border border-line-card bg-card p-3">
      <DndContext {...context}>
        <SortableContext items={keys} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-0.5">
            {rows.map((row, index) => (
              <SectionRow
                key={row.id}
                row={row}
                selected={row.id === current}
                first={index === 0}
                last={index === rows.length - 1}
                moveUp={() => move(index, index - 1)}
                moveDown={() => move(index, index + 1)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
        </div>
      </details>
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}

function SectionRow({ row, selected, first, last, moveUp, moveDown }: { row: Row; selected: boolean; first: boolean; last: boolean; moveUp: () => void; moveDown: () => void }) {
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: row.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("group flex items-center rounded-control pr-1 hover:bg-hover", selected && "bg-selected hover:bg-selected", isDragging && "relative z-10 bg-card opacity-90 shadow-menu")}
    >
      <DragHandle ref={setActivatorNodeRef} {...listeners} />
      <Link
        href={sectionHref(row.id)}
        aria-current={selected ? "page" : undefined}
        className={cn("flex min-w-0 flex-1 items-center justify-between gap-2 py-[9px] pr-2 pl-1 text-sm text-ink hover:text-ink", selected && "font-medium")}
      >
        <span className="min-w-0 truncate">
          {row.label}
          {row.optional && <span className="ml-2 text-xs font-normal text-muted">optional</span>}
        </span>{" "}
        <span className="text-xs font-normal text-muted tabular-nums group-hover:hidden group-has-focus-visible:hidden">{row.count}</span>
      </Link>
      <span className="hidden flex-none gap-0.5 group-hover:flex group-has-focus-visible:flex">
        <MoveButton label={`Move “${row.label}” up`} disabled={first} onClick={moveUp}>
          ↑
        </MoveButton>
        <MoveButton label={`Move “${row.label}” down`} disabled={last} onClick={moveDown}>
          ↓
        </MoveButton>
      </span>
    </li>
  );
}
