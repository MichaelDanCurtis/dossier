import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ActionError } from "@/lib/action";
import { prisma } from "@/lib/prisma";
import { lockForTransaction } from "@/lib/db-lock";
import { decryptSecret, encryptSecret, GITHUB_CONNECTION } from "@/lib/secrets";
import { githubAccessSchema, githubRepositoryName, githubTokenSchema, type GithubConnectionView } from "./github-schema";

const connectionKey = "githubConnectionEnc";
const accessKey = "githubRepositoryAccess";
const lock = 1128354373;
const connectionSchema = z.object({ token: githubTokenSchema, login: z.string().max(100), revision: z.uuid(), expiresAt: z.string().max(100) });

export async function githubConnection() {
  const row = await prisma.setting.findUnique({ where: { key: connectionKey } });
  if (!row) return null;
  try { return connectionSchema.parse(JSON.parse(decryptSecret(GITHUB_CONNECTION, row.value))); }
  catch { throw new ActionError("The saved GitHub connection cannot be read. Reconnect GitHub in Career → Repositories."); }
}
async function selectedRepositories() {
  const row = await prisma.setting.findUnique({ where: { key: accessKey } });
  try { return row ? githubAccessSchema.parse(JSON.parse(row.value)) : []; } catch { return []; }
}
export async function githubConnectionView(): Promise<GithubConnectionView> {
  try {
    const connection = await githubConnection();
    return { state: connection ? "connected" : "none", login: connection?.login ?? "", expiresAt: connection?.expiresAt ?? "", repositories: connection ? await selectedRepositories() : [] };
  } catch { return { state: "unreadable", login: "", expiresAt: "", repositories: [] }; }
}

/** Only this fixed API origin receives a token; every request is GET and redirects are refused. */
export async function githubRead(path: string, { token, raw = false, optional = false }: { token?: string; raw?: boolean; optional?: boolean } = {}): Promise<{ text: string; expiresAt: string }> {
  if (!path.startsWith("/") || path.startsWith("//") || new URL(`https://api.github.com${path}`).origin !== "https://api.github.com") throw new ActionError("Invalid GitHub API address.");
  let response: Response;
  try { response = await fetch(`https://api.github.com${path}`, { method: "GET", headers: { Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(token ? { authorization: `Bearer ${token}` } : {}) }, redirect: "error", signal: AbortSignal.timeout(12000), cache: "no-store" }); }
  catch { throw new ActionError("GitHub could not be reached. Redirects are refused; no credential is sent to another address."); }
  if (!response.ok) {
    await response.body?.cancel();
    if (optional && response.status === 404) return { text: "", expiresAt: "" };
    throw new ActionError(response.status === 401 ? "GitHub refused this token. It may have expired or been revoked. Reconnect GitHub." : response.status === 404 ? "Repository unavailable. For private work, connect GitHub and allow this repository first; check Contents: read-only permission." : response.status === 403 || response.status === 429 ? "GitHub’s access or API limit was reached. Check token permissions or try later; no analysis was charged." : `GitHub could not provide this repository (HTTP ${response.status}).`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ActionError("GitHub returned no readable content.");
  const chunks: Uint8Array[] = []; let length = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 256000) throw new ActionError("This GitHub document is too large. Use a selected excerpt instead."); chunks.push(value); } }
  finally { await reader.cancel(); }
  return { text: Buffer.concat(chunks).toString("utf8"), expiresAt: response.headers.get("github-authentication-token-expiration") ?? "" };
}

export async function saveGithubConnection(token: string) {
  githubTokenSchema.parse(token);
  const response = await githubRead("/user", { token });
  const user = z.object({ login: z.string().min(1).max(100) }).parse(JSON.parse(response.text));
  const value = encryptSecret(GITHUB_CONNECTION, JSON.stringify({ token, login: user.login, revision: randomUUID(), expiresAt: response.expiresAt }));
  await prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, lock);
    await tx.setting.upsert({ where: { key: connectionKey }, create: { key: connectionKey, value }, update: { value } });
    await tx.setting.deleteMany({ where: { key: accessKey } });
  });
  return githubConnectionView();
}
export async function disconnectGithub() {
  await prisma.$transaction(async (tx) => { await lockForTransaction(tx, lock); await tx.setting.deleteMany({ where: { key: { in: [connectionKey, accessKey] } } }); });
  return githubConnectionView();
}
export async function listConnectedRepositories(page: number) {
  const connection = await githubConnection();
  if (!connection) throw new ActionError("Connect GitHub first.");
  const response = await githubRead(`/user/repos?sort=updated&per_page=30&page=${page}&affiliation=owner,collaborator,organization_member`, { token: connection.token });
  return z.array(z.object({ full_name: githubRepositoryName, description: z.string().nullable(), fork: z.boolean(), private: z.boolean() })).parse(JSON.parse(response.text)).map((row) => ({ name: row.full_name, description: (row.description ?? "").slice(0, 500), fork: row.fork, private: row.private }));
}
export async function allowGithubRepository(name: string) {
  githubRepositoryName.parse(name);
  const connection = await githubConnection();
  if (!connection) throw new ActionError("Connect GitHub first.");
  const response = await githubRead(`/repos/${name.split("/").map(encodeURIComponent).join("/")}`, { token: connection.token });
  const repo = z.object({ id: z.number().int().positive(), full_name: githubRepositoryName, private: z.boolean() }).parse(JSON.parse(response.text));
  if (repo.full_name.toLowerCase() !== name.toLowerCase()) throw new ActionError("The repository name changed. Refresh the GitHub repository list.");
  await prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, lock);
    const current = await tx.setting.findUnique({ where: { key: connectionKey } });
    if (!current || connectionSchema.parse(JSON.parse(decryptSecret(GITHUB_CONNECTION, current.value))).revision !== connection.revision) throw new ActionError("The GitHub connection changed. Select this repository again.");
    const row = await tx.setting.findUnique({ where: { key: accessKey } });
    const selected = row ? githubAccessSchema.parse(JSON.parse(row.value)) : [];
    const next = githubAccessSchema.parse([...selected.filter((r) => r.id !== repo.id), { id: repo.id, name: repo.full_name, private: repo.private }]);
    const value = JSON.stringify(next);
    await tx.setting.upsert({ where: { key: accessKey }, create: { key: accessKey, value }, update: { value } });
  });
  return githubConnectionView();
}
export async function removeGithubRepository(name: string) {
  await prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, lock);
    const row = await tx.setting.findUnique({ where: { key: accessKey } });
    if (!row) return;
    await tx.setting.update({ where: { key: accessKey }, data: { value: JSON.stringify(githubAccessSchema.parse(JSON.parse(row.value)).filter((r) => r.name.toLowerCase() !== name.toLowerCase())) } });
  });
  return githubConnectionView();
}
export async function githubAccessFor(name: string) {
  const selected = (await selectedRepositories()).find((r) => r.name.toLowerCase() === name.toLowerCase());
  if (!selected) return null;
  const connection = await githubConnection();
  if (!connection) throw new ActionError("Reconnect GitHub and allow this repository again.");
  return { ...connection, repository: selected };
}
export async function checkPrivateRepositoryAccess(context: { visibility?: string; name: string; connectionRevision?: string }) {
  if (context.visibility !== "private") return;
  const access = await githubAccessFor(context.name);
  if (!access || access.revision !== context.connectionRevision) throw new ActionError("Private repository access changed. Allow the repository and preview its documentation again. Saved conversations remain private.");
}
