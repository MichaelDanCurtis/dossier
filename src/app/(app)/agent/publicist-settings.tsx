"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toastResult } from "@/components/toast";
import type { PublicistPreferences, Studio } from "@/lib/studio/schema";
import type { publicistConnections } from "@/lib/studio/publicist-provider";
import { addPublicistFeed, listPublicistModels, removePublicistFeed, savePublicistNews, savePublicistPreferences } from "./studio-actions";

export type PublicistConnections = Awaited<ReturnType<typeof publicistConnections>>;
const control = "mt-1 block w-full rounded-control border border-line-input bg-input px-3 py-2 text-sm";
const terms = (text: string) => [...new Set(text.split(",").map((value) => value.trim()).filter(Boolean))];

export function PublicistModelSettings({ preferences, connections }: { preferences: PublicistPreferences; connections: PublicistConnections }) {
  const router = useRouter(), [busy, start] = useTransition();
  const [settings, setSettings] = useState(preferences);
  const [models, setModels] = useState<string[]>([]), [imageModels, setImageModels] = useState<string[]>([]);
  const selected = connections.find((item) => settings.connectionId ? item.id === settings.connectionId : item.isDefault);
  const load = (image: boolean) => start(async () => {
    const result = toastResult(await listPublicistModels({ connectionId: image ? settings.imageConnectionId : settings.connectionId, image }));
    if (result.ok) { if (image) setImageModels(result.data.models); else setModels(result.data.models); }
  });
  return <form className="max-w-[960px] space-y-4 rounded-panel border border-line-card bg-card p-5" onSubmit={(event) => {
    event.preventDefault(); start(async () => {
      const { connectionId, model, effort, audience, voice, expertise, imageConnectionId, imageModel } = settings;
      const result = toastResult(await savePublicistPreferences({ connectionId, model, effort, audience, voice, expertise, imageConnectionId, imageModel }));
      if (result.ok) router.refresh();
    });
  }}>
    <h2 className="font-medium">Your writing partner</h2>
    <p className="text-sm text-muted">Give Publicist its own model and voice. Other CareerAI tasks keep their existing settings.</p>
    <label className="block text-sm">AI connection<select aria-label="Publicist AI connection" className={control} value={settings.connectionId} onChange={(e) => { setSettings({ ...settings, connectionId: e.target.value, model: "" }); setModels([]); }}>
      <option value="">Follow app default</option>{connections.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select></label>
    <label className="block text-sm">Model<input aria-label="Publicist model" className={control} list="publicist-model-list" value={settings.model} maxLength={200} placeholder={selected?.model || "Use the connection’s default model"} onChange={(e) => setSettings({ ...settings, model: e.target.value })} /></label>
    <datalist id="publicist-model-list">{models.map((model) => <option key={model} value={model} />)}</datalist>
    <Button size="sm" variant="secondary" disabled={busy} onClick={() => load(false)}>Load provider models</Button>
    <label className="block text-sm">Reasoning effort<select aria-label="Publicist effort" className={control} value={settings.effort} onChange={(e) => setSettings({ ...settings, effort: e.target.value as PublicistPreferences["effort"] })}>
      <option value="default">Provider default</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
    </select></label>
    <p className="text-xs text-muted">Effort applies where the provider/model supports it. Higher effort can take longer and cost more. Model choices are loaded from your provider.</p>
    <Textarea label="Who are we writing for?" rows={2} maxLength={500} value={settings.audience} onChange={(e) => setSettings({ ...settings, audience: e.target.value })} placeholder="Engineering leaders, potential clients, peers in my industry…" />
    <Textarea label="How should it sound?" rows={3} maxLength={2000} value={settings.voice} onChange={(e) => setSettings({ ...settings, voice: e.target.value })} placeholder="Direct, practical, a little dry humor. No hype or corporate filler." />
    <Textarea label="Public expertise and interests" rows={3} maxLength={3000} value={settings.expertise} onChange={(e) => setSettings({ ...settings, expertise: e.target.value })} placeholder="What do you know, build or care about that you’re comfortable discussing publicly?" />
    <fieldset className="space-y-3 border-t border-line pt-4">
      <legend className="text-sm font-medium">Optional image generation</legend>
      <label className="block text-sm">Image provider connection<select aria-label="Image AI connection" className={control} value={settings.imageConnectionId} onChange={(e) => { setSettings({ ...settings, imageConnectionId: e.target.value, imageModel: "" }); setImageModels([]); }}>
        <option value="">Image generation off</option>{connections.filter((item) => item.imageCapable).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      <label className="block text-sm">Image model<input aria-label="Image model" className={control} list="publicist-image-model-list" disabled={!settings.imageConnectionId} value={settings.imageModel} maxLength={200} onChange={(e) => setSettings({ ...settings, imageModel: e.target.value })} placeholder="Choose an image-generation model from your provider" /></label>
      <datalist id="publicist-image-model-list">{imageModels.map((model) => <option key={model} value={model} />)}</datalist>
      <Button size="sm" variant="secondary" disabled={busy || !settings.imageConnectionId} onClick={() => load(true)}>Load image models</Button>
      <p className="text-xs text-muted">Uses the selected OpenAI or OpenRouter connection and its image API. No automatic provider fallback. Image generation is a separate paid request, only when you press Generate image. <Link className="underline" href="/settings?section=ai">Manage AI connections</Link>.</p>
    </fieldset>
    <Button type="submit" disabled={busy}>Save Publicist settings</Button>
  </form>;
}

const defaults = [{ id: "aws", name: "AWS News" }, { id: "cncf", name: "CNCF" }, { id: "microsoft", name: "Microsoft Security" }];
export function PublicistNewsSettings({ studio }: { studio: Pick<Studio, "publicist" | "customNewsFeeds" | "newsFeeds" | "newsAuto"> }) {
  const router = useRouter(), [busy, start] = useTransition();
  const [industry, setIndustry] = useState(studio.publicist.industry), [topics, setTopics] = useState(studio.publicist.topics.join(", ")), [exclude, setExclude] = useState(studio.publicist.exclude.join(", "));
  const [selected, setSelected] = useState(studio.newsFeeds), [daily, setDaily] = useState(studio.newsAuto);
  const [name, setName] = useState(""), [url, setUrl] = useState("");
  return <section className="space-y-5 rounded-panel border border-line-card bg-card p-5">
    <h2 className="font-medium">Your industry news</h2>
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); start(async () => {
      const result = toastResult(await savePublicistNews({ industry, topics: terms(topics), exclude: terms(exclude), feeds: selected, enabled: daily }));
      if (result.ok) router.refresh();
    }); }}>
      <label className="block text-sm">Industry or field<input aria-label="Industry or field" className={control} value={industry} maxLength={200} onChange={(e) => setIndustry(e.target.value)} placeholder="Cloud infrastructure, healthcare, finance, manufacturing…" /></label>
      <Textarea label="Topics to watch" rows={2} value={topics} maxLength={1200} onChange={(e) => setTopics(e.target.value)} placeholder="Comma-separated: AI infrastructure, automation, cybersecurity" />
      <Textarea label="Topics to leave out" rows={2} value={exclude} maxLength={1200} onChange={(e) => setExclude(e.target.value)} placeholder="Comma-separated exclusions" />
      <p className="text-xs text-muted">Industry guides brainstorming. Watch topics filter feed headlines and excerpts; leave them blank to keep all topics. Up to 12 terms in each list.</p>
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Feeds to collect</legend>
        {[...(industry.trim() || terms(topics).length ? [{ id: "industry-search", name: "Search my industry · Google News" }] : []), ...defaults, ...studio.customNewsFeeds].map((feed) => <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 text-sm" key={feed.id}>
          <label className="flex min-w-0 items-center gap-2"><input type="checkbox" checked={selected.includes(feed.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, feed.id] : selected.filter((id) => id !== feed.id))} />{feed.name}</label>
          {feed.id.startsWith("custom:") && <Button size="sm" variant="text" disabled={busy} aria-label={`Remove feed ${feed.name}`} onClick={() => start(async () => {
            const result = toastResult(await removePublicistFeed({ id: feed.id }));
            if (result.ok) { setSelected(selected.filter((id) => id !== feed.id)); router.refresh(); }
          })}>Remove</Button>}
        </div>)}
      </fieldset>
      <p className="text-xs text-muted">Industry search sends your saved industry/topic query to Google News RSS, then applies your topic filters locally. It does not send profile details, messages or pay.</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={daily} onChange={(e) => setDaily(e.target.checked)} />Collect selected feeds daily</label>
      <p className="text-xs text-muted">Up to ten selected feeds. Collection never drafts or posts automatically.</p>
      <Button type="submit" disabled={busy}>Save news preferences</Button>
    </form>
    <form className="space-y-3 border-t border-line pt-4" onSubmit={(e) => { e.preventDefault(); start(async () => {
      const result = toastResult(await addPublicistFeed({ name, url }));
      if (result.ok) { setSelected((previous) => previous.length < 10 ? [...previous, result.data.id] : previous); setName(""); setUrl(""); router.refresh(); }
    }); }}>
      <h3 className="text-sm font-medium">Add a publisher from any industry</h3>
      <label className="block text-sm">Feed name<input aria-label="Feed name" required className={control} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></label>
      <label className="block text-sm">Public RSS or Atom URL<input aria-label="Public RSS or Atom URL" required type="url" className={control} value={url} maxLength={2000} onChange={(e) => setUrl(e.target.value)} placeholder="https://publisher.example/feed/" /></label>
      <p className="text-xs text-muted">Use the publisher’s feed address. Avoid private feeds or URLs containing access tokens.</p>
      <Button type="submit" variant="secondary" disabled={busy}>Add news feed</Button>
    </form>
  </section>;
}
