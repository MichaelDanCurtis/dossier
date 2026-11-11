import "server-only";
import { ActionError } from "@/lib/action";
import { createProvider, getAiProvider } from "@/lib/ai";
import { loadAiConfig, resolveAiConfig } from "@/lib/ai/config";
import { providerOption } from "@/lib/ai/provider-options";
import { OpenAICompatibleProvider } from "@/lib/ai/providers/openai-compatible";
import type { ChatCall } from "@/lib/ai/provider";
import { env } from "@/lib/env";
import { recordHash } from "@/lib/record-hash";
import { loadSettings } from "@/lib/settings-data";
import { recordUsage } from "@/lib/usage-data";
import type { PublicistPreferences } from "./schema";

import { imageProvider } from "./image-provider";
export { imageProvider } from "./image-provider";

const connectionId = (value: { provider: string; baseUrl: string }) => recordHash(value.provider + " " + value.baseUrl.replace(/\/+$/, ""));

export async function publicistConnections() {
  const [settings, active] = await Promise.all([loadSettings(), loadAiConfig()]);
  const map = new Map(settings.aiConnections.map((item) => [connectionId(item), { ...item, active: false }]));
  map.set(connectionId(active), { provider: active.provider, baseUrl: active.baseUrl, model: active.model ?? "", apiKeyEnc: settings.apiKeyEnc, active: true });
  return [...map.values()].map((item) => ({
    id: connectionId(item), label: providerOption(item.provider, item.baseUrl).name + (item.active ? " · app default" : ""),
    model: item.model, isDefault: item.active, imageCapable: !!imageProvider(item),
  }));
}

export async function publicistConfig(id: string) {
  const active = await loadAiConfig();
  if (!id || id === connectionId(active)) return active;
  const saved = (await loadSettings()).aiConnections.find((item) => connectionId(item) === id);
  if (!saved) throw new ActionError("This saved AI connection is unavailable. Choose another in Publicist settings.");
  return resolveAiConfig(saved, env);
}

class PublicistCompatibleProvider extends OpenAICompatibleProvider {
  protected override reasoningEffort(call: ChatCall) { return call.effort; }
}

export async function publicistProvider(preferences: PublicistPreferences) {
  if (!preferences.connectionId && !preferences.model && preferences.effort === "default") return getAiProvider();
  const selected = await publicistConfig(preferences.connectionId);
  if (selected.apiKeyProblem) throw new ActionError(selected.apiKeyProblem);
  const config = { ...selected, model: preferences.model || selected.model };
  // Apply effort for this agent only. Providers that reject it use the existing
  // compatibility fallback; Anthropic discovers supported effort levels itself.
  if (config.provider === "OPENAI") return new PublicistCompatibleProvider("OPENAI", config.baseUrl, config.apiKey, config.model, config.timeoutMs, recordUsage);
  return createProvider(config);
}
