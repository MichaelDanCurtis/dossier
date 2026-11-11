import { describe, expect, it } from "vitest";
import { citationSpans } from "./citation";
import { resumeEditorDocument, resumeEditorText } from "./resume-editor-text";
import { replaceWritingSelection } from "./writing-assist";

describe("reviewed writing edits", () => {
  it("replaces only the original selected range, and refuses stale or oversized edits", () => {
    expect(replaceWritingSelection("Built tools. Led teams.", "Built tools. Led teams.", 0, 12, "Created tools.", 100)).toBe("Created tools. Led teams.");
    expect(replaceWritingSelection("User changed it", "Built tools.", 0, 11, "Created tools.", 100)).toBeNull();
    expect(replaceWritingSelection("Built tools.", "Built tools.", 0, 12, "x".repeat(101), 100)).toBeNull();
    expect(replaceWritingSelection("Built tools.", "Built tools.", -1, 3, "Hi", 100)).toBeNull();
  });
  it.each([false, true])("roundtrips paragraphs and bullet sections (%s) with emphasis and literal asterisks", (bullets) => {
    const text = "Built **useful tools** for *people*.\nA literal \\* belongs here.";
    expect(resumeEditorText(resumeEditorDocument(text, bullets))).toBe(text);
  });
  it("preserves text when arbitrary sub-word emphasis cannot be represented by resume markup", () => {
    const value = resumeEditorText({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Auto" }, { type: "text", text: "mation", marks: [{ type: "bold" }] }] }] });
    expect(citationSpans(value).map((span) => span.text).join("")).toBe("Automation");
  });
});
