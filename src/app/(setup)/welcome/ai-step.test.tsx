import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiStep } from "./ai-step";
import { connectAi } from "./actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({ connectAi: vi.fn(), findLocalAi: vi.fn() }));
vi.mock("../../(app)/settings/actions", () => ({ saveAiProvider: vi.fn() }));
vi.mock("@/components/toast", () => ({ toastResult: (result: unknown) => result }));

beforeEach(() => {
  vi.mocked(connectAi).mockReset().mockResolvedValue({ ok: true, data: { connected: true, model: "new-live-model", models: ["new-live-model", "another-live-model"], seconds: 0.1 } });
});

const initial = { usable: false, name: "", model: "", choice: "openai" as const, fromEnv: false };

describe("setup model discovery", () => {
  it("offers the provider's live models and checks the one the user chooses", async () => {
    const user = userEvent.setup();
    render(<AiStep current={initial} />);
    await user.type(screen.getByLabelText("OpenAI API key"), "test-key");
    await user.click(screen.getByRole("button", { name: "Check it" }));
    expect(await screen.findByRole("option", { name: "another-live-model" })).toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toHaveValue("new-live-model");
    await user.selectOptions(screen.getByLabelText("Model"), "another-live-model");
    await user.click(screen.getByRole("button", { name: "Check it" }));
    expect(connectAi).toHaveBeenLastCalledWith({ choice: "openai", key: undefined, model: "another-live-model" });
  });

  it("lets the user choose a live model when the account has none of the suggested defaults", async () => {
    vi.mocked(connectAi).mockResolvedValueOnce({ ok: true, data: { connected: false, kind: "model", message: "Choose a model offered by your account, then check again.", models: ["new-live-model", "another-live-model"] } });
    const user = userEvent.setup();
    render(<AiStep current={initial} />);
    await user.click(screen.getByRole("button", { name: "Check it" }));
    await screen.findByRole("option", { name: "another-live-model" });
    await user.selectOptions(screen.getByLabelText("Model"), "another-live-model");
    await user.click(screen.getByRole("button", { name: "Check it" }));
    expect(connectAi).toHaveBeenLastCalledWith({ choice: "openai", key: undefined, model: "another-live-model" });
  });

  it("forgets a catalog when the key changes rather than using another account's models", async () => {
    const user = userEvent.setup();
    render(<AiStep current={initial} />);
    await user.click(screen.getByRole("button", { name: "Check it" }));
    await screen.findByRole("option", { name: "another-live-model" });
    await user.type(screen.getByLabelText("OpenAI API key"), "replacement-key");
    expect(screen.queryByLabelText("Model")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check it" }));
    expect(connectAi).toHaveBeenLastCalledWith({ choice: "openai", key: "replacement-key", model: undefined });
  });
});

describe("the setup guide's AI step (E21-2)", () => {
  it("sends an account without the guide's models to Settings, where its key is saved and its models are listed", async () => {
    vi.mocked(connectAi).mockResolvedValue({
      ok: true,
      data: { connected: false, kind: "model", models: [], message: "Your OpenAI account doesn't offer the models Dossier uses: gpt-6.1-terra or gpt-6-luna." },
    });
    const user = userEvent.setup();
    render(<AiStep current={{ usable: false, name: "", model: "", choice: "openai", fromEnv: false }} />);
    await user.type(screen.getByLabelText("OpenAI API key"), "sk-test");
    await user.click(screen.getByRole("button", { name: "Check it" }));

    expect(await screen.findByText(/doesn't offer the models Dossier uses/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings → AI provider" })).toHaveAttribute("href", "/settings?section=ai");
    expect(screen.getByRole("status")).toHaveTextContent("where your key is already saved");
  });
});
