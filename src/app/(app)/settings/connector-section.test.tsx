import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "@/components/toast";
import { copyText } from "@/lib/copy-text";

import { addConnectorRedirect, disconnectApps, removeConnectorRedirect, setConnector } from "./actions";
import { ConnectorSection } from "./connector-section";

vi.mock("./actions", () => ({
  setConnector: vi.fn(async ({ on }: { on: boolean }) => ({ ok: true, data: { on } })),
  disconnectApps: vi.fn(async () => ({ ok: true, data: null, toast: "Every app is disconnected." })),
  addConnectorRedirect: vi.fn(async ({ uri }: { uri: string }) => ({ ok: true, data: { redirects: [uri] } })),
  removeConnectorRedirect: vi.fn(async () => ({ ok: true, data: { redirects: [] } })),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));
vi.mock("@/lib/copy-text", () => ({ copyText: vi.fn(async () => true) }));

const ADDRESS = "https://dossier.example/api/mcp";

beforeEach(() => vi.clearAllMocks());

describe("Settings → MCP connector (#221, #281)", () => {
  it("is off until it's turned on, and then shows the address to add in an app", async () => {
    const user = userEvent.setup();
    render(<ConnectorSection initial={{ on: false, redirects: [] }} address={ADDRESS} />);
    expect(screen.getByRole("heading", { name: "MCP connector" })).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: "Let apps connect" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAccessibleDescription("Off. The connector's addresses aren't open on this server.");
    expect(screen.queryByText(ADDRESS)).not.toBeInTheDocument();

    await user.click(toggle);
    expect(setConnector).toHaveBeenCalledWith({ on: true });
    expect(screen.getByText(ADDRESS)).toBeInTheDocument();
    expect(screen.getByText(/claude mcp add --transport http dossier https:\/\/dossier\.example\/api\/mcp/)).toBeInTheDocument();
    // A public HTTPS address needs no warning.
    expect(screen.queryByRole("note")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(copyText).toHaveBeenCalledWith(ADDRESS);
    expect(toast).toHaveBeenCalledWith("Address copied.");
  });

  it("turns it off again, and puts the switch back when that fails", async () => {
    const user = userEvent.setup();
    render(<ConnectorSection initial={{ on: true, redirects: [] }} address={ADDRESS} />);
    vi.mocked(setConnector).mockResolvedValueOnce({ ok: false, error: "Something went wrong on the server. Please try again." });
    await user.click(screen.getByRole("switch", { name: "Let apps connect" }));
    expect(setConnector).toHaveBeenCalledWith({ on: false });
    expect(screen.getByRole("switch", { name: "Let apps connect" })).toHaveAttribute("aria-checked", "true");
  });

  it("says Claude on the web and cloud apps need a public HTTPS address, which a local one isn't", () => {
    render(<ConnectorSection initial={{ on: true, redirects: [] }} address="http://localhost:3000/api/mcp" />);
    expect(screen.getByRole("note")).toHaveTextContent(/This is a local address\. Claude on the web, Desktop and mobile, and apps in the cloud such as n8n Cloud, reach CareerAI from their own servers/);
  });

  it("adds and removes other apps' callback addresses", async () => {
    const user = userEvent.setup();
    const n8n = "https://n8n.example/rest/oauth2-credential/callback";
    render(<ConnectorSection initial={{ on: true, redirects: [] }} address={ADDRESS} />);
    await user.type(screen.getByLabelText("Callback address"), `${n8n}{Enter}`);
    expect(addConnectorRedirect).toHaveBeenCalledWith({ uri: n8n });
    expect(screen.getByRole("list", { name: "Apps' callback addresses" })).toHaveTextContent(n8n);
    expect(screen.getByLabelText("Callback address")).toHaveValue("");

    await user.click(screen.getByRole("button", { name: `Remove ${n8n}` }));
    expect(removeConnectorRedirect).toHaveBeenCalledWith({ uri: n8n });
    expect(screen.queryByRole("list", { name: "Apps' callback addresses" })).not.toBeInTheDocument();
  });

  it("disconnects every app", async () => {
    const user = userEvent.setup();
    render(<ConnectorSection initial={{ on: true, redirects: [] }} address={ADDRESS} />);
    await user.click(screen.getByRole("button", { name: "Disconnect all apps" }));
    expect(disconnectApps).toHaveBeenCalledWith({});
  });
});

describe("private-account MCP settings", () => {
  it("shows one connector page, creates and copies a one-time token, and disconnects all access", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
      const operation = options?.body?.toString();
      return new Response(JSON.stringify(operation === "operation=create" ? { token: "test-private-token", authorizations: 1, expires: "2027-02-01T00:00:00Z" } : { authorizations: 0 }));
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      render(<ConnectorSection initial={{ on: true, redirects: [] }} address={ADDRESS} accountGateway />);
      expect(await screen.findByText("0 active authorizations")).toBeInTheDocument();
      expect(screen.queryByLabelText("Callback address")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Generate personal MCP token" }));
      expect(await screen.findByText("test-private-token")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Copy token" }));
      expect(copyText).toHaveBeenCalledWith("test-private-token");
      await user.click(screen.getByRole("button", { name: "Disconnect all apps" }));
      expect(disconnectApps).toHaveBeenCalledWith({});
      expect(fetcher.mock.calls.some(([, options]) => options?.body?.toString() === "operation=revoke")).toBe(true);
      expect(screen.queryByText("test-private-token")).not.toBeInTheDocument();
    } finally { vi.unstubAllGlobals(); }
  });

  it("shows token creation errors without exposing a token", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => new Response(JSON.stringify(options?.method === "POST" ? { error: "Connector is off." } : { authorizations: 0 }), { status: options?.method === "POST" ? 409 : 200 })));
    try {
      render(<ConnectorSection initial={{ on: true, redirects: [] }} address={ADDRESS} accountGateway />);
      await screen.findByText("0 active authorizations");
      await user.click(screen.getByRole("button", { name: "Generate personal MCP token" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Connector is off.");
      expect(screen.queryByRole("button", { name: "Copy token" })).not.toBeInTheDocument();
    } finally { vi.unstubAllGlobals(); }
  });
});
