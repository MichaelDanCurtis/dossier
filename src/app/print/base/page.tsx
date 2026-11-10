import type { Metadata } from "next";

import { ResumeDocument } from "@/components/documents/resume-document";
import { printBasePath } from "@/lib/pdf/pages";
import { verifyPrintAccess } from "@/lib/pdf/print-access";
import { loadResumeContext } from "@/lib/resume-variant-data";
import { loadSettings } from "@/lib/settings-data";
import { loadTheme } from "@/lib/theme-data";
import { BUILT_IN_THEMES, FIT_LEVELS, printCss } from "@/lib/themes";

export const metadata: Metadata = { title: "Base resume", robots: { index: false } };

/**
 * The base resume on its own, for the PDF renderer (E5-5) to print.
 * `?fit=1` to `?fit=4` squeeze it that far, for "Fit to one page" (public
 * issue 69): the renderer tries the levels in turn until it fits.
 */
export default async function PrintBaseResumePage({ searchParams }: PageProps<"/print/base">) {
  const params = await searchParams;
  const fit = fitLevel(params.fit);
  const variant = typeof params.variant === "string" ? params.variant : undefined;
  await verifyPrintAccess(printBasePath(fit, variant));
  const [context, settings] = await Promise.all([loadResumeContext(variant), loadSettings()]);
  const theme = (await loadTheme(settings.baseThemeId)) ?? BUILT_IN_THEMES[0];

  return (
    <>
      <style>{printCss(theme, settings.paper, fit)}</style>
      <ResumeDocument theme={theme} profile={context.profile} units={context.units} paper={settings.paper} includeReferences={settings.includeRefs} sections={settings.resumeSections} language={settings.resumeLanguage} fit={fit} />
    </>
  );
}

const fitLevel = (value: string | string[] | undefined) => {
  const level = Number(typeof value === "string" ? value : 0);
  return Number.isInteger(level) && level > 0 ? Math.min(level, FIT_LEVELS) : 0;
};
