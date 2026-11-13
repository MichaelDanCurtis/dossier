import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AboutSection } from "./about-section";

const facts = [{ label: "Version", value: "1.14.0" }, { label: "Database", value: "PostgreSQL · 9.0 MB" }];
describe("CareerAI About", () => {
  it("keeps installation facts, source attribution and the setup guide", () => {
    render(<AboutSection facts={facts} />);
    expect(screen.getByRole("heading", { name: "About this install" })).toBeInTheDocument();
    expect(screen.getByText("CareerAI is our private fork of Dossier. Free and open source under AGPL-3.0.")).toBeInTheDocument();
    expect(screen.getAllByRole("definition").map(value => value.textContent)).toEqual(["1.14.0", "PostgreSQL · 9.0 MB"]);
    expect(screen.getByRole("link", { name: "Open the setup guide" })).toHaveAttribute("href", "/welcome?step=start");
  });
  it("never offers upstream surveys, telemetry or release checks, even with old props", () => {
    const legacy = { updates: { daily: true, available: { version: "99.0.0", url: "https://github.com/AienTech/dossier/releases/tag/v99.0.0" } }, usagePing: { choice: "on", production: true } };
    render(<AboutSection facts={facts} {...legacy} />);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /update|survey|ping/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/99\.0\.0|send.*ping|check for updates/i)).not.toBeInTheDocument();
  });
});
