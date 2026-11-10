"use client";

import { useEffect, useState } from "react";

import { toast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { copyText } from "@/lib/copy-text";

type Access = { authorizations: number; token?: string; expires?: string };

export async function revokePersonalMcpAccess(): Promise<void> {
  const response = await fetch("/_accounts/api/mcp", {
    method: "POST",
    body: new URLSearchParams({ operation: "revoke" }),
  });
  if (!response.ok) throw new Error("Couldn't disconnect apps. Please try again.");
}

/** Tokens stay in this screen's memory and are shown only in the creation response. */
export function PersonalMcpAccess() {
  const [access, setAccess] = useState<Access | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/_accounts/api/mcp", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Couldn't load MCP access.");
        const result: Access = await response.json();
        if (!controller.signal.aborted) setAccess(result);
      })
      .catch(() => { if (!controller.signal.aborted) setProblem("Couldn't load MCP access. Refresh to try again."); });
    return () => controller.abort();
  }, []);

  const generate = async () => {
    setBusy(true);
    setProblem("");
    try {
      const response = await fetch("/_accounts/api/mcp", { method: "POST", body: new URLSearchParams({ operation: "create" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Couldn't generate a token.");
      setAccess(result as Access);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Couldn't generate a token. Please try again.");
    } finally { setBusy(false); }
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h3 className="text-control font-medium">Codex, Claude Code &amp; n8n</h3>
        <p className="text-sm text-pretty text-muted">
          Use the address above with a personal bearer token. Each token accesses only your private workspace.
          Compatible apps can also sign in through browser OAuth; approve access only for apps you trust.
        </p>
      </div>
      <p className="text-meta text-muted" role="status">{access ? `${access.authorizations} active authorizations` : "Loading MCP access…"}</p>
      {problem && <p role="alert" className="text-sm text-error">{problem}</p>}
      {access?.token && (
        <div className="flex flex-col gap-3 rounded-control border border-line-input bg-input p-4">
          <p className="text-sm font-medium">Save this token now. It will not be shown again.</p>
          <code className="select-all font-mono text-label [overflow-wrap:anywhere]" aria-label="Personal MCP token">{access.token}</code>
          <div><Button variant="secondary" size="sm" onClick={() => void copyText(access.token!).then((copied) => toast(copied ? "Token copied." : "Couldn't copy it. Select the token and copy it instead."))}>Copy token</Button></div>
          <p className="text-meta text-muted">Expires {access.expires?.slice(0, 10)}. Keep it private.</p>
        </div>
      )}
      <div><Button variant="secondary" disabled={busy} onClick={() => void generate()}>{busy ? "Generating…" : "Generate personal MCP token"}</Button></div>
      <p className="text-meta text-muted">
        Generating a token replaces your previous personal token, including one used by Codex. Tokens expire after 90 days.
        Send it as <code className="font-mono text-label">Authorization: Bearer &lt;your token&gt;</code>.
        Disconnect all apps below revokes personal tokens and browser connections.
      </p>
    </Card>
  );
}
