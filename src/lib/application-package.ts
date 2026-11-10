import "server-only";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { DateFormat, DocumentKind, PaperSize, Tone } from "@/generated/prisma/enums";
import { ActionError } from "@/lib/action";
import { extractedSchema, unitsSchema } from "@/lib/application-data";
import { lockForTransaction } from "@/lib/db-lock";
import { frozenProfile, readFrozenCopy } from "@/lib/frozen-copy";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { profileSnapshotSchema } from "@/lib/profile-snapshot";
import { recordHash } from "@/lib/record-hash";
import { sectionLayoutSchema } from "@/lib/resume-sections";
import { resumeContextSchema } from "@/lib/resume-variants";
import { loadSettings } from "@/lib/settings-data";
import { THEME_FIELDS } from "@/lib/theme-data";
import { themeFieldsSchema } from "@/lib/theme-file";
import { BUILT_IN_THEMES } from "@/lib/themes";

export const PACKAGE_LOCK = 1346454347;
const document = z.object({ units: unitsSchema, theme: themeFieldsSchema.extend({ id: z.string(), builtIn: z.boolean() }) });
export const applicationPackageSchema = z.object({
  schemaVersion: z.literal(1), applicationId: z.string(), company: z.string(), role: z.string(), location: z.string(), language: z.string(), tone: z.enum(Tone),
  variantName: z.string().nullable(), profile: profileSnapshotSchema,
  paper: z.enum(PaperSize), dateFormat: z.enum(DateFormat), fileNamePattern: z.string(),
  followThemeLayout: z.boolean(), followedBase: z.boolean(), showPhoto: z.boolean().nullable(), includeReferences: z.boolean(), sections: sectionLayoutSchema,
  letterDay: z.iso.date(), resume: document.nullable(), letter: document.nullable(), email: unitsSchema.nullable(),
});
export type ApplicationPackage = z.infer<typeof applicationPackageSchema>;
export type PackageConflict = { packageId: string; company: string; role: string; differences: string[]; pending: boolean };
export const employerKey = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");

/** Captured once; every rendered page and email reads this same immutable object. */
export async function captureApplicationPackage(id: string, tx: Prisma.TransactionClient = prisma, now = new Date()): Promise<ApplicationPackage> {
  const [application, live, settings] = await Promise.all([
    tx.application.findUnique({ where: { id }, include: { documents: { include: { theme: { select: THEME_FIELDS } } } } }),
    loadProfile(tx), loadSettings(tx),
  ]);
  if (!application) throw new ActionError("That application no longer exists.");
  const copy = readFrozenCopy(application.frozen);
  const context = application.variantContextJson ? resumeContextSchema.safeParse(JSON.parse(application.variantContextJson)) : null;
  const profile = copy ? frozenProfile(copy, live) : live;
  const base = (await tx.theme.findUnique({ where: { id: settings.baseThemeId }, select: THEME_FIELDS })) ?? BUILT_IN_THEMES[0];
  const part = (kind: DocumentKind) => {
    const row = application.documents.find((row) => row.kind === kind);
    return row ? { units: unitsSchema.parse(row.units), theme: (kind !== DocumentKind.EMAIL && copy?.themes[kind]) || row.theme || base } : null;
  };
  const extracted = extractedSchema.safeParse(application.extracted);
  const ownSections = sectionLayoutSchema.safeParse(application.sections);
  const sections = ownSections.success ? ownSections.data : settings.resumeSections;
  const letterDate = application.sentAt ?? now;
  const letterDay = new Date(Date.UTC(letterDate.getFullYear(), letterDate.getMonth(), letterDate.getDate())).toISOString().slice(0, 10);
  return applicationPackageSchema.parse({
    schemaVersion: 1, applicationId: id, company: application.company, role: application.role, location: application.location, language: application.language, tone: application.tone,
    variantName: context?.success ? context.data.variantName : null, profile: { ...profile, facts: [] },
    paper: copy?.paper ?? settings.paper, dateFormat: copy?.dateFormat ?? settings.dateFormat, fileNamePattern: settings.fileNamePattern,
    followThemeLayout: application.followThemeLayout, followedBase: copy?.followedBase ?? application.sections === null, showPhoto: application.showPhoto,
    includeReferences: (copy ? copy.includeReferences : settings.includeRefs && extracted.success && extracted.data.asksForReferences) || sections.withReferences === true,
    sections, letterDay, resume: part(DocumentKind.RESUME), letter: part(DocumentKind.COVER_LETTER), email: part(DocumentKind.EMAIL)?.units ?? null,
  });
}

/** Omission and different wording are valid; contradictory shared factual entries are flagged. */
export function packageDifferences(before: ApplicationPackage, after: ApplicationPackage): string[] {
  const differences: string[] = [];
  const date = (row: { startYear: number | null; startMonth: number | null; endYear: number | null; endMonth: number | null; current: boolean }) => ({ startYear: row.startYear, startMonth: row.startMonth, endYear: row.current ? null : row.endYear, endMonth: row.current ? null : row.endMonth, current: row.current });
  const ids = (pkg: ApplicationPackage) => new Set(pkg.resume?.units.map((row) => row.id) ?? []);
  const previous = ids(before), current = ids(after);
  const oldRoles = before.profile.experience.filter((row) => !row.volunteering && previous.has(`experience:${row.id}`));
  const newRoles = after.profile.experience.filter((row) => !row.volunteering && current.has(`experience:${row.id}`));
  const removed = oldRoles.filter((row) => !newRoles.some((other) => other.id === row.id));
  const added = newRoles.filter((row) => !oldRoles.some((other) => other.id === row.id));
  for (const old of removed) {
    const swapped = added.find((row) => {
      if (old.startYear === null || row.startYear === null) return false;
      const start = (entry: typeof row) => entry.startYear! * 12 + (entry.startMonth ?? 1);
      const end = (entry: typeof row) => entry.current || entry.endYear === null ? Infinity : entry.endYear * 12 + (entry.endMonth ?? 12);
      const sameFacts = recordHash({ company: old.company, role: old.role, ...date(old) }) === recordHash({ company: row.company, role: row.role, ...date(row) });
      return !sameFacts && Math.max(start(old), start(row)) <= Math.min(end(old), end(row));
    });
    if (swapped) differences.push(`The selected work history switches between overlapping roles at ${old.company || old.role || "an earlier employer"} and ${swapped.company || swapped.role || "another employer"}. Review which history this employer has already received.`);
  }
  for (const row of after.profile.experience) {
    const old = before.profile.experience.find((entry) => entry.id === row.id);
    if (!old || !current.has(`experience:${row.id}`) || !previous.has(`experience:${row.id}`)) continue;
    if (recordHash({ company: old.company, role: old.role, ...date(old) }) !== recordHash({ company: row.company, role: row.role, ...date(row) })) differences.push(`${old.company || old.role}: employer, title or employment dates differ.`);
  }
  for (const row of after.profile.education) {
    const old = before.profile.education.find((entry) => entry.id === row.id);
    if (old && current.has(`education:${row.id}`) && previous.has(`education:${row.id}`) && recordHash({ school: old.school, degree: old.degree, ...date(old) }) !== recordHash({ school: row.school, degree: row.degree, ...date(row) })) differences.push(`${old.school || old.degree}: degree, school or dates differ.`);
  }
  for (const row of after.profile.certifications) {
    const old = before.profile.certifications.find((entry) => entry.id === row.id);
    if (old && current.has(`certification:${row.id}`) && previous.has(`certification:${row.id}`) && recordHash(old) !== recordHash(row)) differences.push(`${old.name}: credential details differ.`);
  }
  return differences;
}

async function reviewSnapshot(snapshot: ApplicationPackage, tx: Prisma.TransactionClient, now: Date) {
  const contentHash = recordHash(snapshot);
  const key = employerKey(snapshot.company);
  const rows = key ? await tx.applicationPackageSnapshot.findMany({ where: { employerKey: key, contentHash: { not: contentHash } }, include: { events: { orderBy: { createdAt: "desc" } } }, orderBy: { createdAt: "desc" } }) : [];
  const conflicts: PackageConflict[] = [];
  const priorHashes: string[] = [];
  for (const row of rows) {
    const delivered = row.events.some((event) => event.kind === "EXPORTED" || event.kind === "SENT" || event.kind === "LEGACY_SENT");
    const latestAttempt = row.events.find((event) => event.kind === "RESERVED" || event.kind === "FAILED");
    const pending = !delivered && latestAttempt?.kind === "RESERVED" && now.getTime() - latestAttempt.createdAt.getTime() < 15 * 60 * 1000;
    if (!delivered && !pending) continue;
    const old = applicationPackageSchema.parse(JSON.parse(row.snapshotJson));
    const differences = packageDifferences(old, snapshot);
    if (differences.length) { conflicts.push({ packageId: row.id, company: row.company, role: row.role, differences, pending }); priorHashes.push(row.contentHash); }
  }
  const approvalHash = recordHash({ contentHash, priorHashes: priorHashes.sort() });
  const application = await tx.application.findUniqueOrThrow({ where: { id: snapshot.applicationId }, select: { packageApprovalHash: true } });
  return { contentHash, approvalHash, conflicts, approved: application.packageApprovalHash === approvalHash };
}
export async function reviewApplicationPackage(id: string) {
  return prisma.$transaction(async (tx) => {
    const snapshot = await captureApplicationPackage(id, tx);
    return reviewSnapshot(snapshot, tx, new Date());
  });
}
export async function acknowledgePackageDifferences(id: string, expected: string) {
  return prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, PACKAGE_LOCK);
    const review = await reviewSnapshot(await captureApplicationPackage(id, tx), tx, new Date());
    if (review.approvalHash !== expected) throw new ActionError("The application or employer history changed. Reload and review the differences again.");
    await tx.application.update({ where: { id }, data: { packageApprovalHash: expected, packageApprovalAt: new Date() } });
  });
}
export async function reserveApplicationPackage(id: string, tx?: Prisma.TransactionClient): Promise<{ id: string; snapshot: ApplicationPackage }> {
  if (!tx) return prisma.$transaction((db) => reserveApplicationPackage(id, db));
  await lockForTransaction(tx, PACKAGE_LOCK);
  const snapshot = await captureApplicationPackage(id, tx);
  const review = await reviewSnapshot(snapshot, tx, new Date());
  if (review.conflicts.length && !review.approved) throw new ActionError("This package differs from earlier material for this employer. Open the application and review Employer history before exporting or sending.");
  const row = await tx.applicationPackageSnapshot.upsert({ where: { contentHash: review.contentHash }, update: {}, create: { applicationId: id, employerKey: employerKey(snapshot.company), company: snapshot.company, role: snapshot.role, variantName: snapshot.variantName, contentHash: review.contentHash, snapshotJson: JSON.stringify(snapshot) } });
  await tx.applicationPackageEvent.create({ data: { packageId: row.id, kind: "RESERVED" } });
  return { id: row.id, snapshot };
}
export async function recordPackageOutcome(id: string, kind: "EXPORTED" | "SENT" | "FAILED", tx: Prisma.TransactionClient = prisma) {
  await tx.applicationPackageEvent.create({ data: { packageId: id, kind } });
}
/** Older Sent records contribute their available frozen copy, without pretending
 * that an exact historical export or Gmail delivery was observed by this feature. */
export async function backfillSentApplicationPackages(db?: Prisma.TransactionClient): Promise<number> {
  const client = db ?? prisma;
  const applications = await client.application.findMany({ where: { sentAt: { not: null }, packageSnapshots: { none: { events: { some: { kind: { in: ["SENT", "LEGACY_SENT"] } } } } } }, select: { id: true } });
  const store = async (tx: Prisma.TransactionClient, id: string) => {
    await lockForTransaction(tx, PACKAGE_LOCK);
    if (await tx.applicationPackageSnapshot.findFirst({ where: { applicationId: id, events: { some: { kind: { in: ["SENT", "LEGACY_SENT"] } } } } })) return;
    const snapshot = await captureApplicationPackage(id, tx);
    const contentHash = recordHash(snapshot);
    const row = await tx.applicationPackageSnapshot.upsert({ where: { contentHash }, update: {}, create: { applicationId: id, employerKey: employerKey(snapshot.company), company: snapshot.company, role: snapshot.role, variantName: snapshot.variantName, contentHash, snapshotJson: JSON.stringify(snapshot) } });
    await tx.applicationPackageEvent.create({ data: { packageId: row.id, kind: "LEGACY_SENT" } });
  };
  for (const application of applications) {
    if (db) await store(db, application.id);
    else await prisma.$transaction((tx) => store(tx, application.id));
  }
  return applications.length;
}
export function frozenPackageData(snapshot: ApplicationPackage) {
  const { photo, ...profile } = snapshot.profile;
  void photo;
  return {
    frozen: { profile, themes: { RESUME: snapshot.resume?.theme ?? null, COVER_LETTER: snapshot.letter?.theme ?? null }, paper: snapshot.paper, dateFormat: snapshot.dateFormat, includeReferences: snapshot.includeReferences, followedBase: snapshot.followedBase } as unknown as Prisma.InputJsonValue,
    sections: snapshot.sections as unknown as Prisma.InputJsonValue,
  };
}
export const packagePrintPath = (id: string, doc: "resume" | "letter") => `/print/package/${id}/${doc}`;
