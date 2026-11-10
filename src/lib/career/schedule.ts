import "server-only";

import { dayOf, startOfWeek } from "@/lib/calendar-view";
import { lockForTransaction } from "@/lib/db-lock";
import { queueCommittedJob } from "@/lib/jobs/runner";
import { logServerError } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { loadSettings } from "@/lib/settings-data";
import { lastKnownTimeZone } from "@/lib/time-zone";

import { careerJobKey } from "./data";
import "./jobs";
import { careerReviewContext } from "./review-context";

/** Only the current local period is eligible: no backlog of missed AI calls. */
export function careerReviewPeriod(now: Date, cadence: "off" | "weekly" | "monthly", timeZone: string): string | null {
  if (cadence === "off") return null;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now));
  if (hour < 9) return null;
  const day = dayOf(now, timeZone);
  return `${cadence}:${cadence === "weekly" ? startOfWeek(day) : day.slice(0, 7)}`;
}

/** The period, saved request and job are committed together before enqueueing. */
export async function prepareDueCareerReview(now = new Date()): Promise<{ sessionId: string; jobId: string } | null> {
  const zone = await lastKnownTimeZone();
  const settings = await loadSettings();
  const period = careerReviewPeriod(now, settings.careerReviewCadence, zone);
  if (!period || settings.careerReviewPaused) return null;
  const contextJson = await careerReviewContext();
  return prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, 1128354373);
    const current = await loadSettings(tx);
    if (current.careerReviewPaused || current.careerReviewCadence !== settings.careerReviewCadence) return null;
    if (await tx.careerSession.findUnique({ where: { periodKey: period } })) return null;
    // Changing cadence or time zone must not generate a burst of new reviews.
    if (await tx.careerSession.findFirst({ where: { periodKey: { not: null }, createdAt: { gt: new Date(now.getTime() - 6 * 86400000) } } })) return null;
    const session = await tx.careerSession.create({ data: { kind: "REVIEW", title: `Career check-in · ${dayOf(now, zone)}`, periodKey: period, contextJson, createdAt: now, revision: 1 } });
    const message = await tx.careerMessage.create({ data: { sessionId: session.id, ordinal: 0, role: "user", origin: "SCHEDULE", text: "Prepare this period's check-in from the confirmed profile, accepted updates and saved opportunities. Summarize changes, offer next steps and ask one useful question. Do not propose profile changes without a new user answer. Do not claim a fresh search or external synchronization.", requestId: period, finishing: false } });
    const job = await tx.job.create({ data: { type: "career-turn", key: careerJobKey(session.id), input: { sessionId: session.id, messageId: message.id, finishing: false } } });
    await tx.careerMessage.update({ where: { id: message.id }, data: { jobId: job.id } });
    return { sessionId: session.id, jobId: job.id };
  });
}

const scheduleGlobal = globalThis as unknown as { dossierCareerTimer?: ReturnType<typeof setInterval> };
export function startCareerSchedule() {
  if (scheduleGlobal.dossierCareerTimer) return;
  const check = async () => { const due = await prepareDueCareerReview(); if (due) queueCommittedJob(due.jobId); };
  const run = () => void check().catch((error: unknown) => logServerError("career check-in", error));
  scheduleGlobal.dossierCareerTimer = setInterval(run, 15 * 60 * 1000);
  scheduleGlobal.dossierCareerTimer.unref?.();
  run();
}
