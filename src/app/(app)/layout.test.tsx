import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ after: [] as (() => unknown)[], fetch: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", redirect: vi.fn() }));
vi.mock("next/server", () => ({ after: (callback: () => unknown) => fixture.after.push(callback) }));
vi.mock("@/lib/auth/session", () => ({ verifySession: vi.fn() }));
vi.mock("@/lib/auth/actions", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/desktop", () => ({ isDesktopApp: () => false }));
vi.mock("@/lib/agent/view", () => ({ countAgentQueue: async () => 0 }));
vi.mock("@/lib/google/inbox-data", () => ({ inboxCount: async () => 0 }));
vi.mock("@/lib/profile-data", () => ({ loadProfileName: async () => "CareerAI User" }));
vi.mock("@/lib/prisma", () => ({ prisma: { application: { count: async () => 1 } } }));
vi.mock("@/lib/time-zone", () => ({ userTimeZone: async () => "America/Los_Angeles", rememberBrowserTimeZone: vi.fn() }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: async () => ({ setupGuide: { finished: true }, updateCheck: true, latestVersion: "99.0.0", latestVersionUrl: "https://github.com/AienTech/dossier/releases/tag/v99.0.0", usagePingChoice: "on", usagePingChoiceText: 1, announcementFeed: { items: [{ id: "old-survey", severity: "info", title: "Dossier survey", body: "Please answer our survey", publishedAt: "2026-11-01T00:00:00.000Z", minVersion: null, maxVersion: null, expiresAt: null, link: null }] }, announcementsDismissed: [] }) }));
import AppLayout from "./layout";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); fixture.after.length = 0; fixture.fetch.mockReset(); });
it("ignores cached upstream prompts and sends no upstream requests when pages open", async () => {
  vi.stubGlobal("fetch", fixture.fetch);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubEnv("DOSSIER_TELEMETRY", "on");
  vi.stubEnv("DOSSIER_ACCOUNT_GATEWAY", "on");
  render(await AppLayout({ children: <p>Your career workspace</p>, params: Promise.resolve({}) }));
  await Promise.all(fixture.after.map(callback => callback()));
  expect(screen.getByRole("main")).toHaveTextContent("Your career workspace");
  expect(screen.getByRole("link", { name: "Get Chrome extension" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText(/survey|99\.0\.0|usage ping/i)).not.toBeInTheDocument();
  expect(fixture.fetch).not.toHaveBeenCalled();
});
