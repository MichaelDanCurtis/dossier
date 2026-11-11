import { z } from "zod";

export const githubRepositoryName = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/, "Use owner/repository.").refine((name) => ![".", ".."].includes(name.split("/")[1]), "Use a repository name.");
export const githubTokenSchema = z.string().trim().regex(/^github_pat_[A-Za-z0-9_]{20,245}$/, "Use a fine-grained GitHub token (github_pat_…), restricted to selected repositories with Contents: read-only.");
export const githubAccessSchema = z.array(z.object({ name: githubRepositoryName, id: z.number().int().positive(), private: z.boolean() })).max(30);
export type GithubRepositoryAccess = z.infer<typeof githubAccessSchema>[number];
export type GithubConnectionView = { state: "none" | "connected" | "unreadable"; login: string; expiresAt: string; repositories: GithubRepositoryAccess[] };

/** Documentation can contain pasted credentials too. Redact common token forms before preview/storage/AI. */
export function redactRepositorySecrets(text: string): string {
  return text.replace(/(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})/g, "[credential redacted]").replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[private key redacted]");
}
