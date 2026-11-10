import { NextResponse } from "next/server";
import { route } from "@/lib/route";
import { loadSettings, saveSettings } from "@/lib/settings-data";

// Account gateway only reaches this with the same native session as its owner.
export const GET = route(async () => NextResponse.json({ enabledAt: (await loadSettings()).connectorEnabledAt }));
export const POST = route(async () => {
  const current = (await loadSettings()).connectorEnabledAt;
  const enabledAt = current ?? new Date().toISOString();
  if (!current) await saveSettings({ connectorEnabledAt: enabledAt });
  return NextResponse.json({ enabledAt });
});
