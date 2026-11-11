import "server-only";

import { parse } from "node-html-parser";
import { updateStudio } from "./data";
import { recordHash } from "@/lib/record-hash";

import { httpsLink, type PublicistPreferences, type StudioSource, type Studio } from "./schema";
import { readPublicFeed } from "./public-feed";

export const newsFeeds = {
  aws: { name: "AWS News Blog", url: "https://aws.amazon.com/blogs/aws/feed/" },
  cncf: { name: "Cloud Native Computing Foundation", url: "https://www.cncf.io/feed/" },
  microsoft: { name: "Microsoft Security Blog", url: "https://www.microsoft.com/en-us/security/blog/feed/" },
};
export type NewsFeed = string;

export function configuredFeeds(studio: Pick<Studio, "customNewsFeeds" | "publicist">) {
  const industry = studio.publicist.industry || studio.publicist.topics.join(" OR ");
  const search = industry ? [{ id: "industry-search", name: "Industry search · Google News", url: "https://news.google.com/rss/search?" + new URLSearchParams({ q: industry + " when:30d", hl: "en-US", gl: "US", ceid: "US:en" }) }] : [];
  return [...search, ...Object.entries(newsFeeds).map(([id, value]) => ({ id, ...value })), ...studio.customNewsFeeds];
}

export async function readNewsFeed(key: NewsFeed, url?: string): Promise<StudioSource[]> {
  const address = url ?? newsFeeds[key as keyof typeof newsFeeds]?.url;
  if (!address) throw new Error("Choose a configured feed.");
  return parseNewsRss(await readPublicFeed(address), key);
}

export function parseNewsRss(body: string, key: NewsFeed, now = new Date().toISOString()): StudioSource[] {
  const doc = parse(body.replace(/<(\/?)link(?=[\s>])/gi, "<$1rss-link"), { lowerCaseTagName: true });
  const items = [...doc.querySelectorAll("channel > item"), ...doc.querySelectorAll("feed > entry")];
  if (!items.length) throw new Error("The feed has no readable items.");
  const clean = (value: string) => parse(value.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, "")).text.replace(/\s+/g, " ").trim();
  return items.slice(0, 30).flatMap((item) => {
    // An RSS <link> is text, unlike the HTML void tag.
    const link = item.querySelector('rss-link[rel="alternate"]')?.getAttribute("href") ?? item.querySelector("rss-link")?.getAttribute("href") ?? item.querySelector("rss-link")?.text.trim() ?? "";
    const url = httpsLink.safeParse(link.replace(/&amp;/g, "&"));
    const title = clean(item.querySelector("title")?.innerHTML ?? "").slice(0, 200);
    const date = new Date(item.querySelector("pubdate")?.text ?? item.querySelector("published")?.text ?? item.querySelector("updated")?.text ?? "");
    if (!url.success || !title || !Number.isFinite(date.getTime()) || date.getTime() > Date.parse(now)) return [];
    return [{ id: "news:" + recordHash(url.data), kind: "NEWS", title, url: url.data, text: clean(item.querySelector("description")?.innerHTML ?? item.querySelector("summary")?.innerHTML ?? "").slice(0, 650), applicationId: "", createdAt: now, publishedAt: date.toISOString(), feed: key }];
  });
}

export function matchesNews(source: Pick<StudioSource, "title" | "text">, preferences: Pick<PublicistPreferences, "topics" | "exclude">) {
  const text = source.title + " " + source.text;
  const match = (term: string) => new RegExp("(^|[^\\p{L}\\p{N}])" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^\\p{L}\\p{N}])", "iu").test(text);
  return !preferences.exclude.some(match) && (!preferences.topics.length || preferences.topics.some(match));
}

/** Public feeds only. An attempted scheduled check consumes that day's slot. */
export async function refreshNews(feeds: NewsFeed[] | null) {
  const now = new Date().toISOString();
  const keys = await updateStudio((studio) => {
    if (!feeds && !studio.newsAuto) return null;
    const minInterval = feeds ? 60000 : 86400000;
    if (studio.lastNewsCheck && Date.now() - Date.parse(studio.lastNewsCheck) < minInterval) return null;
    studio.lastNewsCheck = now;
    return { feeds: configuredFeeds(studio).filter((feed) => (feeds ?? studio.newsFeeds).includes(feed.id)), preferences: studio.publicist };
  });
  if (!keys?.feeds.length) return null;
  const results = await Promise.allSettled(keys.feeds.map((feed) => readNewsFeed(feed.id, feed.url)));
  const errors: string[] = [];
  await updateStudio((studio) => {
    if (studio.lastNewsCheck !== now || (!feeds && !studio.newsAuto)) return;
    for (let i = 0; i < results.length; i++) {
      const result = results[i], { id: key, name } = keys.feeds[i];
      if (!studio.newsFeeds.includes(key) || !configuredFeeds(studio).some((feed) => feed.id === key)) continue;
      if (result.status === "rejected" || !result.value.length) { errors.push(name); continue; }
      const rows = result.value.filter((source) => Date.parse(source.publishedAt ?? "") > Date.now() - 45 * 86400000 && matchesNews(source, studio.publicist)).slice(0, 8);
      studio.sources = [...rows, ...studio.sources.filter((source) => source.feed !== key && !rows.some((row) => row.id === source.id))];
    }
    // Keep user-supplied sources; only cached feed entries can be aged out.
    studio.sources = [...studio.sources.filter((source) => source.kind !== "NEWS"), ...studio.sources.filter((source) => source.kind === "NEWS").sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))].slice(0, 80);
  });
  return { errors };
}
