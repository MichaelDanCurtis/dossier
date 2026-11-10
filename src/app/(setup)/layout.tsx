import { verifySession } from "@/lib/auth/session";

/** The setup guide's shell (E21): the guide alone, without the sidebar, so nothing else asks for attention. */
export default async function SetupLayout({ children }: LayoutProps<"/">) {
  await verifySession();
  return <div className="min-h-screen bg-surface">
    {process.env.DOSSIER_ACCOUNT_GATEWAY === "on" && <nav aria-label="Account" className="mx-auto flex max-w-[820px] justify-end gap-6 px-8 pt-5 text-sm text-muted">
      <a href="/settings?section=connector" className="underline underline-offset-2">MCP connector</a>
      {process.env.DOSSIER_ACCOUNT_ROLE === "admin" && <a href="/_accounts/admin" className="underline underline-offset-2">Manage users</a>}
    </nav>}
    {children}
  </div>;
}
