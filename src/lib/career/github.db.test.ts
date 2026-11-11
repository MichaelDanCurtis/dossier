import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestClient, resetDatabase } from "@/test/db";
import { allowGithubRepository, checkPrivateRepositoryAccess, disconnectGithub, githubConnectionView, listConnectedRepositories, removeGithubRepository, saveGithubConnection } from "./github";
import { readRepository, readPublicRepository } from "./repositories";
import { buildExport } from "@/lib/data-export";
import { githubTokenSchema, redactRepositorySecrets } from "./github-schema";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => { const { createTestClient } = await import("@/test/db"); db.client = createTestClient(); return { prisma: db.client }; });
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "g".repeat(32) } }));
const prisma = () => db.client!;
const token = "github_pat_" + "fake_read_only_fixture_".repeat(3);
const revisionCalls: { url: string; init: RequestInit }[] = [];
const repo = { id: 44, full_name: "person/private-project", private: true, fork: false, default_branch: "main", description: "Private work", language: "Rust" };
beforeEach(async () => {
  await resetDatabase(prisma()); revisionCalls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    revisionCalls.push({ url, init }); const pathname = new URL(url).pathname;
    const authorized = (init.headers as Record<string, string>).authorization === `Bearer ${token}`;
    if (pathname === "/user") return authorized ? Response.json({ login: "person" }, { headers: { "github-authentication-token-expiration": "2026-12-11 00:00:00 UTC" } }) : new Response("no", { status: 401 });
    if (pathname === "/user/repos") return authorized ? Response.json([repo]) : new Response("no", { status: 401 });
    if (!authorized) return new Response("private", { status: 404 });
    if (pathname.endsWith("/branches/main")) return Response.json({ commit: { sha: "a".repeat(40) } });
    if (pathname.endsWith("/readme")) return new Response(`Private project documentation with an accidental example: ${token}`);
    if (pathname.endsWith("/contents/ARCHITECTURE.md")) return new Response("A documented architecture, not verified authorship.");
    if (pathname.includes("/contents/")) return new Response("not present", { status: 404 });
    return Response.json(repo);
  }));
});
afterAll(async () => { vi.unstubAllGlobals(); await prisma().$disconnect(); });

describe("private repository permission boundaries", () => {
  it("stores the credential encrypted, never returns it, and excludes connection and access selections from exports", async () => {
    const view = await saveGithubConnection(token);
    expect(view).toMatchObject({ state: "connected", login: "person", repositories: [] });
    expect(JSON.stringify(view)).not.toContain(token);
    const stored = await prisma().setting.findUniqueOrThrow({ where: { key: "githubConnectionEnc" } });
    expect(stored.value).toMatch(/^v1\./); expect(stored.value).not.toContain(token);
    await allowGithubRepository(repo.full_name);
    expect((await listConnectedRepositories(1))[0]).toMatchObject({ name: repo.full_name, private: true });
    const data = await buildExport(prisma());
    expect(data.settings.some((s) => s.key.startsWith("github"))).toBe(false);
    expect(JSON.stringify(data)).not.toContain(token);
  });
  it("requires explicit repository selection and pins only documentation reads to a commit", async () => {
    await saveGithubConnection(token);
    await expect(readRepository(repo.full_name)).rejects.toThrow("connect GitHub and allow");
    expect(revisionCalls.at(-1)!.init.headers).not.toHaveProperty("authorization");
    await allowGithubRepository(repo.full_name);
    const snapshot = await readRepository(repo.full_name, true);
    expect(snapshot).toMatchObject({ visibility: "private", commit: "a".repeat(40), documents: ["README", "ARCHITECTURE.md"] });
    expect(snapshot.readme).toContain("[credential redacted]"); expect(snapshot.readme).not.toContain(token);
    expect(JSON.stringify(snapshot)).not.toContain(token);
    expect(revisionCalls.filter((c) => c.url.includes("/contents/")).every((c) => c.url.includes(`ref=${"a".repeat(40)}`))).toBe(true);
    for (const call of revisionCalls) { expect(call.init.method).toBe("GET"); expect(call.init.redirect).toBe("error"); expect(new URL(call.url).origin).toBe("https://api.github.com"); }
    await checkPrivateRepositoryAccess(snapshot);
    await removeGithubRepository(repo.full_name);
    await expect(checkPrivateRepositoryAccess(snapshot)).rejects.toThrow("access changed");
  });
  it("rotation and disconnect invalidate previews and stop later private analysis", async () => {
    await saveGithubConnection(token); await allowGithubRepository(repo.full_name);
    const snapshot = await readRepository(repo.full_name);
    await saveGithubConnection(token);
    expect((await githubConnectionView()).repositories).toEqual([]);
    await allowGithubRepository(repo.full_name);
    await expect(checkPrivateRepositoryAccess(snapshot)).rejects.toThrow("access changed");
    await disconnectGithub();
    expect((await githubConnectionView()).state).toBe("none");
    expect(await prisma().setting.count({ where: { key: { startsWith: "github" } } })).toBe(0);
    await expect(checkPrivateRepositoryAccess(snapshot)).rejects.toThrow("access changed");
  });
  it("never adds a private token to a public-only request, even with connected credentials", async () => {
    await saveGithubConnection(token);
    await expect(readPublicRepository(repo.full_name)).rejects.toThrow("unavailable");
    expect(revisionCalls.at(-1)!.init.headers).not.toHaveProperty("authorization");
  });
  it("rejects classic tokens and surfaces revoked-token errors without their response body or credential", async () => {
    expect(githubTokenSchema.safeParse("ghp_" + "b".repeat(40)).success).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`Echoing token ${token} must never reach the screen`, { status: 401 })));
    await expect(saveGithubConnection(token)).rejects.toThrow("expired or been revoked");
    expect((await githubConnectionView()).state).toBe("none");
    expect(redactRepositorySecrets("-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----")).toBe("[private key redacted]");
  });
});
