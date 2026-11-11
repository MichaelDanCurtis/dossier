"use client";

import { Sparkles } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState, useTransition } from "react";

import { suggestWording } from "@/app/(app)/writing-actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { WritingSuggestion } from "@/lib/writing-assist";

export type WritingTarget = { field: string; text: string; bullets?: boolean };

export function WritingAssistant({ target, onClose, apply }: { target: WritingTarget; onClose: () => void; apply: (text: string) => boolean }) {
  const [notes, setNotes] = useState("");
  const [suggestion, setSuggestion] = useState<WritingSuggestion>();
  const [error, setError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, start] = useTransition();
  const generate = () => start(async () => {
    setError(""); setSuggestion(undefined); setReviewed(false);
    const result = await suggestWording({ ...target, bullets: target.bullets ?? false, notes });
    if (result.ok) setSuggestion(result.data);
    else setError(result.error);
  });
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[90svh] w-[min(600px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-dialog border border-line-popover bg-card p-5 shadow-menu sm:p-6">
          <Dialog.Title className="flex items-center gap-2 font-heading text-xl"><Sparkles size={18} aria-hidden /> Help with wording</Dialog.Title>
          <Dialog.Description className="text-sm text-muted">{target.field}. Your selected text, notes and relevant profile context go to your configured AI. Review any suggestion before using it.</Dialog.Description>
          {target.text && <blockquote className="max-h-32 overflow-auto whitespace-pre-wrap rounded-control border border-line px-3 py-2 text-sm">{target.text}</blockquote>}
          <Textarea label="What should the AI know or change?" placeholder="For example: make it clearer, or add what I did and the result." rows={3} value={notes} maxLength={2500} onChange={(e) => setNotes(e.target.value)} />
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {suggestion && <div className="space-y-2 rounded-control border border-line bg-surface p-3 text-sm" aria-live="polite">
            <h3 className="font-medium">Suggested wording</h3>
            {suggestion.text && <p className="whitespace-pre-wrap">{suggestion.text}</p>}
            {suggestion.reason && <p className="text-muted">{suggestion.reason}</p>}
            {suggestion.question && <p>{suggestion.question}</p>}
            {suggestion.unverified.length > 0 && <label className="flex items-start gap-2"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> I checked these details: {suggestion.unverified.join(", ")}</label>}
          </div>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={generate}>{busy ? "Writing…" : suggestion ? "Try again" : "Generate suggestion"}</Button>
            {suggestion?.text && <Button size="sm" disabled={busy || (suggestion.unverified.length > 0 && !reviewed)} onClick={() => { if (apply(suggestion.text)) onClose(); else setError("The text changed or the suggestion is too long. Reopen the assistant on the current wording."); }}>Use suggestion</Button>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
