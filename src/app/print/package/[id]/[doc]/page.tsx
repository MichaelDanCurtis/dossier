import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TailoredLetter, TailoredResume } from "@/components/documents/tailored-documents";
import { applicationPackageSchema, packagePrintPath } from "@/lib/application-package";
import { verifyPrintAccess } from "@/lib/pdf/print-access";
import { prisma } from "@/lib/prisma";
import { printCss } from "@/lib/themes";

export const metadata: Metadata = { title: "Application package", robots: { index: false } };
export default async function PrintPackagePage({ params }: PageProps<"/print/package/[id]/[doc]">) {
  const { id, doc } = await params;
  if (doc !== "resume" && doc !== "letter") notFound();
  await verifyPrintAccess(packagePrintPath(id, doc));
  const row = await prisma.applicationPackageSnapshot.findUnique({ where: { id } });
  if (!row) notFound();
  const pkg = applicationPackageSchema.parse(JSON.parse(row.snapshotJson));
  const document = doc === "resume" ? pkg.resume : pkg.letter;
  if (!document) notFound();
  return <><style>{printCss(document.theme, pkg.paper)}</style>{doc === "resume" ? <TailoredResume resume={document} profile={pkg.profile} paper={pkg.paper} followThemeLayout={pkg.followThemeLayout} showPhoto={pkg.showPhoto} language={pkg.language} includeReferences={pkg.includeReferences} sections={pkg.sections} /> : <TailoredLetter letter={document} profile={pkg.profile} paper={pkg.paper} company={pkg.company} location={pkg.location} tone={pkg.tone} date={new Date(`${pkg.letterDay}T00:00:00Z`)} dateFormat={pkg.dateFormat} language={pkg.language} />}</>;
}
