import "server-only";

import { parse } from "node-html-parser";
import { updateStudio } from "./data";
import { recordHash } from "@/lib/record-hash";

import { httpsLink, type StudioSource } from "./schema";

export const newsFeeds = {
  aws: { name: "AWS News Blog", url: "https://aws.amazon.com/blogs/aws/feed/" },
  cncf: { name: "Cloud Native Computing Foundation", url: "https://www.cncf.io/feed/" },
  microsoft: { name: "Microsoft Security Blog", url: "https://www.microsoft.com/en-us/security/blog/feed/" },
};
export type NewsFeed = keyof typeof newsFeeds;

export async function readNewsFeed(key: NewsFeed): Promise<StudioSource[]> {
  const feed = newsFeeds[key];
  const result = await fetch(feed.url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12000), headers: { accept: "application/rss+xml, application/xml, text/xml" } });
  if (!result.ok || !result.body) throw new Error("The feed could not be read.");
  const reader = result.body.getReader(), decoder = new TextDecoder();
  let body = "", bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new Error("The feed is too large.");
      body += decoder.decode(next.value, { stream: true });
    }
    body += decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return parseNewsRss(body, key);
}

export function parseNewsRss(body: string, key: NewsFeed, now = new Date().toISOString()): StudioSource[] {
  const doc = parse(body.replace(/<(\/?)link(?=[\s>])/gi, "<$1rss-link"), { lowerCaseTagName: true });
  const items = doc.querySelectorAll("channel > item");
  if (!items.length) throw new Error("The feed has no readable items.");
  const clean = (value: string) => parse(value.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, "")).text.replace(/\s+/g, " ").trim();
  return items.slice(0, 8).flatMap((item) => {
    // An RSS <link> is text, unlike the HTML void tag.
    const link = item.querySelector("rss-link")?.text.trim() ?? "";
    const url = httpsLink.safeParse(link.replace(/&amp;/g, "&"));
    const title = clean(item.querySelector("title")?.innerHTML ?? "").slice(0, 200);
    const date = new Date(item.querySelector("pubdate")?.text ?? "");
    if (!url.success || !title || !Number.isFinite(date.getTime()) || date.getTime() > Date.parse(now)) return [];
    return [{ id: "news:" + recordHash(url.data), kind: "NEWS", title, url: url.data, text: clean(item.querySelector("description")?.innerHTML ?? "").slice(0, 650), applicationId: "", createdAt: now, publishedAt: date.toISOString(), feed: key }];
  });
}


/** Public feeds only. An attempted scheduled check consumes that day's slot. */
export async function refreshNews(feeds: NewsFeed[] | null) {
  const now = new Date().toISOString();
  const keys = await updateStudio((studio) => {
    if (!feeds && !studio.newsAuto) return null;
    const minInterval = feeds ? 60000 : 86400000;
    if (studio.lastNewsCheck && Date.now() - Date.parse(studio.lastNewsCheck) < minInterval) return null;
    studio.lastNewsCheck = now;
    return [...new Set(feeds ?? studio.newsFeeds)];
  });
  if (!keys?.length) return null;
  const results = await Promise.allSettled(keys.map(readNewsFeed));
  const errors: string[] = [];
  await updateStudio((studio) => {
    if (studio.lastNewsCheck !== now || (!feeds && !studio.newsAuto)) return;
    for (let i = 0; i < results.length; i++) {
      const result = results[i], key = keys[i];
      if (result.status === "rejected" || !result.value.length) { errors.push(newsFeeds[key].name); continue; }
      const rows = result.value.filter((source) => Date.parse(source.publishedAt ?? "") > Date.now() - 45 * 86400000);
      studio.sources = [...rows, ...studio.sources.filter((source) => source.feed !== key && !rows.some((row) => row.id === source.id))];
    }
    // Keep user-supplied sources; only cached feed entries can be aged out.
    studio.sources = [...studio.sources.filter((source) => source.kind !== "NEWS"), ...studio.sources.filter((source) => source.kind === "NEWS").sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))].slice(0, 80);
  });
  return { errors };
}
