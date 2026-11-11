import { describe, expect, it, vi } from "vitest";
vi.mock("./data", () => ({ updateStudio: vi.fn() }));
import { configuredFeeds, matchesNews, parseNewsRss } from "./news";
import { studioSchema } from "./schema";

describe("publisher RSS parsing", () => {
  it("builds industry search from saved topics without private profile fields", () => {
    const studio = studioSchema.parse({ publicist: { industry: "healthcare" } });
    const feed = configuredFeeds(studio).find((feed) => feed.id === "industry-search")!;
    expect(new URL(feed.url).searchParams.get("q")).toBe("healthcare when:30d");
  });
  it("reads Atom entries and their alternate links", () => {
    const feed = '<feed><entry><title>Clean energy</title><link rel="alternate" href="https://example.com/energy"/><summary>Real evidence.</summary><updated>2026-11-10T12:00:00Z</updated></entry></feed>';
    expect(parseNewsRss(feed, "custom:energy", "2026-11-11T00:00:00.000Z")[0]).toMatchObject({ title: "Clean energy", url: "https://example.com/energy", text: "Real evidence.", feed: "custom:energy" });
  });
  it("matches chosen topics as words and applies exclusions", () => {
    expect(matchesNews({ title: "A useful AI tool", text: "" }, { topics: ["AI"], exclude: [] })).toBe(true);
    expect(matchesNews({ title: "A fair explanation", text: "" }, { topics: ["AI"], exclude: [] })).toBe(false);
    expect(matchesNews({ title: "AI crypto news", text: "" }, { topics: ["AI"], exclude: ["crypto"] })).toBe(false);
    expect(matchesNews({ title: "C++ performance", text: "" }, { topics: ["C++"], exclude: [] })).toBe(true);
  });
  it("reads RSS links, decodes excerpts and omits unsafe, undated and future entries", () => {
    const rss = '<rss><channel><item><title>Tools &amp; teams</title><link>https://example.com/news?a=1&amp;b=2</link><description><![CDATA[<p>Build <strong>better</strong> tools.</p>]]></description><pubDate>Tue, 10 Nov 2026 10:00:00 GMT</pubDate></item><item><title>unsafe</title><link>javascript:alert(1)</link><pubDate>Tue, 10 Nov 2026 10:00:00 GMT</pubDate></item><item><title>Future</title><link>https://example.com/future</link><pubDate>Tue, 10 Nov 2030 10:00:00 GMT</pubDate></item></channel></rss>';
    const result = parseNewsRss(rss, "aws", "2026-11-10T17:00:00.000Z");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "NEWS", title: "Tools & teams", text: "Build better tools.", url: "https://example.com/news?a=1&b=2", feed: "aws" });
  });
});
