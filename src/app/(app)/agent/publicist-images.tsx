"use client";
import Image from "next/image";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/toast";
import { saveFile } from "@/lib/save-file";
import type { PublicistPreferences, Studio } from "@/lib/studio/schema";

export function PublicistImages({ preferences, visual }: { preferences: PublicistPreferences; visual: Studio["publicistChat"]["visual"] }) {
  const [prompt, setPrompt] = useState(visual?.prompt ?? ""), [alt, setAlt] = useState(visual?.altText ?? "");
  const [quality, setQuality] = useState<"low" | "medium" | "high">("low");
  const [image, setImage] = useState<{ url: string; blob: Blob }>(), [busy, start] = useTransition();
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);
  const ready = !!preferences.imageConnectionId && !!preferences.imageModel;
  const query = visual?.photoQuery || preferences.industry;
  return <section className="max-w-[960px] space-y-4 rounded-panel border border-line-card bg-card p-5">
    <h2 className="font-heading text-section">Give the idea a visual</h2>
    <p className="text-sm text-muted">A diagram, an original illustration or a real photograph can help. Brainstorm the angle first, then decide what actually adds something.</p>
    {visual?.prompt && <Button size="sm" variant="secondary" onClick={() => { setPrompt(visual.prompt); setAlt(visual.altText); }}>Use conversation’s visual idea</Button>}
    <Textarea label="Image brief" rows={5} maxLength={4000} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe the idea, composition and style. Avoid implying a generated image is a photograph of real work." />
    <Textarea label="Image description / alt text" rows={2} maxLength={500} value={alt} onChange={(e) => setAlt(e.target.value)} />
    {query && <div className="flex flex-wrap gap-3 text-sm">
      <a className="underline" href={`https://unsplash.com/s/photos/${encodeURIComponent(query.replace(/\s+/g, "-"))}`} target="_blank" rel="noreferrer">Find photos on Unsplash ↗</a>
      <a className="underline" href={`https://commons.wikimedia.org/w/index.php?search=${encodeURIComponent(query)}&title=Special:MediaSearch&type=image`} target="_blank" rel="noreferrer">Find images on Wikimedia ↗</a>
      <p className="w-full text-xs text-muted">Search links open image sources; review the individual image’s license and attribution before using it.</p>
    </div>}
    <label className="block text-sm">Image quality<select aria-label="Image quality" className="ml-2 rounded-control border border-line-input bg-input px-3 py-2" value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
    <p className="text-xs text-muted">{ready ? `Using ${preferences.imageModel}. Generating uses OpenAI API credits; quality affects cost and latency.` : "Image generation is off. Choose a saved OpenAI connection and image model in Publicist Settings."}</p>
    <Button disabled={!ready || busy || prompt.trim().length < 10} onClick={() => start(async () => {
      try {
        const response = await fetch("/api/publicist/image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, quality, approved: true, expectedConnectionId: preferences.imageConnectionId, expectedModel: preferences.imageModel }) });
        if (!response.ok) { const result = await response.json(); toast(result.error || "The image could not be generated."); return; }
        if (!response.headers.get("content-type")?.startsWith("image/png")) { toast("Sign in again before generating an image."); return; }
        const blob = await response.blob(); setImage({ url: URL.createObjectURL(blob), blob });
      } catch { toast("Image generation could not be confirmed. Check provider usage before trying again."); }
    })}>{busy ? "Generating image…" : "Generate image · uses API credits"}</Button>
    {image && <div className="space-y-3 border-t border-line pt-4">
      <Image src={image.url} alt={alt || "AI-generated illustration for your draft"} width={1024} height={1024} unoptimized className="h-auto w-full max-w-lg rounded-panel" />
      <Button variant="secondary" size="sm" onClick={() => saveFile(image.blob, "careerai-publicist.png")}>Download image</Button>
      <p className="text-xs text-muted">Download before leaving or reloading. This image stays in this browser, not your saved drafts. Attach it manually when posting; the current LinkedIn publish button sends text only.</p>
    </div>}
  </section>;
}
