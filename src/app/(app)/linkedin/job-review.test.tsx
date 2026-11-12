import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { ShownPosting } from "@/lib/job-search/search";
import type { JobView } from "@/lib/jobs/runner";
import type { LinkedinCareerReview, LinkedinReviewResult } from "@/lib/linkedin-review/schema";
import { LinkedinJobReview, type LinkedinReviewProps } from "./job-review";
import { reviewLinkedinCollection } from "./actions";

const fixture = vi.hoisted(() => ({ refresh: vi.fn(), prepare: vi.fn(), job: null as JobView | null, onChange: undefined as ((job: JobView) => void) | undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: fixture.refresh }) }));
vi.mock("@/hooks/use-job", () => ({ useJob: (_id: string, _revision: number, onChange: (job: JobView) => void) => { fixture.onChange = onChange; return fixture.job; } }));
vi.mock("@/components/toast", () => ({ toastResult: (result: unknown) => result }));
vi.mock("./actions", () => ({ reviewLinkedinCollection: vi.fn(async () => ({ ok: true, data: { jobId: "review-job" } })) }));
vi.mock("@/lib/jobs/actions", () => ({ cancel: vi.fn(async () => ({ ok: true })) }));
vi.mock("../jobs/use-start-application", () => ({ useStartApplication: () => ({ starting: null, start: fixture.prepare }) }));
const posting = (id: string): ShownPosting => ({ source: "LINKEDIN", externalId: id, title: id, company: "Example", place: "Remote", url: `https://www.linkedin.com/jobs/view/${id}/`, remote: true, salary: "", postedAt: null, via: "Chrome", description: "A complete job description.", complete: true, state: { postingId: id, saved: true, dismissed: false, applicationId: null, score: null } });
const assessment = (score: number): LinkedinCareerReview => ({ version: 1, score, recommendation: score > 80 ? "PURSUE" : "EXPLORE", summary: `Summary for ${score}`, careerFit: "Your customer-facing delivery work is relevant.", gaps: ["Confirm the product-specific requirements."], questions: ["What does success in six months look like?"], matches: [{ evidenceId: "experience:one", label: "Architect · Example", requirement: "Customer delivery", explanation: "Delivered customer projects." }], contextHash: "a".repeat(64), postingHash: "b".repeat(64), reviewedAt: "2026-11-11T00:00:00Z", model: "fixture-model", provider: "MOCK", truncated: false });
const props = (extra: Partial<LinkedinReviewProps> = {}): LinkedinReviewProps => ({ postings: [posting("unreviewed"), posting("possible"), posting("strongest")], today: "2026-11-11T00:00:00Z", latestReview: null, reviewLimit: 10, scoringIssue: null, reviews: { possible: assessment(60), strongest: assessment(92) }, modelName: "fixture-model", experienceCount: 12, projectCount: 2, hasPreferences: true, ...extra });
beforeEach(() => { vi.clearAllMocks(); fixture.job = null; fixture.onChange = undefined; });

it("ranks summaries by career fit and lets users focus on jobs needing review", async () => {
  const user = userEvent.setup(); render(<LinkedinJobReview {...props()} />);
  expect(screen.getAllByRole("heading", { level: 3 }).map(row => row.textContent)).toEqual(["strongest", "possible", "unreviewed"]);
  expect(screen.getByText("Summary for 92")).toBeInTheDocument();
  await user.selectOptions(screen.getByRole("combobox", { name: "Show" }), "unreviewed");
  expect(screen.getAllByRole("heading", { level: 3 }).map(row => row.textContent)).toEqual(["unreviewed"]);
  expect(reviewLinkedinCollection).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Prepare tailored résumé →" }));
  expect(fixture.prepare).toHaveBeenCalledWith(expect.objectContaining({ externalId: "unreviewed" }), expect.any(String));
});
it("starts an explicit scoped collection review and refreshes its persisted summaries", async () => {
  const user = userEvent.setup(); render(<LinkedinJobReview {...props({ collectionIds: ["unreviewed"] })} />);
  await user.click(screen.getByRole("button", { name: "Review 1 job with AI" }));
  expect(reviewLinkedinCollection).toHaveBeenCalledExactlyOnceWith({ postingIds: ["unreviewed"], force: false });
  expect(screen.getByRole("button", { name: "Reviewing jobs…" })).toBeDisabled();
  await act(async () => fixture.onChange?.({ id: "review-job", type: "linkedin-career-review", status: "DONE", step: null, error: null, result: null }));
  await waitFor(() => expect(fixture.refresh).toHaveBeenCalledTimes(1));
});
it("allows reassessing one role without silently rerunning every job", async () => {
  const user = userEvent.setup(); render(<LinkedinJobReview {...props()} />);
  const card = screen.getByRole("heading", { name: "strongest" }).closest("article")!;
  await user.click(within(card).getByRole("button", { name: "Review again" }));
  expect(reviewLinkedinCollection).toHaveBeenCalledExactlyOnceWith({ postingIds: ["strongest"], force: true });
});
it("resumes a running review and shows model failures without losing saved jobs", () => {
  const running: JobView<LinkedinReviewResult> = { id: "existing", type: "linkedin-career-review", status: "RUNNING", step: "Reviewing job 2", error: null, result: null };
  const { rerender } = render(<LinkedinJobReview {...props({ latestReview: running })} />);
  expect(screen.getByRole("status")).toHaveTextContent("Reviewing job 2");
  expect(screen.getByRole("button", { name: "Stop review" })).toBeEnabled();
  fixture.job = { ...running, status: "FAILED", error: "Your AI provider needs its key." };
  rerender(<LinkedinJobReview {...props({ latestReview: running })} />);
  expect(screen.getByRole("status")).toHaveTextContent("Your AI provider needs its key.");
});
it("keeps missing collections private and labels an existing draft as an application record", () => {
  const saved = posting("draft"); saved.state.applicationId = "existing-draft";
  const { rerender } = render(<LinkedinJobReview {...props({ postings: [saved] })} />);
  expect(screen.getByRole("link", { name: "Open résumé / application" })).toHaveAttribute("href", "/applications/existing-draft");
  expect(screen.getByText(/preparing a résumé does not submit it/)).toBeInTheDocument();
  rerender(<LinkedinJobReview {...props({ invalidCollection: true })} />);
  expect(screen.queryAllByRole("article")).toHaveLength(0);
  expect(screen.getByText(/This collection is not available in this account/)).toBeInTheDocument();
});
