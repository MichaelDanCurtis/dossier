"use client";

import { useTrackSave } from "@/components/save-tracker";
import { Card } from "@/components/ui/card";
import { WritingField } from "@/components/writing/writing-field";
import { useAutosave } from "@/hooks/use-autosave";
import type { Basics } from "@/lib/profile";

import { saveBasics } from "./actions";

/** The Summary section: a field of the basics, on a page of its own because it's a heading on a resume. Autosaved as you type. */
export function SummarySection({ basics, onChange }: { basics: Basics; onChange: (basics: Basics) => void }) {
  const track = useTrackSave();
  const { flush } = useAutosave(basics, (value) => track(saveBasics(value)));

  return (
    <Card>
      <WritingField
        field="Profile summary"
        maxLength={5000}
        label="A few lines about you"
        placeholder="What you do, what you're good at, what you're looking for."
        rows={6}
        value={basics.summary}
        onText={(summary) => onChange({ ...basics, summary })}
        onBlur={flush}
      />
    </Card>
  );
}
