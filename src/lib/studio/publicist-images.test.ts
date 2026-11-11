import { beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ config: vi.fn(), usage: vi.fn(), fetch: vi.fn() }));
vi.mock("./publicist-provider", () => ({ publicistConfig: fake.config }));
vi.mock("@/lib/usage-data", () => ({ recordUsage: fake.usage }));
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(32) } }));
import { generatePublicistImage, publicistImageInput } from "./publicist-images";
import { publicistPreferences } from "./schema";
const preferences = publicistPreferences.parse({ imageConnectionId: "saved-connection", imageModel: "gpt-image-fixture" });
const input = { prompt: "A clear diagram of an automation workflow.", quality: "low" as const, expectedConnectionId: "saved-connection", expectedModel: "gpt-image-fixture", approved: true as const };
beforeEach(() => { vi.stubGlobal("fetch", fake.fetch); fake.fetch.mockReset(); fake.usage.mockReset(); fake.config.mockResolvedValue({ provider: "OPENAI", baseUrl: "https://api.openai.com/v1", apiKey: "fixture-key", apiKeyProblem: null }); });
describe("explicit Publicist image requests", () => {
  it("requires approval and the reviewed connection/model", async () => {
    expect(publicistImageInput.safeParse({ ...input, approved: false }).success).toBe(false);
    await expect(generatePublicistImage(preferences, { ...input, expectedModel: "another-model" })).rejects.toThrow("settings changed");
    expect(fake.fetch).not.toHaveBeenCalled();
  });
  it("makes one fixed-endpoint request and returns a validated PNG", async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    fake.fetch.mockResolvedValue(Response.json({ data: [{ b64_json: png.toString("base64") }] }));
    expect(await generatePublicistImage(preferences, input)).toEqual(png);
    expect(fake.fetch).toHaveBeenCalledTimes(1);
    expect(fake.fetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/images/generations");
    expect(JSON.parse(fake.fetch.mock.calls[0][1].body)).toMatchObject({ n: 1, model: "gpt-image-fixture", quality: "low" });
  });
  it("does not retry an ambiguous image request", async () => {
    fake.fetch.mockRejectedValue(new Error("network lost"));
    await expect(generatePublicistImage(preferences, input)).rejects.toThrow("network lost");
    expect(fake.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("OpenRouter image routing", () => {
  const prefs = publicistPreferences.parse({ imageConnectionId: "router", imageModel: "vendor/image-model" });
  const request = { ...input, expectedConnectionId: "router", expectedModel: "vendor/image-model" };
  it("discovers image output and sends the key only to OpenRouter's image API", async () => {
    fake.config.mockResolvedValue({ provider: "OPENAI", baseUrl: "https://openrouter.ai/api/v1", apiKey: "router-key" });
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    fake.fetch.mockResolvedValueOnce(Response.json({ data: [{ id: "vendor/image-model", architecture: { output_modalities: ["image"] } }] })).mockResolvedValueOnce(Response.json({ data: [{ b64_json: png.toString("base64") }] }));
    expect(await generatePublicistImage(prefs, request)).toEqual(png);
    expect(fake.fetch.mock.calls.map((call) => call[0])).toEqual(["https://openrouter.ai/api/v1/images/models", "https://openrouter.ai/api/v1/images"]);
    const [, options] = fake.fetch.mock.calls[1];
    expect(options.headers.authorization).toBe("Bearer router-key");
    expect(JSON.parse(options.body)).toMatchObject({ model: "vendor/image-model", n: 1, provider: { allow_fallbacks: false } });
  });
  it("does not buy an image from a text-only model", async () => {
    fake.config.mockResolvedValue({ provider: "OPENAI", baseUrl: "https://openrouter.ai/api/v1", apiKey: "router-key" });
    fake.fetch.mockResolvedValue(Response.json({ data: [{ id: "vendor/image-model", architecture: { output_modalities: ["text"] } }] }));
    await expect(generatePublicistImage(prefs, request)).rejects.toThrow("image-generation model");
    expect(fake.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["https://openrouter.ai.evil.test/api/v1", "https://openrouter.ai/other", "https://api.openai.com/v1/other"])("refuses an unrecognized endpoint %s before sending any key", async (baseUrl) => {
    fake.config.mockResolvedValue({ provider: "OPENAI", baseUrl, apiKey: "private-key" });
    await expect(generatePublicistImage(prefs, request)).rejects.toThrow("Choose a saved"); expect(fake.fetch).not.toHaveBeenCalled();
  });
  it("rejects a non-image response without fetching URLs", async () => {
    fake.fetch.mockResolvedValue(Response.json({ data: [{ b64_json: Buffer.from('<svg onload="evil()"/>').toString('base64') }] }));
    await expect(generatePublicistImage(preferences, input)).rejects.toThrow("supported PNG"); expect(fake.fetch).toHaveBeenCalledTimes(1);
  });
});
