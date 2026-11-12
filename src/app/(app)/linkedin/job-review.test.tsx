import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { ShownPosting } from "@/lib/job-search/search";
import type { JobView } from "@/lib/jobs/runner";
import type { AgentScanResult } from "@/lib/agent/run";
import { LinkedinJobReview, type LinkedinReviewProps } from "./job-review";
import { scoreImportedLinkedin } from "../agent/studio-actions";

const fixture = vi.hoisted(() => ({ refresh: vi.fn(), job: null as JobView | null, onChange: undefined as ((job: JobView) => void) | undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: fixture.refresh }) }));
vi.mock("@/hooks/use-job", () => ({ useJob: (_id: string, _revision: number, onChange: (job: JobView) => void) => { fixture.onChange = onChange; return fixture.job; } }));
vi.mock("@/components/toast", () => ({ toastResult: (result: unknown) => result }));
vi.mock("../agent/studio-actions", () => ({ scoreImportedLinkedin: vi.fn(async () => ({ ok: true, data: { jobId: "review-job" } })) }));
vi.mock("@/lib/jobs/actions", () => ({ cancel: vi.fn(async () => ({ ok: true })) }));
vi.mock("../jobs/posting-results", () => ({ PostingResults: ({ postings, startLabel, emptyMessage }: { postings: ShownPosting[]; startLabel: string; emptyMessage: string }) => <div><ol aria-label="Ranked jobs">{postings.map((posting) => <li key={posting.externalId}>{posting.title}</li>)}</ol>{!postings.length && <p>{emptyMessage}</p>}{postings.length > 0 && <button>{startLabel}</button>}</div> }));

const posting = (id: string, score?: number): ShownPosting => ({ source: "LINKEDIN", externalId: id, title: id, company: "Example", place: "Remote", url: `https://www.linkedin.com/jobs/view/${id}/`, remote: true, salary: "", postedAt: null, via: "Chrome", description: "A complete job description.", complete: true, state: { postingId: id, saved: true, dismissed: false, applicationId: null, score: score === undefined ? null : { score, reasons: ["Relevant experience"], redFlags: [] } } });
const props = (extra: Partial<LinkedinReviewProps> = {}): LinkedinReviewProps => ({ postings: [posting("unreviewed"), posting("possible", 60), posting("strongest", 92)], today: "2026-11-11T00:00:00Z", latestReview: null, reviewLimit: 10, scoringIssue: null, ...extra });
beforeEach(() => { vi.clearAllMocks(); fixture.job = null; fixture.onChange = undefined; });

it("ranks jobs by fit and lets users focus on jobs still needing review", async () => {
  const user = userEvent.setup(); render(<LinkedinJobReview {...props()} />);
  expect(screen.getAllByRole("listitem").map((row) => row.textContent)).toEqual(["strongest", "possible", "unreviewed"]);
  await user.selectOptions(screen.getByRole("combobox", { name: "Show" }), "unreviewed");
  expect(screen.getAllByRole("listitem").map((row) => row.textContent)).toEqual(["unreviewed"]);
  expect(screen.getByRole("button", { name: "Prepare tailored résumé →" })).toBeInTheDocument();
  expect(scoreImportedLinkedin).not.toHaveBeenCalled();
});

it("starts one explicit review and refreshes explanations when it completes", async () => {
  const user = userEvent.setup(); render(<LinkedinJobReview {...props()} />);
  await user.click(screen.getByRole("button", { name: "Review 1 job with AI" }));
  expect(scoreImportedLinkedin).toHaveBeenCalledExactlyOnceWith({});
  expect(screen.getByRole("button", { name: "Reviewing jobs…" })).toBeDisabled();
  await act(async () => fixture.onChange?.({ id: "review-job", type: "linkedin-score", status: "DONE", step: null, error: null, result: null }));
  await waitFor(() => expect(fixture.refresh).toHaveBeenCalledTimes(1));
});

it("resumes a running review after a page reload and shows a failed review clearly", () => {
  const running: JobView<AgentScanResult> = { id: "existing", type: "linkedin-score", status: "RUNNING", step: "Reading job 2", error: null, result: null };
  const { rerender } = render(<LinkedinJobReview {...props({ latestReview: running })} />);
  expect(screen.getByRole("status")).toHaveTextContent("Reading job 2");
  expect(screen.getByRole("button", { name: "Reviewing jobs…" })).toBeDisabled();
  fixture.job = { ...running, status: "FAILED", error: "The selected scorer needs its API key." };
  rerender(<LinkedinJobReview {...props({ latestReview: running })} />);
  expect(screen.getByRole("status")).toHaveTextContent("The selected scorer needs its API key.");
});

it("shows a useful first step when empty and blocks review without a configured scorer", () => {
  const { rerender } = render(<LinkedinJobReview {...props({ postings: [] })} />);
  expect(screen.getByText(/No LinkedIn jobs saved yet/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Connect Chrome / save jobs" })).toHaveAttribute("href", "/linkedin?section=extension");
  rerender(<LinkedinJobReview {...props({ scoringIssue: "Choose an AI provider first." })} />);
  expect(screen.getByRole("button", { name: "Review 1 job with AI" })).toBeDisabled();
  expect(screen.getByRole("link", { name: "Set up job scoring" })).toBeInTheDocument();
});
