import "server-only";
import { z } from "zod";
import { publicistConfig } from "./publicist-provider";
import { imageProvider } from "./image-provider";
import type { PublicistPreferences } from "./schema";
import { recordUsage } from "@/lib/usage-data";
import { recordHash } from "@/lib/record-hash";
import { env } from "@/lib/env";

export const publicistImageInput = z.object({
  prompt: z.string().trim().min(10).max(4000), quality: z.enum(["low", "medium", "high"]),
  expectedConnectionId: z.string().min(1).max(100), expectedModel: z.string().min(1).max(200),
  approved: z.literal(true),
});

export async function generatePublicistImage(preferences: PublicistPreferences, input: z.infer<typeof publicistImageInput>) {
  input = publicistImageInput.parse(input);
  if (input.expectedConnectionId !== preferences.imageConnectionId || input.expectedModel !== preferences.imageModel) throw new Error("Image settings changed. Save and review them before generating.");
  const config = await publicistConfig(preferences.imageConnectionId);
  const provider = imageProvider(config);
  if (!provider || !config.apiKey || config.apiKeyProblem) throw new Error("Choose a saved OpenAI or OpenRouter connection with a working API key.");
  if (provider === "openai" && !/^gpt-image-[a-z0-9.-]+$/i.test(preferences.imageModel)) throw new Error("Choose a GPT Image model from your provider's model list.");
  if (provider === "openrouter" && !(await listPublicistImageModels(preferences.imageConnectionId)).includes(preferences.imageModel)) throw new Error("Choose an image-generation model available from OpenRouter.");
  // One explicit paid request; no SDK retries and no arbitrary image URLs.
  const response = await fetch(provider === "openrouter" ? "https://openrouter.ai/api/v1/images" : "https://api.openai.com/v1/images/generations", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(120000),
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: preferences.imageModel, prompt: input.prompt, n: 1, quality: input.quality, output_format: "png", ...(provider === "openai" ? { size: "1024x1024", safety_identifier: recordHash("publicist:" + env.DOSSIER_SECRET) } : { provider: { allow_fallbacks: false } }) }),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`The image provider refused generation (HTTP ${response.status}). Check model access and billing in the selected provider account.`); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The image provider returned no image.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 20 * 1024 * 1024) throw new Error("The generated image exceeds the download limit.");
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const result = z.object({ data: z.array(z.object({ b64_json: z.string().min(1) })).min(1) }).parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  const image = Buffer.from(result.data[0].b64_json, "base64");
  imageFormat(image);
  await recordUsage({ task: "publicist-image", provider: "OPENAI", model: preferences.imageModel, input: null, output: null });
  return image;
}

/** Only inert raster formats; never fetch a provider-supplied URL or render SVG. */
export function imageFormat(image: Buffer) {
  if (image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (image[0] === 255 && image[1] === 216 && image[2] === 255) return "jpeg";
  if (image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP") return "webp";
  throw new Error("The image provider did not return a supported PNG, JPEG or WebP image.");
}

export async function listPublicistImageModels(connectionId: string): Promise<string[]> {
  const config = await publicistConfig(connectionId);
  const provider = imageProvider(config);
  if (!provider || !config.apiKey || config.apiKeyProblem) throw new Error("Choose a saved OpenAI or OpenRouter image connection with a working API key.");
  const response = await fetch(provider === "openrouter" ? "https://openrouter.ai/api/v1/images/models" : "https://api.openai.com/v1/models", {
    headers: { authorization: `Bearer ${config.apiKey}` }, redirect: "error", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error("The image provider could not list available image models."); }
  const result = z.object({ data: z.array(z.object({ id: z.string().max(200), architecture: z.object({ output_modalities: z.array(z.string()) }).optional() })).max(10000) }).parse(await response.json());
  return result.data.filter((model) => provider === "openai" ? /^gpt-image-/i.test(model.id) : model.architecture?.output_modalities.includes("image")).map((model) => model.id).sort();
}
