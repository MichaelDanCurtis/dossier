"use client";

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { controlClassName } from "@/components/ui/field";
import { toggleMark } from "@/lib/citation";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { WritingAssistant } from "@/components/writing/writing-assistant";
import { replaceWritingSelection } from "@/lib/writing-assist";

/**
 * "What you did" for a role or project: a point per line, with B (and
 * Ctrl+B) for **bold**, as in a publication's citation (#368). Tailored
 * resumes keep the bold of the words they keep.
 */
export function BulletsField({ value, onChange, placeholder, field = "Achievements" }: { field?: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  const id = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const [target, setTarget] = useState<{ original: string; start: number; end: number }>();
  const ask = () => {
    const el = box.current;
    const selected = el && el.selectionStart < el.selectionEnd;
    setTarget({ original: value, start: selected ? el.selectionStart : 0, end: selected ? el.selectionEnd : value.length });
  };
  // The selection to put back once the marked text is drawn.
  const selection = useRef<{ start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    if (!selection.current || !box.current) return;
    box.current.setSelectionRange(selection.current.start, selection.current.end);
    selection.current = null;
  }, [value]);

  const bold = () => {
    const field = box.current;
    if (!field) return;
    const next = toggleMark(value, { start: field.selectionStart, end: field.selectionEnd }, "bold");
    selection.current = { start: next.start, end: next.end };
    field.focus();
    onChange(next.text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "b") return;
    event.preventDefault();
    bold();
  };

  return (
    <div className="col-span-2 flex flex-col gap-[7px]">
      <div className="flex items-end justify-between gap-3">
        <label htmlFor={id} className="text-label font-medium text-ink">
          What you did
        </label>
        <button
          type="button"
          className="grid size-7 place-items-center rounded-[6px] border border-line-input bg-input text-sm font-bold text-ink hover:bg-hover focus-visible:outline-offset-1"
          title="Bold (Ctrl+B)"
          aria-label="Bold"
          onClick={bold}
        >
          B
        </button>
      </div>
      <textarea
        ref={box}
        id={id}
        aria-describedby={`${id}-hint`}
        rows={4}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        maxLength={10000}
        onContextMenu={(event) => { if (event.currentTarget.selectionEnd > event.currentTarget.selectionStart) { event.preventDefault(); ask(); } }}
        className={cn(controlClassName, "resize-y px-3 py-[11px] leading-[1.6]")}
      />
      <Button type="button" variant="secondary" size="sm" className="self-start" onMouseDown={(event) => event.preventDefault()} onClick={ask}>Help with wording</Button>
      {target && <WritingAssistant target={{ field, text: target.original.slice(target.start, target.end), bullets: true }} onClose={() => setTarget(undefined)}
        apply={(text) => {
          const next = replaceWritingSelection(value, target.original, target.start, target.end, text, 10000);
          if (next === null) return false;
          onChange(next);
          return true;
        }} />}
      <p id={`${id}-hint`} className="text-label text-muted">
        Select words and press B to set them in bold, like a result: here they show as **bold**.
      </p>
    </div>
  );
}
