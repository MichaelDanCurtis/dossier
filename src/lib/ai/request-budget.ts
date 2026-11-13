import { AsyncLocalStorage } from "node:async_hooks";

type Budget = { remaining: number; outputTokens: number };
const budgets = new AsyncLocalStorage<Budget>();

/** Includes SDK retries and structured-output fallbacks in the same allowance. */
export function withAiRequestBudget<T>(requests: number, outputTokens: number, run: () => Promise<T>): Promise<T> {
  return budgets.run({ remaining: requests, outputTokens }, run);
}

export function budgetedFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    const budget = budgets.getStore();
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    // Model discovery/probing is not a generation. Model loading has no output tokens.
    if (budget && method.toUpperCase() === "POST") {
      if (budget.remaining <= 0) throw new Error("This career review reached its two-request allowance. Review AI settings before retrying it.");
      budget.remaining--;
      if (typeof init?.body === "string") {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        for (const key of ["max_tokens", "max_completion_tokens", "max_output_tokens"]) {
          if (typeof body[key] === "number") body[key] = Math.min(body[key], budget.outputTokens);
        }
        if (body.options && typeof body.options === "object") {
          const options = body.options as Record<string, unknown>;
          if (typeof options.num_predict === "number") options.num_predict = Math.min(options.num_predict, budget.outputTokens);
        }
        init = { ...init, body: JSON.stringify(body) };
      }
    }
    return fetchImpl(input, init);
  };
}

// Resolve the global fetch at call time so test stubs and custom transports remain supported.
export const budgetedAiFetch: typeof fetch = budgetedFetch((input, init) => fetch(input, init));
