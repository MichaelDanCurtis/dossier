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
