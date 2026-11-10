import type { Metadata } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";

import { Toaster } from "@/components/toast";
import { fontVariables } from "@/fonts";
import { APP_THEME_COOKIE, COLOR_SCHEME_COOKIE, parseAppTheme, parseColorScheme } from "@/lib/ui-preferences";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Dossier", template: "%s · Dossier" },
  description: "Your job search, on your server.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Every page renders per request: its scripts carry that request's CSP nonce (E11-5).
  await connection();
  // Light or dark as chosen in the sidebar; without a choice, the system's.
  const jar = await cookies();
  const scheme = parseColorScheme(jar.get(COLOR_SCHEME_COOKIE)?.value);
  const theme = parseAppTheme(jar.get(APP_THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={scheme} data-ui-theme={theme} className={`${fontVariables} h-full antialiased`}>
      <body className="min-h-full">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
