import "server-only";
import { z } from "zod";
import { publicistConfig } from "./publicist-provider";
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
  if (input.expectedConnectionId !== preferences.imageConnectionId || input.expectedModel !== preferences.imageModel) throw new Error("Image settings changed. Save and review them before generating.");
  const config = await publicistConfig(preferences.imageConnectionId);
  if (config.provider !== "OPENAI" || new URL(config.baseUrl).origin !== "https://api.openai.com" || !config.apiKey || config.apiKeyProblem) throw new Error("Choose a saved OpenAI connection with a working API key.");
  if (!/^gpt-image-[a-z0-9.-]+$/i.test(preferences.imageModel)) throw new Error("Choose a GPT Image model from your provider's model list.");
  // One explicit paid request; no SDK retries and no arbitrary image URLs.
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(120000),
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: preferences.imageModel, prompt: input.prompt, n: 1, size: "1024x1024", quality: input.quality, output_format: "png", safety_identifier: recordHash("publicist:" + env.DOSSIER_SECRET) }),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`OpenAI refused image generation (HTTP ${response.status}). Check model access and billing in your OpenAI account.`); }
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
  if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("The image provider did not return a PNG.");
  await recordUsage({ task: "publicist-image", provider: "OPENAI", model: preferences.imageModel, input: null, output: null });
  return image;
}
