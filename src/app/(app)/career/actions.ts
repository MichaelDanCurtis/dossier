"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { action } from "@/lib/action";
import { saveAgentSearch } from "@/lib/agent/searches";
import { addCareerAnswer, applyCareerProposal, changeCareerState, createCareerSession, currentCareerPreferences, retryCareerAnswer } from "@/lib/career/data";
import { careerKindSchema } from "@/lib/career/schema";
import "@/lib/career/jobs";
import { queueCommittedJob, retryJob } from "@/lib/jobs/runner";
import { opportunityInput } from "@/lib/career/opportunity-schema";
import { createOpportunity, startInterviewPractice } from "@/lib/career/opportunities";
import { createRepositorySession, listPublicRepositories, readPublicRepository, repositoryContextSchema, repositorySettingsSchema, saveRepositorySettings } from "@/lib/career/repositories";
import { publicistConfig } from "@/lib/studio/publicist-provider";
import { createProvider } from "@/lib/ai";

export const startCareerSession = action(z.object({ kind: careerKindSchema, title: z.string().trim().max(200) }), async ({ kind, title }) => {
  return { id: await createCareerSession(kind, title) };
});

export const prepareOpportunity = action(opportunityInput, async (input) => {
  const result = await createOpportunity(input);
  queueCommittedJob(result.jobId);
  revalidatePath("/career");
  return result;
});
export const beginInterviewPractice = action(z.object({ briefingId: z.string().min(1).max(150) }), async ({ briefingId }) => {
  const result = await startInterviewPractice(briefingId);
  revalidatePath("/career");
  return result;
});
export const discoverRepositories = action(z.object({ owner: z.string().max(39), page: z.number().int().min(1).max(50) }), async ({ owner, page }) => listPublicRepositories(owner, page));
export const chooseRepositoryModel = action(repositorySettingsSchema, async (input) => { await saveRepositorySettings(input); revalidatePath("/career"); return { saved: true }; });
export const repositoryModels = action(z.object({ connectionId: z.string().max(100) }), async ({ connectionId }) => createProvider(await publicistConfig(connectionId)).listModels(AbortSignal.timeout(15000)));
export const inspectRepository = action(z.object({ name: z.string().max(150) }), async ({ name }) => readPublicRepository(name));
export const analyzeRepository = action(z.object({ context: repositoryContextSchema, approved: z.literal(true) }), async ({ context }) => {
  // The preview is user-editable input; it is always labelled source material,
  // never used as verified personal evidence or as executable instructions.
  const result = await createRepositorySession(context);
  queueCommittedJob(result.jobId);
  revalidatePath("/career");
  return result;
});

export const answerCareerQuestion = action(z.object({ sessionId: z.string().min(1), revision: z.number().int().nonnegative(), requestId: z.uuid(), text: z.string().max(8000), finishing: z.boolean(), skip: z.boolean() }), async (input) => {
  const result = await addCareerAnswer(input);
  queueCommittedJob(result.jobId);
  revalidatePath("/career");
  return result;
});

export const retryCareerResponse = action(z.object({ sessionId: z.string() }), async ({ sessionId }) => {
  const result = await retryCareerAnswer(sessionId);
  if (result.retry) await retryJob(result.jobId);
  else queueCommittedJob(result.jobId);
  return result;
});

export const reviewCareerProposal = action(z.object({ id: z.string(), revision: z.number().int().nonnegative(), accept: z.boolean() }), async ({ id, revision, accept }) => {
  const result = await applyCareerProposal(id, revision, accept);
  revalidatePath("/career");
  revalidatePath("/profile");
  revalidatePath("/resume");
  return result;
});

export const setCareerSessionState = action(z.object({ id: z.string(), revision: z.number().int().nonnegative(), state: z.enum(["ACTIVE", "PAUSED", "FINISHED"]) }), async ({ id, revision, state }) => {
  await changeCareerState(id, revision, state);
  revalidatePath("/career");
  return { state };
});

export const saveCareerSearch = action(z.object({ index: z.number().int().min(0).max(2) }), async ({ index }) => {
  const preferences = await currentCareerPreferences();
  const suggestion = preferences?.searches[index];
  if (!suggestion) return { saved: false };
  await saveAgentSearch({ query: suggestion.query, name: suggestion.query.keywords.slice(0, 80) || "Career preferences", enabled: true });
  revalidatePath("/settings");
  return { saved: true };
});

export const saveCareerCheckIns = action(z.object({ cadence: z.enum(["off", "weekly", "monthly"]), paused: z.boolean() }), async ({ cadence, paused }) => {
  const { saveSettings } = await import("@/lib/settings-data");
  await saveSettings({ careerReviewCadence: cadence, careerReviewPaused: paused });
  revalidatePath("/career");
  return { saved: true };
});
