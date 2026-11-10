import "server-only";

import { loadResumeContext } from "@/lib/resume-variant-data";
import { resumeCoach, RESUME_COACH_VERSION } from "@/lib/ai/tasks/resume-coach";

import { z } from "zod";
import { withAiRequestBudget } from "@/lib/ai/request-budget";
import { getAiProvider } from "@/lib/ai";
import { loadTaskOptions } from "@/lib/ai/task-options";
import { careerInterview, CAREER_INTERVIEW_VERSION } from "@/lib/ai/tasks/career-interview";
import { lockForTransaction } from "@/lib/db-lock";
import { defineJob } from "@/lib/jobs/runner";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";

import { currentCareerPreferences, proposalBaseline } from "./data";
import { careerKindSchema } from "./schema";

export const careerTurnJob = defineJob({
  type: "career-turn",
  input: z.object({ sessionId: z.string(), messageId: z.string(), finishing: z.boolean() }),
  result: z.object({ sessionId: z.string() }),
  async run({ sessionId, messageId, finishing }, { id: jobId, step, signal }) {
    const session = await prisma.careerSession.findUniqueOrThrow({ where: { id: sessionId }, include: { messages: { orderBy: { ordinal: "asc" } } } });
    const message = session.messages.find((row) => row.id === messageId && row.role === "user");
    if (message && message.jobId !== jobId) throw new Error("This saved answer was replaced or restored. Retry its current response.");
    if (!message) throw new Error("The saved answer no longer exists.");
    if (session.messages.some((row) => row.replyToId === messageId)) return { sessionId };
    await step(finishing ? "Preparing your career review" : "Thinking about your answer");
    const [provider, options, profile, preferences] = await Promise.all([getAiProvider(), loadTaskOptions(), loadProfile(), currentCareerPreferences()]);
    const coachContext = session.kind === "COACH" ? await loadResumeContext(session.linkedRecordId ?? undefined) : null;
    const generate = async () => session.kind === "COACH" ? await resumeCoach(provider, { context: coachContext!, history: session.messages.filter((row) => row.ordinal <= message.ordinal), finishing }, { ...options, signal }) : await careerInterview(provider, { kind: careerKindSchema.parse(session.kind), title: session.title, profile, history: session.messages.filter((row) => row.ordinal <= message.ordinal), finishing, preferences, reviewContext: session.kind === "REVIEW" ? session.contextJson : undefined }, { ...options, signal });
    const answer = message.origin === "SCHEDULE" ? await withAiRequestBudget(2, 2048, generate) : await generate();
    if (signal.aborted) throw signal.reason;
    await step("Saving the next question and proposals");
    if (session.kind !== "COACH" && answer.proposals.some((item) => item.proposal.kind === "RESUME_EDIT")) throw new Error("Use the resume coach for changes to resume wording.");
    const baselines = answer.proposals.map(({ proposal }) => proposalBaseline(proposal, profile));
    const validEvidence = new Set(session.messages.filter((row) => row.role === "user" && row.origin === "USER").map((row) => row.id));
    if (answer.proposals.some((item) => !item.evidenceMessageIds.length || item.evidenceMessageIds.some((id) => !validEvidence.has(id)))) throw new Error("Proposed evidence must refer to the user's saved answers.");
    await prisma.$transaction(async (tx) => {
      await lockForTransaction(tx, 1128354373);
      if (await tx.careerMessage.findUnique({ where: { replyToId: messageId } })) return;
      if (!(await tx.careerMessage.findFirst({ where: { id: messageId, sessionId, jobId } }))) throw new Error("This saved answer was replaced or restored. Its previous response was discarded.");
      const current = await tx.careerSession.findUniqueOrThrow({ where: { id: sessionId } });
      const last = await tx.careerMessage.findFirstOrThrow({ where: { sessionId }, orderBy: { ordinal: "desc" } });
      await tx.careerMessage.create({ data: { sessionId, ordinal: last.ordinal + 1, role: "assistant", origin: "AI", replyToId: messageId, promptVersion: session.kind === "COACH" ? RESUME_COACH_VERSION : CAREER_INTERVIEW_VERSION, text: [answer.reply, answer.question].filter(Boolean).join("\n\n") || "Your answers are ready to review." } });
      for (let ordinal = 0; ordinal < answer.proposals.length; ordinal++) {
        const { proposal: payload, evidenceMessageIds } = answer.proposals[ordinal];
        if (payload.kind === "PREFERENCES") await tx.careerProposal.updateMany({ where: { sessionId, kind: "PREFERENCES", status: "PENDING" }, data: { status: "SUPERSEDED", revision: { increment: 1 } } });
        await tx.careerProposal.create({ data: { sessionId, generationKey: messageId, ordinal, kind: payload.kind, dataJson: JSON.stringify(payload.data), sourceMessageIdsJson: JSON.stringify([...new Set(evidenceMessageIds)]), baselineHash: baselines[ordinal] } });
      }
      await tx.careerSession.update({ where: { id: sessionId }, data: { revision: { increment: 1 }, state: current.state === "PAUSED" || current.state === "FINISHED" ? current.state : answer.readyForReview || finishing ? "REVIEW" : "ACTIVE" } });
    });
    return { sessionId };
  },
});
