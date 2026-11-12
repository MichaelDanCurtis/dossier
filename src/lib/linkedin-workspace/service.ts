import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { ActionError } from "@/lib/action";
import { isAiConfigured, loadAiSettingsView } from "@/lib/ai/config";
import { connectorDraftJob } from "@/lib/connector/draft";
import { startJob, findUnfinishedJobs, getJob, cancelJob } from "@/lib/jobs/runner";
import { LINKEDIN_CAREER_REVIEW_KEY } from "@/lib/linkedin-review/jobs";
import { prisma } from "@/lib/prisma";
import { recordHash } from "@/lib/record-hash";
import { currentLinkedinReview, linkedinCareerContext } from "@/lib/linkedin-review/data";
import { loadStudio, updateStudio } from "@/lib/studio/data";
import { workspaceJobReview, workspaceSourceReview, workspaceReplyDraft, workspacePublicist } from "./jobs";
import type { WorkspaceInput, WorkspaceItem } from "./schema";

function sourceUrl(value: string) {
  if (!value) return "";
  const url = new URL(value);
  if (url.protocol !== "https:" || !["www.linkedin.com", "linkedin.com"].includes(url.hostname) || url.username || url.password || url.port || !/^\/(?:feed\/update\/|posts\/|messaging\/thread\/)/.test(url.pathname)) throw new ActionError("Captured source links must be LinkedIn posts or conversation threads.");
  return `https://www.linkedin.com${url.pathname}`;
}
async function importItems(kind: "IMPORT_FEED" | "IMPORT_INBOX" | "IMPORT_THREAD", items: WorkspaceItem[]) {
  const prefix = kind === "IMPORT_FEED" ? "li-feed:" : kind === "IMPORT_THREAD" ? "li-thread:" : "li-preview:";
  return updateStudio(studio => {
    const imported = items.map(item => ({ id: prefix + recordHash(kind === "IMPORT_FEED" ? `${item.title}\n${item.text}` : item.key).slice(0, 40), title: item.title, text: ((kind === "IMPORT_INBOX" ? "LinkedIn inbox preview; this is not the full conversation.\n\n" : "") + item.text).slice(0, 6000), url: sourceUrl(item.url), kind: kind === "IMPORT_FEED" ? "POST" as const : "MESSAGE" as const, applicationId: "", createdAt: new Date().toISOString() }));
    if (studio.sources.length + imported.filter(item => !studio.sources.some(old => old.id === item.id)).length > 80) throw new ActionError("Your saved sources are full. Remove an old source in CareerAI before importing more.");
    for (const item of imported.toReversed()) { const old = studio.sources.find(row => row.id === item.id); if (old) { if (old.text !== item.text) delete old.analysis; Object.assign(old, item); } else studio.sources.unshift(item); }
    return { saved: imported.length, items: imported.map(({ id, title, url }) => ({ id, title, url })) };
  });
}

export async function handleWorkspace(input: WorkspaceInput, connectionId: string): Promise<unknown> {
  if (input.kind === "STATUS") {
    const [ai, ready, studio] = await Promise.all([loadAiSettingsView(), isAiConfigured(), loadStudio()]);
    return { aiReady: ready, model: ai.model, publicistModel: studio.publicist.model || ai.model, effort: studio.publicist.effort, chatRevision: studio.publicistChat.revision, chat: studio.publicistChat.messages.slice(-8), writeTools: false };
  }
  if (input.kind === "IMPORT_FEED" || input.kind === "IMPORT_INBOX") return importItems(input.kind, input.items);
  if (input.kind === "IMPORT_THREAD") return importItems(input.kind, [input.item]);
  const marker = (id: string) => `linkedinExtensionJob:${connectionId}:${id}`;
  if (input.kind === "JOB_RESULTS") {
    const [rows, career] = await Promise.all([prisma.posting.findMany({ where: { id: { in: input.postingIds }, source: "LINKEDIN", savedAt: { not: null }, dismissedAt: null } }), linkedinCareerContext()]);
    const applications = await prisma.application.findMany({ where: { postingUrl: { in: rows.map(row => row.url) } }, select: { id: true, postingUrl: true } });
    return { items: rows.map(row => ({ id: row.id, title: row.title, company: row.company, place: row.place, url: row.url, review: currentLinkedinReview(row.careerReviewJson, row, career.hash), applicationId: applications.find(application => application.postingUrl === row.url)?.id || null })) };
  }
  if (input.kind === "JOB_STATUSES") {
    for (const id of input.jobIds) if (!await prisma.setting.findUnique({ where: { key: marker(id) } })) throw new ActionError("One job did not originate from this connection.");
    return { jobs: await Promise.all(input.jobIds.map(async id => await getJob(id) || { id, type: "removed", status: "FAILED", step: null, error: "This task was removed. Your saved captures remain in CareerAI.", result: null })) };
  }
  if (input.kind === "JOB_STATUS" || input.kind === "CANCEL_JOB") {
    if (!await prisma.setting.findUnique({ where: { key: marker(input.jobId) } })) throw new ActionError("This job did not originate from this connection.");
    if (input.kind === "CANCEL_JOB") { await cancelJob(input.jobId); return { stopped: true }; }
    return { job: await getJob(input.jobId) };
  }
  if (!await isAiConfigured()) throw new ActionError("Your jobs are saved. Choose an AI provider in CareerAI before reviewing or drafting.");
  const requestKey = `linkedinExtensionRequest:${connectionId}:${input.requestId}`;
  const existing = await prisma.setting.findUnique({ where: { key: requestKey } });
  if (existing) { const value = JSON.parse(existing.value); if (value.jobId || value.applicationId) return value; throw new ActionError("CareerAI received this request already. Check its progress before starting another."); }
  // Claim before starting AI. A lost response cannot start a second paid job.
  try { await prisma.setting.create({ data: { key: requestKey, value: "{}" } }); }
  catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ActionError("This request is already being started. Check CareerAI."); throw error; }
  let jobId: string;
  if (input.kind === "REVIEW_JOBS") {
    const count = await prisma.posting.count({ where: { id: { in: input.postingIds }, source: "LINKEDIN", savedAt: { not: null }, complete: true, dismissedAt: null } });
    if (count !== new Set(input.postingIds).size) throw new ActionError("A selected job is no longer saved in this account.");
    if ((await findUnfinishedJobs(LINKEDIN_CAREER_REVIEW_KEY)).length) throw new ActionError("Another career review is running. Your collected jobs remain saved.");
    jobId = await startJob(workspaceJobReview, { postingIds: [...new Set(input.postingIds)] }, { key: LINKEDIN_CAREER_REVIEW_KEY });
  } else if (input.kind === "REVIEW_SOURCES") {
    jobId = await startJob(workspaceSourceReview, { sourceIds: [...new Set(input.sourceIds)] });
  } else if (input.kind === "REPLY_DRAFT") {
    jobId = await startJob(workspaceReplyDraft, { sourceId: input.sourceId });
  } else if (input.kind === "PUBLICIST_CHAT") {
    jobId = await startJob(workspacePublicist, { text: input.text, sourceIds: input.sourceIds, revision: (await loadStudio()).publicistChat.revision });
  } else {
    const posting = await prisma.posting.findFirst({ where: { id: input.postingId, source: "LINKEDIN", complete: true, savedAt: { not: null }, dismissedAt: null } });
    if (!posting) throw new ActionError("Choose a saved LinkedIn job in this workspace.");
    const application = await prisma.application.findFirst({ where: { postingUrl: posting.url }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (application) { await prisma.setting.update({ where: { key: requestKey }, data: { value: JSON.stringify({ applicationId: application.id }) } }); return { applicationId: application.id }; }
    jobId = await startJob(connectorDraftJob, { posting: `${posting.company}: ${posting.title}\n\n${posting.description}`, postingUrl: posting.url, postingId: posting.id, note: "Prepare a factual draft for the role I chose in LinkedIn. I will review and submit it myself." });
  }
  await prisma.$transaction([prisma.setting.create({ data: { key: marker(jobId), value: JSON.stringify({ requestId: input.requestId }) } }), prisma.setting.update({ where: { key: requestKey }, data: { value: JSON.stringify({ jobId }) } })]);
  return { jobId };
}
