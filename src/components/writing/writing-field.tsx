"use client";

import { Sparkles } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea, type TextareaProps } from "@/components/ui/textarea";
import { replaceWritingSelection } from "@/lib/writing-assist";

import { WritingAssistant } from "./writing-assistant";

export function WritingField({ field, value, onText, bullets, ...props }: Omit<TextareaProps, "value" | "onChange"> & {
  field: string; value: string; onText: (value: string) => void; bullets?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState<{ original: string; start: number; end: number }>();
  const open = () => {
    const el = ref.current;
    const selected = el && el.selectionEnd > el.selectionStart;
    setSelection({ original: value, start: selected ? el.selectionStart : 0, end: selected ? el.selectionEnd : value.length });
  };
  return <>
    <Textarea {...props} ref={ref} value={value} onChange={(event) => onText(event.target.value)}
      onContextMenu={(event) => { if (event.currentTarget.selectionEnd > event.currentTarget.selectionStart) { event.preventDefault(); open(); } }} />
    <Button type="button" variant="secondary" size="sm" className="mt-2 w-fit" onMouseDown={(event) => event.preventDefault()} onClick={open}>
      <Sparkles size={14} aria-hidden /> Help with wording
    </Button>
    {selection && <WritingAssistant target={{ field, text: selection.original.slice(selection.start, selection.end), bullets }} onClose={() => setSelection(undefined)}
      apply={(text) => {
        const next = replaceWritingSelection(value, selection.original, selection.start, selection.end, text, props.maxLength ?? 12000);
        if (next === null) return false;
        onText(next);
        return true;
      }} />}
  </>;
}
