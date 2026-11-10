import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { browserAppearance } from "@/lib/ui-preferences";

import { ThemeToggle } from "../theme-toggle";

import { AppearanceSection } from "./appearance-section";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  for (const name of ["dossier_ui_theme", "dossier_theme"]) document.cookie = `${name}=;path=/;max-age=0`;
  document.documentElement.dataset.uiTheme = "studio";
  delete document.documentElement.dataset.theme;
});
afterEach(() => vi.unstubAllGlobals());

describe("app appearance", () => {
  it("previews without writing cookies and cancels to the committed theme", async () => {
    render(<AppearanceSection initial={{ theme: "studio" }} />);
    await userEvent.click(screen.getByRole("radio", { name: /Editorial/ }));
    expect(document.documentElement.dataset.uiTheme).toBe("editorial");
    expect(document.cookie).not.toContain("dossier_ui_theme");
    expect(screen.getByRole("status")).toHaveTextContent("Previewing Editorial");
    await userEvent.click(screen.getByRole("button", { name: "Cancel preview" }));
    expect(document.documentElement.dataset.uiTheme).toBe("studio");
    expect(screen.getByRole("button", { name: "Apply appearance" })).toBeDisabled();
  });

  it("applies both choices and restores them on a fresh page", async () => {
    const view = render(<AppearanceSection initial={{ theme: "studio" }} />);
    await userEvent.click(screen.getByRole("radio", { name: /Editorial/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.cookie).not.toContain("dossier_theme");
    await userEvent.click(screen.getByRole("button", { name: "Apply appearance" }));
    expect(document.cookie).toContain("dossier_ui_theme=editorial");
    expect(document.cookie).toContain("dossier_theme=dark");
    view.unmount();
    render(<AppearanceSection initial={browserAppearance()} />);
    expect(screen.getByRole("radio", { name: /Editorial/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(document.documentElement.dataset.uiTheme).toBe("editorial");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("discards uncommitted changes when navigating away", async () => {
    const view = render(<AppearanceSection initial={{ theme: "studio" }} />);
    await userEvent.click(screen.getByRole("radio", { name: /Editorial/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    view.unmount();
    expect(document.documentElement.dataset.uiTheme).toBe("studio");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("follow system removes an old explicit mode while retaining the chosen theme", async () => {
    document.cookie = "dossier_theme=dark;path=/";
    document.documentElement.dataset.theme = "dark";
    render(<AppearanceSection initial={{ theme: "studio", scheme: "dark" }} />);
    await userEvent.click(screen.getByRole("radio", { name: "Follow system" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    await userEvent.click(screen.getByRole("button", { name: "Apply appearance" }));
    expect(document.cookie).not.toContain("dossier_theme=");
    expect(document.cookie).toContain("dossier_ui_theme=studio");
  });

  it("sidebar mode changes do not accept a previewed theme and survive cancellation", async () => {
    render(<><AppearanceSection initial={{ theme: "studio" }} /><ThemeToggle /></>);
    await userEvent.click(screen.getByRole("radio", { name: /Editorial/ }));
    await userEvent.click(screen.getByRole("button", { name: "Dark mode" }));
    expect(document.cookie).not.toContain("dossier_ui_theme");
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Cancel preview" }));
    expect(document.documentElement.dataset.uiTheme).toBe("studio");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
