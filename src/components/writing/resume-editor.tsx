"use client";

import { Editor, Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, Redo2, Sparkles, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { resumeEditorDocument, resumeEditorText } from "@/lib/resume-editor-text";

import { WritingAssistant } from "./writing-assistant";

type Target = { whole: boolean; from: number; to: number; document: string; text: string };

const lengthLimit = Extension.create({
  name: "resumeLengthLimit",
  addProseMirrorPlugins() {
    return [new Plugin({ filterTransaction: (transaction) => !transaction.docChanged || resumeEditorText(transaction.doc.toJSON()).length <= 12000 })];
  },
});

function toggleEmphasis(editor: Editor | null, mark: "bold" | "italic") {
  if (!editor) return;
  const { doc, selection } = editor.state;
  let { from, to } = selection;
  const word = /[\p{L}\p{N}]/u;
  const left = doc.resolve(from), right = doc.resolve(to);
  const before = left.parent.textBetween(0, left.parentOffset, "", " ");
  const afterStart = left.parent.textBetween(left.parentOffset, left.parent.content.size, "", " ");
  if (word.test(before.at(-1) ?? "") && word.test(afterStart[0] ?? "")) from -= before.match(/[\p{L}\p{N}]+$/u)?.[0].length ?? 0;
  const beforeEnd = right.parent.textBetween(0, right.parentOffset, "", " ");
  const after = right.parent.textBetween(right.parentOffset, right.parent.content.size, "", " ");
  if (word.test(beforeEnd.at(-1) ?? "") && word.test(after[0] ?? "")) to += after.match(/^[\p{L}\p{N}]+/u)?.[0].length ?? 0;
  const command = editor.chain().focus().setTextSelection({ from, to });
  if (mark === "bold") command.toggleBold().run();
  else command.toggleItalic().run();
}

const wordEmphasis = Extension.create({
  name: "resumeWordEmphasis",
  priority: 1001,
  addKeyboardShortcuts() {
    return {
      "Mod-b": () => { toggleEmphasis(this.editor, "bold"); return true; },
      "Mod-i": () => { toggleEmphasis(this.editor, "italic"); return true; },
    };
  },
});

/** Rich editing stays in the document's semantic sections; titles/dates still come from Profile. */
export function ResumeEditor({ label, value, bullets, onChange }: { label: string; value: string; bullets: boolean; onChange: (value: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(onChange);
  const instance = useRef<Editor | null>(null);
  const lastValue = useRef(value);
  const [target, setTarget] = useState<Target>();
  const [marks, setMarks] = useState({ bold: false, italic: false });
  useEffect(() => { latest.current = onChange; }, [onChange]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const editor = new Editor({
      element,
      injectCSS: false,
      extensions: [StarterKit.configure({
        blockquote: false, code: false, codeBlock: false, heading: false, horizontalRule: false,
        link: false, orderedList: false, strike: false, underline: false, bulletList: bullets ? {} : false,
        listItem: bullets ? {} : false, trailingNode: false,
      }), lengthLimit, wordEmphasis],
      content: resumeEditorDocument(lastValue.current, bullets),
      editorProps: { attributes: {
        role: "textbox", "aria-multiline": "true", "aria-label": label,
        class: "min-h-24 px-3 py-2 text-sm whitespace-pre-wrap break-words focus-visible:outline-none [&_li]:ml-4 [&_ul]:list-disc [&_p]:min-h-[1.5em]",
      } },
      onUpdate: ({ editor: current }) => {
        const next = resumeEditorText(current.getJSON());
        lastValue.current = next;
        latest.current(next);
      },
      onTransaction: ({ editor: current }) => {
        const bold = current.isActive("bold"), italic = current.isActive("italic");
        setMarks((previous) => previous.bold === bold && previous.italic === italic ? previous : { bold, italic });
      },
    });
    instance.current = editor;
    return () => { instance.current = null; editor.destroy(); };
  }, [bullets, label]);
  useEffect(() => {
    if (instance.current && value !== lastValue.current) {
      lastValue.current = value;
      instance.current.commands.setContent(resumeEditorDocument(value, bullets), { emitUpdate: false });
    }
  }, [value, bullets]);

  const ask = (onlySelection = false) => {
    const editor = instance.current;
    if (!editor || (onlySelection && editor.state.selection.empty)) return false;
    const { doc, selection } = editor.state;
    const from = selection.empty ? 1 : selection.from;
    const to = selection.empty ? Math.max(1, doc.content.size - 1) : selection.to;
    setTarget({ whole: selection.empty, from, to, document: JSON.stringify(editor.getJSON()), text: doc.textBetween(from, to, "\n") });
    return true;
  };
  return <div className="rounded-control border border-line-input bg-input focus-within:border-line-strong">
    <div className="flex flex-wrap gap-1 border-b border-line px-2 py-1.5">
      <Button aria-label="Bold" aria-pressed={marks.bold} title="Bold (whole words)" variant="text" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleEmphasis(instance.current, "bold")}><Bold size={15} /></Button>
      <Button aria-label="Italic" aria-pressed={marks.italic} title="Italic (whole words)" variant="text" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleEmphasis(instance.current, "italic")}><Italic size={15} /></Button>
      <Button aria-label="Undo wording edit" title="Undo" variant="text" size="sm" onClick={() => instance.current?.chain().focus().undo().run()}><Undo2 size={15} /></Button>
      <Button aria-label="Redo wording edit" title="Redo" variant="text" size="sm" onClick={() => instance.current?.chain().focus().redo().run()}><Redo2 size={15} /></Button>
      <Button variant="text" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => ask()}><Sparkles size={14} aria-hidden /> Help with wording</Button>
    </div>
    <div ref={host} onContextMenu={(event) => { if (ask(true)) event.preventDefault(); }} />
    {target && <WritingAssistant target={{ field: label, text: target.text, bullets }} onClose={() => setTarget(undefined)} apply={(text) => {
      const editor = instance.current;
      if (!editor || JSON.stringify(editor.getJSON()) !== target.document) return false;
      const parts = text.split("\n").map((line) => ({ type: "paragraph", content: line ? [{ type: "text", text: line }] : [] }));
      if (target.whole) editor.commands.setContent(resumeEditorDocument(text, bullets));
      else editor.commands.insertContentAt({ from: target.from, to: target.to }, parts.length === 1 ? { type: "text", text } : parts);
      return JSON.stringify(editor.getJSON()) !== target.document || text === target.text;
    }} />}
  </div>;
}
