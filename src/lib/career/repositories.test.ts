import { afterEach, describe, expect, it, vi } from "vitest";
import { listPublicRepositories, readPublicRepository, repositoryName } from "./repositories";

afterEach(() => vi.unstubAllGlobals());
describe("bounded public repository research", () => {
  it("pins the README to a commit and preserves upstream provenance without credentials or redirects", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ full_name: "person/project", description: "A real repo", language: "Rust", fork: true, parent: { full_name: "upstream/project" }, default_branch: "main" })).mockResolvedValueOnce(Response.json({ commit: { sha: "a".repeat(40) } })).mockResolvedValueOnce(new Response("# Project\nA useful tool."));
    vi.stubGlobal("fetch", fetcher);
    const result = await readPublicRepository("person/project");
    expect(result).toMatchObject({ name: "person/project", fork: true, parent: "upstream/project", commit: "a".repeat(40) });
    expect(fetcher.mock.calls[2][0]).toContain(`/readme?ref=${"a".repeat(40)}`);
    for (const [url, init] of fetcher.mock.calls) { expect(new URL(url).origin).toBe("https://api.github.com"); expect(init.redirect).toBe("error"); expect(init.headers.Authorization).toBeUndefined(); expect(init.headers.cookie).toBeUndefined(); }
  });
  it("refuses arbitrary hosts and surfaces rate limiting without scheduling a generation", async () => {
    expect(repositoryName.safeParse("https://evil.example/repo").success).toBe(false);
    const fetcher = vi.fn().mockResolvedValue(new Response("limited", { status: 429 })); vi.stubGlobal("fetch", fetcher);
    await expect(readPublicRepository("person/project")).rejects.toThrow("no analysis was charged");
    await expect(listPublicRepositories("../secrets", 1)).rejects.toThrow("username");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("bounds API payloads and README data rather than downloading source archives", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(256001))));
    await expect(readPublicRepository("person/project")).rejects.toThrow("too large");
  });
});
