import { z } from "zod";

const id = z.string().min(1).max(100);
const item = z.object({ key: z.string().min(1).max(1000), title: z.string().min(1).max(200), text: z.string().min(1).max(6000), url: z.string().max(2000).default("") }).strict();
export const workspaceInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("STATUS") }).strict(),
  z.object({ kind: z.literal("IMPORT_FEED"), items: z.array(item).max(20) }).strict(),
  z.object({ kind: z.literal("IMPORT_INBOX"), items: z.array(item).max(20) }).strict(),
  z.object({ kind: z.literal("IMPORT_THREAD"), item }).strict(),
  z.object({ kind: z.literal("REVIEW_JOBS"), requestId: z.uuid(), postingIds: z.array(id).min(1).max(50) }).strict(),
  z.object({ kind: z.literal("REVIEW_SOURCES"), requestId: z.uuid(), sourceIds: z.array(id).min(1).max(20) }).strict(),
  z.object({ kind: z.literal("REPLY_DRAFT"), requestId: z.uuid(), sourceId: id }).strict(),
  z.object({ kind: z.literal("PUBLICIST_CHAT"), requestId: z.uuid(), text: z.string().trim().min(1).max(6000), sourceIds: z.array(id).max(6) }).strict(),
  z.object({ kind: z.literal("PREPARE_RESUME"), requestId: z.uuid(), postingId: id }).strict(),
  z.object({ kind: z.literal("JOB_STATUS"), jobId: id }).strict(),
  z.object({ kind: z.literal("JOB_STATUSES"), jobIds: z.array(id).min(1).max(8) }).strict(),
  z.object({ kind: z.literal("JOB_RESULTS"), postingIds: z.array(id).max(50) }).strict(),
  z.object({ kind: z.literal("CANCEL_JOB"), jobId: id }).strict(),
]);
export type WorkspaceInput = z.infer<typeof workspaceInput>;
export type WorkspaceItem = z.infer<typeof item>;
