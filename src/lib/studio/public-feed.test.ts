import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("node:https", () => ({ default: { get: mock.get } }));
import { guardedLookup } from "@/lib/posting-fetch";
import { publicFeedUrl, readPublicFeed } from "./public-feed";

beforeEach(() => { mock.get.mockReset(); });
describe("public publisher feeds", () => {
  it.each(["http://example.com/feed", "https://user:pass@example.com/feed", "https://localhost/feed", "https://127.0.0.1/feed", "https://0x7f000001/feed", "https://[::1]/feed", "https://[::ffff:127.0.0.1]/feed", "https://169.254.169.254/latest", "https://10.0.0.1/feed", "https://example.com:8443/feed"])("refuses private or credential-bearing addresses: %s", (url) => expect(() => publicFeedUrl(url)).toThrow());
  it("pins requests to the guarded public DNS lookup", async () => {
    mock.get.mockImplementation((_url, _options, callback) => {
      const response = Object.assign(Readable.from([Buffer.from("<rss>fixture</rss>")]), { statusCode: 200, headers: {} });
      callback(response); return new EventEmitter();
    });
    expect(await readPublicFeed("https://example.com/feed")).toBe("<rss>fixture</rss>");
    expect(mock.get.mock.calls[0][1].lookup).toBe(guardedLookup);
  });
  it("checks a redirect destination before connecting", async () => {
    mock.get.mockImplementation((_url, _options, callback) => {
      callback(Object.assign(Readable.from([]), { statusCode: 302, headers: { location: "https://127.0.0.1/private" } }));
      return new EventEmitter();
    });
    await expect(readPublicFeed("https://example.com/feed")).rejects.toThrow("public HTTPS");
    expect(mock.get).toHaveBeenCalledTimes(1);
  });
  it("bounds downloaded feed data", async () => {
    mock.get.mockImplementation((_url, _options, callback) => {
      callback(Object.assign(Readable.from([Buffer.alloc(2 * 1024 * 1024 + 1)]), { statusCode: 200, headers: {} }));
      return new EventEmitter();
    });
    await expect(readPublicFeed("https://example.com/feed")).rejects.toThrow("2 MiB");
  });
  it("rejects malformed redirect headers without throwing outside the request", async () => {
    mock.get.mockImplementation((_url, _options, callback) => {
      callback(Object.assign(Readable.from([]), { statusCode: 302, headers: { location: "https://%" } }));
      return new EventEmitter();
    });
    await expect(readPublicFeed("https://example.com/feed")).rejects.toThrow("invalid redirect");
  });
});
