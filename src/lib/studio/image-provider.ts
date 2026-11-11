/** Exact configured endpoints: a compatible chat URL is not an image API. */
export function imageProvider(config: { provider: string; baseUrl: string }) {
  if (config.provider !== "OPENAI") return null;
  const base = config.baseUrl.replace(/\/+$/, "");
  if (base === "https://api.openai.com/v1") return "openai" as const;
  if (base === "https://openrouter.ai/api/v1") return "openrouter" as const;
  return null;
}
