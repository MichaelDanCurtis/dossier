import "server-only";

import { z } from "zod";
import { ActionError } from "@/lib/action";
import { prisma } from "@/lib/prisma";
import { publicistProvider } from "@/lib/studio/publicist-provider";
import { publicistPreferences } from "@/lib/studio/schema";

export const repositorySettingsSchema = z.object({ connectionId: z.string().max(100), model: z.string().trim().max(200) });
export const repositoryName = z.string().trim().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/, "Use owner/repository, for example octocat/Hello-World.");
const settingsKey = "repositoryDiscovery";
export async function repositorySettings() {
  const row = await prisma.setting.findUnique({ where: { key: settingsKey } });
  const result = repositorySettingsSchema.safeParse(row ? JSON.parse(row.value) : {});
  return result.success ? result.data : { connectionId: "", model: "" };
}
export async function saveRepositorySettings(input: z.infer<typeof repositorySettingsSchema>) {
  await prisma.setting.upsert({ where: { key: settingsKey }, create: { key: settingsKey, value: JSON.stringify(input) }, update: { value: JSON.stringify(input) } });
}
export async function repositoryProvider() {
  const settings = await repositorySettings();
  if (!settings.model) throw new ActionError("Choose a low-cost model in Career → Repositories before asking for analysis.");
  return publicistProvider(publicistPreferences.parse({ ...settings, effort: "low" }));
}

/** Fixed GitHub API origin, no redirects, credentials, clone, or source execution. */
async function github(path: string, raw = false, optional = false): Promise<string> {
  const response = await fetch(`https://api.github.com${path}`, { headers: { Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, redirect: "error", signal: AbortSignal.timeout(12000), cache: "no-store" });
  if (!response.ok) {
    await response.body?.cancel();
    if (optional && response.status === 404) return "";
    throw new ActionError(response.status === 404 ? "This public repository was not found. For private work, use a selected documentation excerpt." : response.status === 403 || response.status === 429 ? "GitHub’s public API limit was reached. Try again later; no analysis was charged." : `GitHub could not provide this repository (HTTP ${response.status}).`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ActionError("GitHub returned no readable content.");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 256000) throw new ActionError("This GitHub document is too large. Use a selected excerpt instead."); chunks.push(value); }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString("utf8");
}
export async function listPublicRepositories(owner: string, page: number) {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner)) throw new ActionError("Enter a GitHub username.");
  const rows = JSON.parse(await github(`/users/${encodeURIComponent(owner)}/repos?sort=updated&per_page=30&page=${page}`)) as { full_name: string; description: string | null; fork: boolean }[];
  return rows.map((row) => ({ name: row.full_name, description: (row.description ?? "").slice(0, 500), fork: row.fork }));
}
export const repositoryContextSchema = z.object({
  version: z.literal(1), capturedAt: z.iso.datetime(), name: z.string().max(150), url: z.string().max(2000), privateExcerpt: z.boolean(),
  commit: z.string().max(100), fork: z.boolean(), parent: z.string().max(150),
  description: z.string().max(1000), language: z.string().max(100), readme: z.string().max(16000),
});
export type RepositoryContext = z.infer<typeof repositoryContextSchema>;

export async function readPublicRepository(name: string): Promise<RepositoryContext> {
  repositoryName.parse(name);
  const path = `/repos/${name.split("/").map(encodeURIComponent).join("/")}`;
  const meta = JSON.parse(await github(path)) as { full_name: string; description: string | null; language: string | null; fork: boolean; parent?: { full_name: string }; default_branch: string };
  const branch = JSON.parse(await github(`${path}/branches/${encodeURIComponent(meta.default_branch)}`)) as { commit: { sha: string } };
  const readme = await github(`${path}/readme?ref=${encodeURIComponent(branch.commit.sha)}`, true, true);
  return repositoryContextSchema.parse({ version: 1, capturedAt: new Date().toISOString(), name: meta.full_name, url: `https://github.com/${meta.full_name}`, privateExcerpt: false, commit: branch.commit.sha, fork: meta.fork, parent: meta.parent?.full_name ?? "", description: (meta.description ?? "").slice(0, 1000), language: meta.language ?? "", readme: readme.slice(0, 16000) });
}

export async function createRepositorySession(context: RepositoryContext) {
  // Require an explicitly selected model before storing a queued generation.
  await repositoryProvider();
  return prisma.$transaction(async (tx) => {
    const session = await tx.careerSession.create({ data: { kind: "REPOSITORY", title: `Repository · ${context.name}`.slice(0, 200), contextJson: JSON.stringify(context),
      messages: { create: { ordinal: 0, role: "assistant", origin: "LOCAL", text: `I’ll read the selected ${context.privateExcerpt ? "documentation excerpt" : "public README and metadata"} for ${context.name}. Repository capabilities are observations, not proof of your personal contribution. We’ll discuss that before proposing a project. Nothing will be published.` } } } });
    const message = await tx.careerMessage.create({ data: { sessionId: session.id, ordinal: 1, role: "user", origin: "REPOSITORY_REQUEST", text: "Summarize this repository and ask about my personal contribution." } });
    const job = await tx.job.create({ data: { type: "career-turn", key: `career:${session.id}`, input: { sessionId: session.id, messageId: message.id, finishing: false } } });
    await tx.careerMessage.update({ where: { id: message.id }, data: { jobId: job.id } });
    return { id: session.id, jobId: job.id };
  });
}
