import { describe, expect, it } from "vitest";
import { annualRange, studioSchema } from "./schema";

describe("annual career comparisons", () => {
  it.each(["USD 120,000–160,000/year", "USD 120k to USD 160k per year", "usd 120000-160000 a year"])("compares explicitly annual same-currency ranges: %s", (text) => {
    expect(annualRange(text, "USD")).toEqual({ min: 120000, max: 160000 });
  });
  it.each(["$120k–160k", "CAD 120k–160k/year", "USD 120k–CAD 160k/year", "USD 50 an hour", "USD 160k–120k/year", "USD 1,2,3/year", "USD 120k–160k/year total", "USD 120k–160k a year (estimated)"])("does not manufacture comparable pay from %s", (text) => {
    expect(annualRange(text, "USD")).toBeNull();
  });
  it("starts private monitoring off and bounds stored sources", () => {
    expect(studioSchema.parse({})).toMatchObject({ newsAuto: false, drafts: [], sources: [], watch: { stage: "SEARCHING", annualBase: 0 } });
    expect(studioSchema.safeParse({ sources: Array(81).fill({}) }).success).toBe(false);
  });
});
