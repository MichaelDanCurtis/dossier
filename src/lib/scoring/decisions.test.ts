import { describe, expect, it, vi } from "vitest";
import { demoProfile } from "@/lib/demo-profile";
import { askDecisions, decisionsAnswers, decisionsQuestions, DECISIONS_URL, scoreWithDecisions } from "./decisions";
import { jevQuestions } from "./jev";

const questions = jevQuestions(["Experience with Figma"]);
const responseFor = (questionsToAnswer = questions) => ({
  model: "gpt-6-luna",
  answers: Object.entries(questionsToAnswer).map(([name, question]) => question.type === "noul" ? { name, type: "predicate", probability: name === "line0Shown" ? 0.95 : 0.05 } : question.type === "choice" ? { name, type: "choice", choice: "required", confidence: 0.9, probabilities: [{ value: "required", probability: 0.9 }, { value: "other", probability: 0.1 }] } : { name, type: "score", score: question.criteria.length - 1, confidence: 0.9, probabilities: [{ value: question.criteria.length - 1, label: String(question.criteria.length - 1), probability: 1 }] }),
  usage: { input_tokens: 80, output_tokens: 0 },
});

describe("OpenAI Decisions scoring", () => {
  it("uses the documented score levels, named predicates and fixed choices", () => {
    const converted = decisionsQuestions(questions);
    expect(converted.find((q) => q.name === "requirements")).toMatchObject({ type: "score", levels: expect.arrayContaining([{ label: "4", description: expect.stringContaining("Every core requirement") }]) });
    expect(converted.find((q) => q.name === "place")).toMatchObject({ type: "predicate", instructions: expect.stringContaining("True:") });
    expect(converted.find((q) => q.name === "line0Kind")).toMatchObject({ type: "choice", choices: expect.arrayContaining([{ value: "required", description: expect.any(String) }]) });
  });

  it("refuses refusals, duplicates, missing answers, invalid choices, and out-of-range scores", () => {
    const original = responseFor();
    const malformed = [
      { ...original, answers: original.answers.slice(1) },
      { ...original, answers: [original.answers[0], ...original.answers.slice(0, -1)] },
      { ...original, answers: original.answers.map((a) => a.name === "requirements" ? { name: a.name, type: "refusal" } : a) },
      { ...original, answers: original.answers.map((a) => a.name === "requirements" ? { ...a, score: 20 } : a) },
      { ...original, answers: original.answers.map((a) => a.name === "place" ? { ...a, probability: -0.5 } : a) },
      { ...original, answers: original.answers.map((a) => a.name === "line0Kind" ? { ...a, choice: "invented" } : a) },
    ];
    for (const value of malformed) expect(() => decisionsAnswers(value, questions)).toThrow("couldn't answer all scoring questions");
    expect(decisionsAnswers(original, questions).answers.line0Shown).toEqual({ type: "noul", noul: 0.95 });
  });

  it("sends redacted profile evidence only to OpenAI and records the returned usage", async () => {
    const profile = demoProfile();
    const onUsage = vi.fn();
    let sent: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (url, options) => {
      expect(url).toBe(DECISIONS_URL);
      expect(options?.redirect).toBe("error");
      expect(options?.headers).toMatchObject({ authorization: "Bearer test-only-key" });
      sent = JSON.parse(String(options?.body));
      const body = sent as { questions: { name: string; type: string; levels?: unknown[] }[] };
      const answer = responseFor();
      answer.answers = body.questions.map((question) => responseFor(questions).answers.find((item) => item.name === question.name)!).filter(Boolean);
      return Response.json(answer);
    }) as typeof fetch;
    const result = await scoreWithDecisions({ title: "Designer", company: "Example", place: "", remote: true, salary: "", description: "Experience with Figma" }, profile, { key: "test-only-key", fetchImpl, onUsage });
    expect(result.data).toMatchObject({ score: 100, reasons: expect.arrayContaining(["Covers: Experience with Figma"]) });
    expect(result.scoredWith).toContain("openai-decisions");
    const body = JSON.stringify(sent);
    expect(body).not.toContain(profile.basics.name);
    expect(body).not.toContain(profile.basics.email);
    expect(onUsage).toHaveBeenCalledWith({ task: "score-posting-decisions", provider: "OPENAI_DECISIONS", model: "gpt-6-luna", input: 80, output: 0 });
  });

  it("handles authentication errors without exposing response bodies and retries bounded rate limits", async () => {
    await expect(askDecisions({ state: {}, questions }, { key: "test", fetchImpl: vi.fn(async () => new Response('secret echoed by provider', { status: 401 })) as typeof fetch })).rejects.toThrow("OpenAI didn't accept the key");
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(Response.json(responseFor()));
    expect((await askDecisions({ state: {}, questions }, { key: "test", fetchImpl, retryDelaysMs: [1] })).model).toBe("gpt-6-luna");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
