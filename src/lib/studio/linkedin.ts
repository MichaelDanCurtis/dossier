import "server-only";

import { randomBytes } from "node:crypto";
import { z } from "zod";

import { lockForTransaction } from "@/lib/db-lock";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { recordHash } from "@/lib/record-hash";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

import { STUDIO_LOCK } from "./data";
import { linkedinKeys } from "./schema";

const [appIdKey, secretKey, connectionKey] = linkedinKeys;
export const linkedinAttemptKey = "linkedInOAuthAttempt";
export const linkedinStateCookie = "careerai_linkedin_state";
const secretKind = { purpose: "linkedin-encryption", associatedData: "careerai linkedin oauth client secret v1" } as const;
const tokenKind = { purpose: "linkedin-encryption", associatedData: "careerai linkedin publishing connection v1" } as const;
const connectionSchema = z.object({ accessToken: z.string().min(1).max(8000), sub: z.string().regex(/^[\w-]{1,200}$/), name: z.string().max(200), expiresAt: z.number() });
const callback = (origin: string) => `${origin}/api/linkedin/callback`;
const api = { auth: "https://www.linkedin.com/oauth/v2/authorization", token: "https://www.linkedin.com/oauth/v2/accessToken", user: "https://api.linkedin.com/v2/userinfo", publish: "https://api.linkedin.com/v2/ugcPosts" };

async function connection(db: Prisma.TransactionClient = prisma) {
  const row = await db.setting.findUnique({ where: { key: connectionKey } });
  if (!row) return null;
  try { return { ...connectionSchema.parse(JSON.parse(decryptSecret(tokenKind, row.value))), connectionId: recordHash(row.value) }; } catch { return null; }
}
export async function linkedinConnectionView() {
  const [credentials, account] = await Promise.all([prisma.setting.count({ where: { key: { in: [appIdKey, secretKey] } } }), connection()]);
  return { configured: credentials === 2, connected: !!account && account.expiresAt > Date.now(), name: account?.name ?? "", expiresAt: account?.expiresAt ?? null, connectionId: account?.connectionId ?? null };
}
export async function setLinkedinApp(appId: string, secret: string) {
  await prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, STUDIO_LOCK);
    const current = await tx.setting.findUnique({ where: { key: appIdKey } });
    if ((!current || current.value !== appId) && !secret) throw new Error("Enter the new app's client secret.");
    for (const [key, value] of [[appIdKey, appId], ...(secret ? [[secretKey, encryptSecret(secretKind, secret)]] : [])]) {
      await tx.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    }
    if (secret || current?.value !== appId) await tx.setting.deleteMany({ where: { key: { in: [connectionKey, linkedinAttemptKey] } } });
  });
}
export async function forgetLinkedinConnection() {
  await prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, STUDIO_LOCK);
    await tx.setting.deleteMany({ where: { key: { in: [connectionKey, linkedinAttemptKey] } } });
  });
}

export async function beginLinkedin(origin: string) {
  const state = randomBytes(32).toString("base64url");
  const clientId = await prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, STUDIO_LOCK);
    const rows = await tx.setting.findMany({ where: { key: { in: [appIdKey, secretKey] } } });
    const id = rows.find((row) => row.key === appIdKey)?.value;
    if (!id || !rows.some((row) => row.key === secretKey)) throw new Error("Configure the LinkedIn app first.");
    const value = JSON.stringify({ hash: recordHash(state), expiresAt: Date.now() + 600000, used: false });
    await tx.setting.upsert({ where: { key: linkedinAttemptKey }, create: { key: linkedinAttemptKey, value }, update: { value } });
    return id;
  });
  const url = new URL(api.auth);
  url.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: callback(origin), state, scope: "openid profile w_member_social" }).toString();
  return { url, state };
}

export async function completeLinkedin(origin: string, state: string, code: string) {
  const { clientId, secret, claimed } = await prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, STUDIO_LOCK);
    const rows = await tx.setting.findMany({ where: { key: { in: [appIdKey, secretKey, linkedinAttemptKey] } } });
    const clientId = rows.find((row) => row.key === appIdKey)?.value;
    const encrypted = rows.find((row) => row.key === secretKey)?.value;
    const attempt = JSON.parse(rows.find((row) => row.key === linkedinAttemptKey)?.value ?? "null");
    if (!attempt || attempt.used || attempt.expiresAt <= Date.now() || attempt.hash !== recordHash(state) || !clientId || !encrypted) throw new Error("The sign-in expired.");
    const claimed = JSON.stringify({ ...attempt, used: true });
    await tx.setting.update({ where: { key: linkedinAttemptKey }, data: { value: claimed } });
    return { clientId, secret: decryptSecret(secretKind, encrypted), claimed };
  });
  const tokenReply = await fetch(api.token, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000), headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callback(origin), client_id: clientId, client_secret: secret }) });
  if (!tokenReply.ok) throw new Error("LinkedIn refused the connection.");
  const token = z.object({ access_token: z.string().min(1).max(8000), expires_in: z.number().int().positive().max(31536000), scope: z.string().optional() }).parse(await tokenReply.json());
  if (token.scope && !token.scope.split(/[ ,]+/).includes("w_member_social")) throw new Error("The publishing scope was not granted.");
  const userReply = await fetch(api.user, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000), headers: { authorization: `Bearer ${token.access_token}` } });
  if (!userReply.ok) throw new Error("LinkedIn did not return a member identity.");
  const { sub, name } = z.object({ sub: z.string().regex(/^[\w-]{1,200}$/), name: z.string().max(200).default("LinkedIn member") }).parse(await userReply.json());
  const value = encryptSecret(tokenKind, JSON.stringify({ accessToken: token.access_token, sub, name, expiresAt: Date.now() + 1000 * token.expires_in }));
  await prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, STUDIO_LOCK);
    if (!(await tx.setting.deleteMany({ where: { key: linkedinAttemptKey, value: claimed } })).count) throw new Error("The connection attempt was replaced.");
    await tx.setting.upsert({ where: { key: connectionKey }, create: { key: connectionKey, value }, update: { value } });
  });
}

export async function linkedinPublishingAccount(db: Prisma.TransactionClient = prisma) {
  const account = await connection(db);
  return account && account.expiresAt > Date.now() ? account : null;
}

/** One approved request. Network/5xx failures are ambiguous; never retry automatically. */
export async function sendLinkedinPost(account: NonNullable<Awaited<ReturnType<typeof linkedinPublishingAccount>>>, body: string) {
  if (!body.trim() || body.length > 3000) throw new Error("LinkedIn text posts must be between 1 and 3,000 characters.");
  try {
    const response = await fetch(api.publish, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${account.accessToken}`, "content-type": "application/json", "x-restli-protocol-version": "2.0.0" },
      body: JSON.stringify({
        author: `urn:li:person:${account.sub}`, lifecycleState: "PUBLISHED",
        specificContent: { "com.linkedin.ugc.ShareContent": { shareCommentary: { text: body }, shareMediaCategory: "NONE" } },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
      }),
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 201) return { status: "PUBLISHED" as const, postUrn: response.headers.get("x-restli-id")?.slice(0, 300) };
    if ([400, 401, 403, 422, 429].includes(response.status)) return { status: "DRAFT" as const };
  } catch { /* Do not retry when delivery cannot be determined. */ }
  return { status: "CHECK_LINKEDIN" as const };
}
