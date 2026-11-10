import { createHash } from "node:crypto";

/** Stable content identity; object key order is incidental, array order is meaningful. */
export function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry ?? null)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export const recordHash = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");
