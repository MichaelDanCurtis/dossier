import { afterEach, expect, it, vi } from "vitest";
import { budgetedAiFetch, withAiRequestBudget } from "./request-budget";

afterEach(() => vi.unstubAllGlobals());
it("counts actual generation attempts, clamps reasoning expansion, and isolates concurrent budgets", async () => {
  const fetcher = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetcher);
  const ask = () => budgetedAiFetch("https://provider.example/v1/chat/completions", { method: "POST", body: JSON.stringify({ max_completion_tokens: 16000 }) });
  await Promise.all([1, 2].map(() => withAiRequestBudget(2, 2048, async () => {
    await budgetedAiFetch("https://provider.example/v1/models");
    await ask(); await ask();
    await expect(ask()).rejects.toThrow("allowance");
  })));
  const attempts = fetcher.mock.calls as unknown as [unknown, RequestInit][];
  expect(attempts.filter(([, init]) => init?.method === "POST")).toHaveLength(4);
  for (const [, init] of attempts.filter(([, init]) => init?.body)) expect(JSON.parse(String(init.body)).max_completion_tokens).toBe(2048);
});
