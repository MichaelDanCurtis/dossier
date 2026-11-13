import { beforeEach, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ verify: vi.fn(), title: vi.fn() }));
vi.mock("@/components/documents/resume-document", () => ({ ResumeDocument: () => null }));
vi.mock("@/lib/pdf/print-access", () => ({ verifyPrintAccess: access.verify }));
vi.mock("@/lib/pdf/print-title", () => ({ printMetadata: access.title }));
vi.mock("@/lib/resume-variant-data", () => ({ loadResumeContext: vi.fn() }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: vi.fn() }));
vi.mock("@/lib/theme-data", () => ({ loadTheme: vi.fn() }));
import { generateMetadata } from "@/app/print/base/page";

beforeEach(() => {
  access.verify.mockReset().mockResolvedValue(undefined);
  access.title.mockReset().mockResolvedValue({ title: { absolute: "Sample Person – Resume" } });
});
it("uses the exact variant and fit print grant before reading metadata", async () => {
  const metadata = await generateMetadata({ searchParams: Promise.resolve({ variant: "cloud-work", fit: "2" }), params: Promise.resolve({}) });
  expect(access.verify).toHaveBeenCalledWith("/print/base?fit=2&variant=cloud-work");
  expect(access.title).toHaveBeenCalledWith("RESUME");
  expect(metadata.title).toEqual({ absolute: "Sample Person – Resume" });
});
it("does not disclose a profile name when the print grant is refused", async () => {
  access.verify.mockRejectedValueOnce(new Error("Print access refused"));
  await expect(generateMetadata({ searchParams: Promise.resolve({ variant: "private-variant" }), params: Promise.resolve({}) })).rejects.toThrow("Print access refused");
  expect(access.title).not.toHaveBeenCalled();
});
