import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AiError, toAiError } from "../errors";
import { withAiRequestBudget } from "../request-budget";

import { AnthropicProvider } from "./anthropic";
import { OllamaProvider } from "./ollama";
import { OpenAICompatibleProvider } from "./openai-compatible";
import { timedFetch } from "./timed-fetch";

// The real timedFetch, which src/test/setup-ai-fetch.ts swaps for the global fetch elsewhere.
vi.unmock("@/lib/ai/providers/timed-fetch");

/** What each SDK expects back, after `delay` ms without a word: the headers come with the answer, as for a call that doesn't stream. */
const ANSWERS: Record<string, unknown> = {
  "/v1/chat/completions": { id: "c", object: "chat.completion", created: 0, model: "m", choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }] },
  "/v1/messages": { id: "msg", type: "message", role: "assistant", model: "m", content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } },
  "/api/chat": { model: "m", created_at: "2026-11-13T00:00:00Z", message: { role: "assistant", content: "OK" }, done: true, done_reason: "stop", prompt_eval_count: 1, eval_count: 1 },
};

const requests: { path: string; body: Record<string, unknown> }[] = [];
let delay = 0;
let address = "";
const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  let body = "";
  request.on("data", chunk => { body += chunk; });
  request.on("end", () => {
    requests.push({ path: request.url || "", body: body ? JSON.parse(body) : {} });
    setTimeout(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(ANSWERS[new URL(request.url ?? "/", "http://x").pathname] ?? { ok: true }));
    }, delay);
  });
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const ask = { task: "connection-check" as const, system: "Answer OK.", messages: [{ role: "user" as const, content: "Hi" }] };

describe("timedFetch (#228)", () => {
  it("waits for the headers as long as the provider's timeout says, not undici's own five minutes", async () => {
    delay = 1_500;
    const failure = await timedFetch(200)(`${address}/slow`).catch((reason: unknown) => reason);
    // undici's default would wait 300 s; this one gave up after 1.2.
    expect((failure as Error & { cause?: { code?: string } }).cause?.code).toBe("UND_ERR_HEADERS_TIMEOUT");
    expect(toAiError(failure, { model: "m" })).toMatchObject({ kind: "timeout", detail: "UND_ERR_HEADERS_TIMEOUT" });
    expect(await (await timedFetch(2_000)(`${address}/slow`)).json()).toEqual({ ok: true });
  });

  it("serves each SDK, with and without a key, so a slow answer still comes back", async () => {
    delay = 300;
    const providers = [
      new OpenAICompatibleProvider("LOCAL", `${address}/v1`, null, "m", 5_000),
      new OpenAICompatibleProvider("OPENAI", `${address}/v1`, "sk-test", "m", 5_000),
      new AnthropicProvider(address, "sk-ant-test", "m", 5_000),
      new OllamaProvider(address, "m", 5_000),
    ];
    for (const provider of providers) expect(await provider.complete(ask), provider.kind).toBe("OK");
  });

  it("still says the model took too long when the provider's own timeout runs out first", async () => {
    delay = 1_500;
    const failure = await new OpenAICompatibleProvider("LOCAL", `${address}/v1`, null, "m", 300).complete(ask).catch((reason: unknown) => reason);
    expect(failure).toBeInstanceOf(AiError);
    expect((failure as AiError).kind).toBe("timeout");
  });
});

it("keeps CareerAI's request and output-token caps on the real timed AI transport", async () => {
  delay = 0;
  const providers = [
    new OpenAICompatibleProvider("OPENAI", `${address}/v1`, "sk-test", "m", 5_000),
    new AnthropicProvider(address, "sk-ant-test", "m", 5_000),
    new OllamaProvider(address, "m", 5_000),
  ];
  for (const provider of providers) {
    const before = requests.length;
    await withAiRequestBudget(1, 80, async () => {
      expect(await provider.complete({ ...ask, maxTokens: 500 })).toBe("OK");
      await expect(provider.complete({ ...ask, maxTokens: 500 })).rejects.toThrow();
    });
    const sent = requests.slice(before);
    expect(sent, provider.kind).toHaveLength(1);
    const body = sent[0].body;
    const tokens = body.max_tokens ?? body.max_completion_tokens ?? (body.options as { num_predict?: number } | undefined)?.num_predict;
    expect(tokens, provider.kind).toBe(80);
  }
});
