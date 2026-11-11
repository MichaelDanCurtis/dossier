import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SectionPanel, SectionTabs } from "./section-tabs";

const entries = [
  { id: "one", label: "First", href: "/example?section=one" },
  { id: "two", label: "Second", href: "/example?section=two" },
  { id: "three", label: "Third", href: "/example?section=three" },
];

describe("URL section tabs", () => {
  it("associates the active tab and panel and keeps a single tab stop", () => {
    render(<><SectionTabs scope="example" label="Example sections" entries={entries} current="two" /><SectionPanel scope="example" current="two">Body</SectionPanel></>);
    const active = screen.getByRole("tab", { name: "Second" });
    expect(active).toHaveAttribute("aria-selected", "true");
    expect(active).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "First" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel", { name: "Second" })).toHaveAttribute("id", active.getAttribute("aria-controls"));
  });
  it("moves focus with arrows, Home and End without opening a section, then activates with Space", async () => {
    const user = userEvent.setup(), select = vi.fn();
    render(<SectionTabs scope="example" label="Example sections" entries={entries} current="one" onSelect={select} />);
    await user.tab();
    expect(screen.getByRole("tab", { name: "First" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Third" })).toHaveFocus();
    await user.keyboard("{Home}{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Second" })).toHaveFocus();
    expect(select).not.toHaveBeenCalled();
    await user.keyboard(" ");
    expect(select).toHaveBeenLastCalledWith("two");
    await user.keyboard("{End}{ArrowRight}");
    expect(screen.getByRole("tab", { name: "First" })).toHaveFocus();
  });
});
