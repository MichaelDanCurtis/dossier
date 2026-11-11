import "server-only";
import { z } from "zod";
import { ActionError } from "@/lib/action";

export const bridgeJob = z.object({ url: z.url().max(2000), title: z.string().min(1).max(500), company: z.string().min(1).max(300), place: z.string().max(300), text: z.string().min(80).max(100000), remote: z.boolean(), salary: z.string().max(300), collectedAt: z.iso.datetime() });
export const bridgeStatusSchema = z.object({ running: z.boolean(), manual: z.boolean(), message: z.string().max(1000), dayPages: z.number(), nextRunAt: z.number(), jobs: z.array(bridgeJob).max(40), limits: z.object({ intervalMs: z.number(), runJobs: z.number(), dayPages: z.number(), cooldownMs: z.number(), manualMs: z.number() }) });
export type BridgeStatus = z.infer<typeof bridgeStatusSchema>;
export const bridgeConfigured = () => !!process.env.LINKEDIN_BRIDGE_URL && !!process.env.LINKEDIN_BRIDGE_TOKEN;
export async function bridgeRequest(endpoint: string, input?: unknown) {
  const base = process.env.LINKEDIN_BRIDGE_URL, token = process.env.LINKEDIN_BRIDGE_TOKEN;
  if (!base || !token) throw new ActionError("The browser bridge is not installed for this workspace.");
  try {
    const response = await fetch(new URL(endpoint, base), { method: input === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: input === undefined ? undefined : JSON.stringify(input), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(45000) });
    const result = await response.json();
    if (!response.ok) throw new ActionError(typeof result.error === "string" ? result.error : "The browser bridge refused this operation.");
    return result;
  } catch (error) { if (error instanceof ActionError) throw error; throw new ActionError("The browser bridge is unavailable. Try reconnecting shortly."); }
}
