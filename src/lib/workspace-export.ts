import "server-only";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { careerKindSchema, careerProposalSchema } from "@/lib/career/schema";
import { applicationPackageSchema } from "@/lib/application-package";
import { isPhotoDataUrl, PHOTO_MAX_LENGTH } from "@/lib/photo";
import { variantSelectionSchema, variantOverridesSchema } from "@/lib/resume-variants";
import { lockForTransaction } from "@/lib/db-lock";
import { recordHash } from "@/lib/record-hash";

const text = z.string();
const date = z.iso.datetime().transform((value) => new Date(value));
const maybeDate = date.nullable();
const int = z.number().int().nonnegative();
const json = text.refine((value) => { try { JSON.parse(value); return true; } catch { return false; } }, "Invalid stored JSON.");
const session = z.object({ id: text, kind: careerKindSchema, title: text, state: z.enum(["ACTIVE", "REVIEW", "PAUSED", "FINISHED"]), revision: int, contextJson: json, linkedRecordId: text.nullable(), periodKey: text.nullable(), createdAt: date, updatedAt: date });
const message = z.object({ id: text, sessionId: text, ordinal: int, role: z.enum(["user", "assistant"]), origin: text, text, requestId: text.nullable(), replyToId: text.nullable(), finishing: z.boolean(), promptVersion: text.nullable(), createdAt: date });
const proposal = z.object({ id: text, sessionId: text, generationKey: text, ordinal: int, kind: text, status: z.enum(["PENDING", "ACCEPTED", "REJECTED", "SUPERSEDED"]), schemaVersion: z.literal(1), dataJson: json, sourceMessageIdsJson: json, baselineHash: text.nullable(), appliedRecordId: text.nullable(), revision: int, acceptedAt: maybeDate, createdAt: date, updatedAt: date }).refine((row) => careerProposalSchema.safeParse({ kind: row.kind, data: JSON.parse(row.dataJson) }).success, "Unknown career proposal.");
const storedJson = (schema: z.ZodType) => text.refine((value) => { try { return schema.safeParse(JSON.parse(value)).success; } catch { return false; } }, "Invalid stored resume data.");
const variant = z.object({ id: text, name: text, focus: text, selectionJson: storedJson(variantSelectionSchema), overridesJson: storedJson(variantOverridesSchema), revision: int, createdAt: date, updatedAt: date });
const variantVersion = z.object({ id: text, variantId: text, revision: int, name: text, focus: text, selectionJson: storedJson(variantSelectionSchema), overridesJson: storedJson(variantOverridesSchema), cause: text, createdAt: date });
const packageSnapshot = z.object({ id: text, applicationId: text.nullable(), employerKey: text, company: text, role: text, variantName: text.nullable(), contentHash: text.regex(/^[a-f0-9]{64}$/), schemaVersion: z.literal(1), snapshotJson: json, createdAt: date });
const packageEvent = z.object({ id: text, packageId: text, kind: z.enum(["RESERVED", "EXPORTED", "SENT", "FAILED", "LEGACY_SENT"]), createdAt: date });
const board = z.object({ id: text, platform: z.enum(["greenhouse", "lever", "ashby"]), region: z.enum(["global", "us", "eu"]), boardToken: text.regex(/^[a-zA-Z0-9_-]{1,100}$/), company: text, enabled: z.boolean(), intervalHours: z.number().int().min(1).max(168), createdAt: date, updatedAt: date });

/** Versioned private history. Public feed caches and active work are deliberately rebuildable. */
export const workspaceExportSchema = z.object({
  career: z.object({ sessions: z.array(session), messages: z.array(message), proposals: z.array(proposal) }),
  resumes: z.object({ variants: z.array(variant), versions: z.array(variantVersion), packages: z.array(packageSnapshot), events: z.array(packageEvent), photoAssets: z.array(z.object({ hash: text.regex(/^[a-f0-9]{64}$/), src: text.max(PHOTO_MAX_LENGTH).refine(isPhotoDataUrl) })).default([]) }),
  companyBoards: z.array(board),
});
export type WorkspaceExport = z.infer<typeof workspaceExportSchema>;

export async function buildWorkspaceExport(tx: Prisma.TransactionClient): Promise<WorkspaceExport> {
  const [sessions, messages, proposals, variants, versions, packages, events, companyBoards] = await Promise.all([
    tx.careerSession.findMany({ orderBy: { createdAt: "asc" } }),
    tx.careerMessage.findMany({ omit: { jobId: true }, orderBy: [{ sessionId: "asc" }, { ordinal: "asc" }] }),
    tx.careerProposal.findMany({ orderBy: { createdAt: "asc" } }),
    tx.resumeVariant.findMany({ orderBy: { createdAt: "asc" } }),
    tx.resumeVariantVersion.findMany({ orderBy: { createdAt: "asc" } }),
    tx.applicationPackageSnapshot.findMany({ orderBy: { createdAt: "asc" } }),
    tx.applicationPackageEvent.findMany({ orderBy: { createdAt: "asc" } }),
    tx.companyBoard.findMany({ select: { id: true, platform: true, region: true, boardToken: true, company: true, enabled: true, intervalHours: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: "asc" } }),
  ]);
  // Validate on serialization too, so corrupt history cannot become an un-restorable backup.
  // The exact photo is immutable, but a backup carries each image only once.
  // Without this, a 700 kB photo repeated in twenty packages exceeds the import limit.
  const photos = new Map<string, string>();
  const compact = packages.map((row) => {
    const snapshot = applicationPackageSchema.parse(JSON.parse(row.snapshotJson));
    if (snapshot.profile.photo) {
      const hash = recordHash(snapshot.profile.photo.src);
      photos.set(hash, snapshot.profile.photo.src);
      snapshot.profile.photo.src = `dossier-photo:${hash}`;
    }
    return { ...row, snapshotJson: JSON.stringify(snapshot) };
  });
  return workspaceExportSchema.parse(JSON.parse(JSON.stringify({ career: { sessions, messages, proposals }, resumes: { variants, versions, packages: compact, events, photoAssets: [...photos].map(([hash, src]) => ({ hash, src })) }, companyBoards })));
}

export async function clearWorkspace(tx: Prisma.TransactionClient): Promise<void> {
  // Same order as Career → variant updates. Import/wipe fences every new writer.
  for (const key of [1128354373, 1381190981, 1346454347, 1146244946]) await lockForTransaction(tx, key);
  await tx.careerSession.deleteMany();
  await tx.resumeVariant.deleteMany();
  await tx.applicationPackageSnapshot.deleteMany();
  await tx.companyBoard.deleteMany();
}

export async function restoreWorkspace(tx: Prisma.TransactionClient, input: WorkspaceExport | undefined): Promise<void> {
  if (!input) return;
  await tx.careerSession.createMany({ data: input.career.sessions });
  await tx.careerMessage.createMany({ data: input.career.messages });
  await tx.careerProposal.createMany({ data: input.career.proposals });
  await tx.resumeVariant.createMany({ data: input.resumes.variants });
  await tx.resumeVariantVersion.createMany({ data: input.resumes.versions });
  const photos = new Map(input.resumes.photoAssets.map((asset) => {
    if (recordHash(asset.src) !== asset.hash) throw new Error("A saved package photo failed its integrity check.");
    return [asset.hash, asset.src];
  }));
  await tx.applicationPackageSnapshot.createMany({ data: input.resumes.packages.map((row) => {
    const snapshot = applicationPackageSchema.parse(JSON.parse(row.snapshotJson));
    if (snapshot.profile.photo?.src.startsWith("dossier-photo:")) {
      const src = photos.get(snapshot.profile.photo.src.slice("dossier-photo:".length));
      if (!src) throw new Error("A saved package photo is missing from this backup.");
      snapshot.profile.photo.src = src;
    }
    if (recordHash(snapshot) !== row.contentHash) throw new Error("A saved package failed its content integrity check.");
    return { ...row, snapshotJson: JSON.stringify(snapshot) };
  }) });
  await tx.applicationPackageEvent.createMany({ data: input.resumes.events });
  // No validator, snapshot, lease, missing counter or enrichment cursor crosses an import.
  await tx.companyBoard.createMany({ data: input.companyBoards });
}
