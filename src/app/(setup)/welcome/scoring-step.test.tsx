import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ScoringStep } from "./scoring-step";
import { saveScorer, saveOpenaiDecisionsKey, saveTypesafeKey, testOpenaiDecisions, testJev } from "../../(app)/settings/actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../(app)/settings/actions", () => ({ saveScorer: vi.fn(), saveOpenaiDecisionsKey: vi.fn(), saveTypesafeKey: vi.fn(), testOpenaiDecisions: vi.fn(), testJev: vi.fn() }));
vi.mock("@/components/toast", () => ({ toastResult: (value: unknown) => value }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveScorer).mockResolvedValue({ ok: true, data: { scorer: "OPENAI_DECISIONS", keyState: "none" } });
  vi.mocked(saveOpenaiDecisionsKey).mockResolvedValue({ ok: true, data: { scorer: "OPENAI_DECISIONS", keyState: "set" } });
  vi.mocked(testOpenaiDecisions).mockResolvedValue({ ok: true, data: { connected: true, model: "gpt-6-luna", seconds: 0.1 } });
});

it("offers Decisions during onboarding and never carries a typed Jev key into OpenAI", async () => {
  render(<ScoringStep initial={{ scorer: "JEV", keyState: "none" }} />);
  expect(screen.getAllByRole("radio")).toHaveLength(3);
  await userEvent.type(screen.getByLabelText("TypeSafe key"), "typesafe-only-key");
  await userEvent.click(screen.getByRole("radio", { name: "OpenAI Decisions" }));
  expect(screen.getByLabelText("OpenAI API key for Decisions")).toHaveValue("");
  await userEvent.type(screen.getByLabelText("OpenAI API key for Decisions"), "openai-test-only-key");
  await userEvent.click(screen.getByRole("button", { name: "Check it" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("OpenAI Decisions answered"));
  expect(saveOpenaiDecisionsKey).toHaveBeenCalledWith({ change: { action: "set", value: "openai-test-only-key" } });
  expect(saveTypesafeKey).not.toHaveBeenCalled();
  expect(testJev).not.toHaveBeenCalled();
});
