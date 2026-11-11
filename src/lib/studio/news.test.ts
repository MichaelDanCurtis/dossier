import { describe, expect, it, vi } from "vitest";
vi.mock("./data", () => ({ updateStudio: vi.fn() }));
import { parseNewsRss } from "./news";

describe("publisher RSS parsing", () => {
  it("reads RSS links, decodes excerpts and omits unsafe, undated and future entries", () => {
    const rss = '<rss><channel><item><title>Tools &amp; teams</title><link>https://example.com/news?a=1&amp;b=2</link><description><![CDATA[<p>Build <strong>better</strong> tools.</p>]]></description><pubDate>Tue, 10 Nov 2026 10:00:00 GMT</pubDate></item><item><title>unsafe</title><link>javascript:alert(1)</link><pubDate>Tue, 10 Nov 2026 10:00:00 GMT</pubDate></item><item><title>Future</title><link>https://example.com/future</link><pubDate>Tue, 10 Nov 2030 10:00:00 GMT</pubDate></item></channel></rss>';
    const result = parseNewsRss(rss, "aws", "2026-11-10T17:00:00.000Z");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: "NEWS", title: "Tools & teams", text: "Build better tools.", url: "https://example.com/news?a=1&b=2", feed: "aws" });
  });
});
