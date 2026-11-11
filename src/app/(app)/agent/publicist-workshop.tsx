"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toastResult } from "@/components/toast";
import type { Studio } from "@/lib/studio/schema";
import { resetPublicistConversation, talkToPublicist } from "./studio-actions";

export function PublicistWorkshop({ initial, sourceIds, onChoose }: { initial: Studio["publicistChat"]; sourceIds: string[]; onChoose: (brief: string) => void }) {
  const router = useRouter(), [busy, start] = useTransition();
  const [chat, setChat] = useState(initial), [text, setText] = useState("");
  const history = useRef<HTMLDivElement>(null);
  useEffect(() => { if (history.current) history.current.scrollTop = history.current.scrollHeight; }, [chat.messages.length]);
  return <section className="space-y-4 rounded-panel border border-line-card bg-card p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-heading text-section">What do we want to write about?</h2><p className="mt-2 text-sm text-muted">A project, an opinion you’re working through, something in the news—or just a half-formed idea. Let’s kick it around before drafting.</p></div>
      {chat.messages.length > 0 && <Button size="sm" variant="text" disabled={busy} onClick={() => {
        if (!window.confirm("Start a fresh Publicist conversation? Saved drafts stay available.")) return;
        start(async () => {
          const result = toastResult(await resetPublicistConversation({ revision: chat.revision }));
          if (result.ok) { setChat({ revision: chat.revision + 1, messages: [], ideas: [] }); router.refresh(); }
        });
      }}>New conversation</Button>}
    </div>
    {!chat.messages.length && <div className="flex flex-wrap gap-2">
      {["Help me find an angle from my recent work.", "What’s worth discussing in my industry?", "I built something—help me tell the story."].map((idea) => <Button key={idea} size="sm" variant="secondary" onClick={() => setText(idea)}><span className="whitespace-normal text-left">{idea}</span></Button>)}
    </div>}
    <div ref={history} className="max-h-[520px] space-y-3 overflow-y-auto" aria-live="polite" aria-label="Publicist conversation">
      {chat.messages.map((message) => <div key={message.id} className={`rounded-control border border-line p-3 text-sm ${message.role === "user" ? "bg-input" : "bg-surface"}`}>
        <p className="mb-1 text-xs font-medium text-muted">{message.role === "user" ? "You" : "Publicist"}</p><p className="whitespace-pre-wrap break-words">{message.text}</p>
      </div>)}
    </div>
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); start(async () => {
      const result = toastResult(await talkToPublicist({ text, revision: chat.revision, sourceIds }));
      if (result.ok) { setChat(result.data); setText(""); router.refresh(); }
    }); }}>
      <Textarea label="Let’s talk about it" rows={3} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} placeholder="I’ve been thinking about… / Here’s what we built… / I’m not sure what my take is yet…" />
      <p className="text-xs text-muted">Uses your saved Publicist model, writing context and {sourceIds.length} selected source{sourceIds.length === 1 ? "" : "s"}. Private messages and pay are excluded.</p>
      <Button type="submit" disabled={busy || !text.trim()}>{busy ? "Thinking it through…" : "Talk it through"}</Button>
    </form>
    {chat.ideas.length > 0 && <div className="space-y-3 border-t border-line pt-4">
      <h3 className="font-medium">Directions we could take</h3>
      {chat.ideas.map((idea, index) => <article key={index} className="space-y-2 rounded-control border border-line p-3 text-sm">
        <h4 className="font-medium">{idea.title}</h4><p>{idea.angle}</p>{idea.question && <p className="text-muted">{idea.question}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setText(`Let’s explore “${idea.title}”. ${idea.question}`)}>Explore this idea</Button>
          <Button size="sm" variant="secondary" onClick={() => onChoose(idea.title + "\n\n" + idea.angle)}>Use as draft brief</Button>
        </div>
      </article>)}
    </div>}
  </section>;
}
