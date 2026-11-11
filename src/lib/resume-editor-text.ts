import type { JSONContent } from "@tiptap/core";

import { citationSpans, escapeMarks } from "@/lib/citation";

export function resumeEditorDocument(value: string, bullets: boolean): JSONContent {
  const paragraphs = value.split("\n").map((line): JSONContent => ({
    type: "paragraph",
    content: citationSpans(line).filter(({ text }) => text).map(({ text, bold, italic }) => ({
      type: "text", text,
      marks: [...(bold ? [{ type: "bold" }] : []), ...(italic ? [{ type: "italic" }] : [])],
    })),
  }));
  return { type: "doc", content: bullets ? [{ type: "bulletList", content: paragraphs.map((paragraph) => ({ type: "listItem", content: [paragraph] })) }] : paragraphs };
}

/** Persist only text and emphasis that the existing resume/PDF renderer understands. */
export function resumeEditorText(doc: JSONContent): string {
  const lines: string[] = [];
  const visit = (node: JSONContent) => {
    if (node.type !== "paragraph") { node.content?.forEach(visit); return; }
    const line = (node.content ?? []).map((part) => {
      if (part.type === "hardBreak") return "\n";
      const raw = escapeMarks(part.text ?? "");
      const marks = (part.marks ?? []).reduce((n, mark) => n + (mark.type === "bold" ? 2 : mark.type === "italic" ? 1 : 0), 0);
      const text = raw.trim();
      if (!marks || !text) return raw;
      const delimiter = "*".repeat(marks);
      return raw.slice(0, raw.indexOf(text)) + delimiter + text + delimiter + raw.slice(raw.indexOf(text) + text.length);
    }).join("");
    const plain = (node.content ?? []).map((part) => part.type === "hardBreak" ? "\n" : part.text ?? "").join("");
    // Legacy resume markup can only persist emphasis at word boundaries.
    // Preserve the text rather than exposing asterisks on a printed resume.
    lines.push(citationSpans(line).map((span) => span.text).join("") === plain ? line : escapeMarks(plain));
  };
  visit(doc);
  return lines.join("\n");
}
