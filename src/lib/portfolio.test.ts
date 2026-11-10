import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { demoProfile } from "@/lib/demo-profile";
import { buildPortfolio, EMPTY_PORTFOLIO_SELECTION, portfolioZip } from "./portfolio";

describe("reviewed public portfolio bundle", () => {
  it("starts with nothing selected and never copies private profile, reference or credential fields", () => {
    const profile = demoProfile();
    profile.basics.phone = "PRIVATE-PHONE"; profile.basics.address = "PRIVATE-ADDRESS";
    profile.facts = [{ id: "private-fact", text: "PRIVATE-CAREER-NOTE" }];
    profile.references = [{ id: "private-reference", name: "PRIVATE-REF", relation: "Manager", company: "Private", email: "PRIVATE-REF-EMAIL", phone: "PRIVATE-REF-PHONE" }];
    const empty = buildPortfolio(profile, EMPTY_PORTFOLIO_SELECTION);
    expect(empty.content).toMatchObject({ name: "", email: "", projects: [], experience: [], certifications: [], skills: [] });
    const selected = buildPortfolio(profile, { ...EMPTY_PORTFOLIO_SELECTION, name: true, summary: true, projects: profile.projects.map((row) => row.id), certifications: profile.certifications.map((row) => row.id) });
    const files = unzipSync(portfolioZip(selected));
    expect(Object.keys(files).sort()).toEqual(["README.md", "agent-handoff.md", "content.json", "index.html", "manifest.json", "site-brief.md"]);
    const combined = Object.values(files).map((file) => strFromU8(file)).join("\n");
    expect(combined).not.toContain("PRIVATE-"); expect(combined).not.toContain(profile.basics.email);
    for (const row of profile.certifications) if (row.credentialId) expect(combined).not.toContain(row.credentialId);
    expect(JSON.parse(strFromU8(files["manifest.json"])).contentHash).toBe(selected.hash);
  });
  it("escapes selected text, rejects active URLs, and changes the review hash when selected content changes", () => {
    const profile = demoProfile();
    profile.basics.name = '<img src=x onerror="alert(1)">'; profile.basics.website = "javascript:alert(1)";
    const selection = { ...EMPTY_PORTFOLIO_SELECTION, name: true, website: true };
    const first = buildPortfolio(profile, selection);
    expect(first.html).toContain("&lt;img"); expect(first.html).not.toContain("<img"); expect(first.html).not.toContain("javascript:");
    profile.basics.website = "example.com/selected-work";
    expect(buildPortfolio(profile, selection).content.website).toBe("https://example.com/selected-work");
    profile.basics.website = "javascript:alert(1)";
    profile.basics.phone = "Another private phone";
    expect(buildPortfolio(profile, selection).hash).toBe(first.hash);
    profile.basics.name = "A corrected public name";
    expect(buildPortfolio(profile, selection).hash).not.toBe(first.hash);
  });
});
