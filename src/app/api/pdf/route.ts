import { type NextRequest, NextResponse } from "next/server";

import { ActionError } from "@/lib/action";
import { reserveApplicationPackage, recordPackageOutcome, packagePrintPath } from "@/lib/application-package";
import { DocumentKind } from "@/generated/prisma/enums";
import { resolveFileName } from "@/lib/file-name";
import { holdPdf, pdfDownload } from "@/lib/pdf/downloads";
import { countPdfPages, printBasePath } from "@/lib/pdf/pages";
import { renderPdf } from "@/lib/pdf/render";
import { prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";
import { route } from "@/lib/route";
import { FIT_LEVELS } from "@/lib/themes";

/** The documents an application can download, by their `doc=` value. */
const TAILORED = { resume: DocumentKind.RESUME, letter: DocumentKind.COVER_LETTER } as const;

/** Application ids are cuids; anything else never reaches a print path. */
const APPLICATION_ID = /^[a-z0-9]{1,64}$/i;

const notFound = (error: string) => NextResponse.json({ error }, { status: 404 });

/**
 * Downloads a document as a PDF (RES-5, APP-12): `?doc=base` for the base
 * resume, `?doc=resume&application={id}` or `?doc=letter&application={id}`
 * for an application's tailored resume or cover letter. The file is named
 * with Settings → PDF file name (SET-8).
 */
export const GET = route(async (request) => {
  const rendered = await renderRequested(request);
  return rendered instanceof Response ? rendered : pdfDownload(rendered.pdf, rendered.fileName);
});

/**
 * Renders the same documents and holds the PDF for a few minutes, answering
 * with the link to download it from: `{ url }`. The download button uses
 * this, so the browser saves the file from a link of its own.
 */
export const POST = route(async (request) => {
  const rendered = await renderRequested(request);
  if (rendered instanceof Response) return rendered;
  return NextResponse.json({ url: `/api/pdf/${holdPdf(rendered.pdf, rendered.fileName)}` });
});

/** The PDF and file name of the document the query asks for, or a 404 response. */
async function renderRequested(request: NextRequest): Promise<{ pdf: Uint8Array; fileName: string } | Response> {
  const params = request.nextUrl.searchParams;
  const doc = params.get("doc");
  const [name, settings] = await Promise.all([loadProfileName(), loadSettings()]);
  const date = new Date();

  if (doc === "base") {
    // "Fit to one page" (public issue 69): squeezed a step at a time until it fits, as the preview does.
    const variant = params.get("variant") || undefined;
    if (variant && !APPLICATION_ID.test(variant)) return notFound("That resume variant does not exist.");
    let pdf = await renderPdf(printBasePath(0, variant));
    for (let fit = 1; settings.fitBaseResume && fit <= FIT_LEVELS && countPdfPages(pdf) > 1; fit++) pdf = await renderPdf(printBasePath(fit, variant));
    return { pdf, fileName: resolveFileName(settings.fileNamePattern, { name, doc: DocumentKind.RESUME, date }) };
  }

  if (doc !== "resume" && doc !== "letter") return notFound("There's no such document to download.");
  const id = params.get("application") ?? "";
  const application = APPLICATION_ID.test(id)
    ? await prisma.application.findUnique({
        where: { id },
        select: { company: true, role: true, documents: { where: { kind: TAILORED[doc] }, select: { id: true } } },
      })
    : null;
  if (!application) return notFound("That application no longer exists.");
  if (application.documents.length === 0) {
    return notFound(doc === "resume" ? "This application has no tailored resume." : "This application has no cover letter.");
  }

  try {
    const reserved = await reserveApplicationPackage(id);
    try {
      const pdf = await renderPdf(packagePrintPath(reserved.id, doc));
      await recordPackageOutcome(reserved.id, "EXPORTED");
      return { pdf, fileName: resolveFileName(reserved.snapshot.fileNamePattern, { name: reserved.snapshot.profile.basics.name, company: reserved.snapshot.company, role: reserved.snapshot.role, doc: TAILORED[doc], date }) };
    } catch (error) {
      await recordPackageOutcome(reserved.id, "FAILED");
      throw error;
    }
  } catch (error) {
    if (error instanceof ActionError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
