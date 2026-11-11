import "server-only";

import { z } from "zod";
import { ActionError } from "@/lib/action";
import { prisma } from "@/lib/prisma";
import { publicistProvider } from "@/lib/studio/publicist-provider";
import { publicistPreferences } from "@/lib/studio/schema";
import { githubRead, githubAccessFor, checkPrivateRepositoryAccess } from "./github";
import { githubRepositoryName, redactRepositorySecrets } from "./github-schema";

export const repositorySettingsSchema = z.object({ connectionId: z.string().max(100), model: z.string().trim().max(200) });
export const repositoryName = githubRepositoryName;
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

async function github(path: string, raw = false, optional = false) {
  return (await githubRead(path, { raw, optional })).text;
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
  visibility: z.enum(["public", "private", "excerpt"]).optional(), connectionRevision: z.string().max(100).optional(), documents: z.array(z.string().max(150)).max(3).optional(),
});
export type RepositoryContext = z.infer<typeof repositoryContextSchema>;

export async function readPublicRepository(name: string): Promise<RepositoryContext> {
  return readRepositorySnapshot(name, null, false);
}
export async function readRepository(name: string, includeDocs = false): Promise<RepositoryContext> {
  repositoryName.parse(name);
  return readRepositorySnapshot(name, await githubAccessFor(name), includeDocs);
}
async function readRepositorySnapshot(name: string, access: Awaited<ReturnType<typeof githubAccessFor>>, includeDocs: boolean): Promise<RepositoryContext> {
  repositoryName.parse(name);
  const path = `/repos/${name.split("/").map(encodeURIComponent).join("/")}`;
  const read = async (suffix: string, raw = false, optional = false) => (await githubRead(path + suffix, { token: access?.token, raw, optional })).text;
  const meta = JSON.parse(await read("")) as { id?: number; full_name: string; description: string | null; language: string | null; private?: boolean; fork: boolean; parent?: { full_name: string }; default_branch: string };
  if (meta.private && !access) throw new ActionError("Allow this private repository in Career → Repositories before reading it.");
  if (access && meta.id !== access.repository.id) throw new ActionError("This repository's identity changed. Remove it and allow it again.");
  const branch = JSON.parse(await read(`/branches/${encodeURIComponent(meta.default_branch)}`)) as { commit: { sha: string } };
  const ref = encodeURIComponent(branch.commit.sha);
  const readme = await read(`/readme?ref=${ref}`, true, true);
  const docs = [{ name: "README", text: readme.slice(0, includeDocs ? 9500 : 16000) }];
  if (includeDocs) for (const file of ["ARCHITECTURE.md", "docs/architecture.md"]) {
    const text = await read(`/contents/${file}?ref=${ref}`, true, true);
    if (text) docs.push({ name: file, text: text.slice(0, 3000) });
  }
  return repositoryContextSchema.parse({ version: 1, capturedAt: new Date().toISOString(), name: meta.full_name, url: `https://github.com/${meta.full_name}`, privateExcerpt: false, commit: branch.commit.sha, fork: meta.fork, parent: meta.parent?.full_name ?? "", description: redactRepositorySecrets((meta.description ?? "").slice(0, 1000)), language: meta.language ?? "", readme: redactRepositorySecrets(docs.map((d) => `Source: ${d.name}\n${d.text}`).join("\n\n").slice(0, 16000)), visibility: meta.private ? "private" : "public", connectionRevision: meta.private ? access?.revision : undefined, documents: docs.map((d) => d.name) });
}

export async function createRepositorySession(context: RepositoryContext) {
  await checkPrivateRepositoryAccess(context);
  context = { ...context, readme: redactRepositorySecrets(context.readme) };
  // Require an explicitly selected model before storing a queued generation.
  await repositoryProvider();
  return prisma.$transaction(async (tx) => {
    const session = await tx.careerSession.create({ data: { kind: "REPOSITORY", title: `Repository · ${context.name}`.slice(0, 200), contextJson: JSON.stringify(context),
      messages: { create: { ordinal: 0, role: "assistant", origin: "LOCAL", text: `I’ll read the selected ${context.privateExcerpt ? "documentation excerpt" : context.visibility === "private" ? "private GitHub documentation and metadata" : "public README and metadata"} for ${context.name}. Repository capabilities are observations, not proof of your personal contribution. We’ll discuss that before proposing a project. Nothing will be published.` } } } });
    const message = await tx.careerMessage.create({ data: { sessionId: session.id, ordinal: 1, role: "user", origin: "REPOSITORY_REQUEST", text: "Summarize this repository and ask about my personal contribution." } });
    const job = await tx.job.create({ data: { type: "career-turn", key: `career:${session.id}`, input: { sessionId: session.id, messageId: message.id, finishing: false } } });
    await tx.careerMessage.update({ where: { id: message.id }, data: { jobId: job.id } });
    return { id: session.id, jobId: job.id };
  });
}
