import { afterAll, describe, expect, it, vi } from "vitest";
import { resolveAiConfig } from "@/lib/ai/config";
import { recordHash } from "@/lib/record-hash";
const fake = vi.hoisted(() => ({
  config: { provider: "OPENAI", baseUrl: "https://api.example.com/v1", model: "app-model", apiKey: "fixture-key", apiKeyProblem: null, timeoutMs: 15000 },
  fetch: vi.fn(), usage: vi.fn(),
}));
vi.mock("@/lib/ai/config", () => ({ loadAiConfig: async () => fake.config, resolveAiConfig: vi.fn() }));
vi.mock("@/lib/usage-data", () => ({ recordUsage: fake.usage }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: async () => ({ aiTimeoutSeconds: 900, aiConnections: [{ provider: "ANTHROPIC", baseUrl: "https://api.anthropic.com", model: "writer-model", apiKeyEnc: "fixture-encrypted-key" }] }) }));
import { publicistProvider, publicistConfig } from "./publicist-provider";
import { publicistPreferences } from "./schema";
afterAll(() => vi.unstubAllGlobals());
describe("agent-specific model and effort", () => {
  it("sends the chosen model/effort without changing the app default", async () => {
    vi.stubGlobal("fetch", fake.fetch);
    fake.fetch.mockResolvedValue(Response.json({ model: "favorite-model", choices: [{ message: { role: "assistant", content: "Let’s explore an angle." }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 15 } }));
    const provider = await publicistProvider(publicistPreferences.parse({ model: "favorite-model", effort: "high" }));
    expect(await provider.complete({ task: "publicist-chat", system: "Help brainstorm.", messages: [{ role: "user", content: "What should we write?" }], maxTokens: 100, effort: "high" })).toBe("Let’s explore an angle.");
    const request = fake.fetch.mock.calls[0];
    const body = JSON.parse(request[1].body);
    expect(body).toMatchObject({ model: "favorite-model", reasoning_effort: "high" });
    expect(fake.config.model).toBe("app-model");
  });
});

it("applies the saved AI timeout when the Publicist uses another remembered connection", async () => {
  await publicistConfig(recordHash("ANTHROPIC https://api.anthropic.com"));
  expect(resolveAiConfig).toHaveBeenCalledWith(expect.objectContaining({ provider: "ANTHROPIC", model: "writer-model", aiTimeoutSeconds: 900 }), expect.any(Object));
});
