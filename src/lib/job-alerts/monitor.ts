import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ActionError } from "@/lib/action";
import { googleConnection, loadGoogleAccount } from "@/lib/google/account";
import { alertLabels, getAlertBody, listAlertPage } from "@/lib/google/gmail";
import { logServerError } from "@/lib/log";
import { parseAlert } from "./parse";

const HOUR = 3600000;
const id = "linkedin";

export async function configureAlerts(label: string | null) {
  if (!label) {
    await prisma.jobAlertMonitor.updateMany({ where: { id }, data: { enabled: false, revision: randomUUID() } });
    return;
  }
  const google = await googleConnection();
  if (google.status !== "connected" || !google.canRead || google.signInProblem) throw new ActionError("Connect Gmail with read access in Google settings first.");
  const labels = await alertLabels();
  const selected = labels.find(item => item.name.toLowerCase() === label.trim().toLowerCase());
  if (!selected) throw new ActionError("That label was not found in the connected Gmail account.");
  const config = { mailbox: google.email, labelId: selected.id, labelName: selected.name, enabled: true, revision: randomUUID(), nextCheckAt: new Date(), checkedAt: null, lastAlertAt: null, problem: null };
  await prisma.jobAlertMonitor.upsert({ where: { id }, create: { id, ...config }, update: config });
}

export async function checkAlerts(now = new Date()) {
  const monitor = await prisma.jobAlertMonitor.findUnique({ where: { id } });
  if (!monitor?.enabled || monitor.nextCheckAt > now) return;
  const revision = randomUUID();
  const claim = await prisma.jobAlertMonitor.updateMany({ where: { id, enabled: true, revision: monitor.revision, nextCheckAt: { lte: now } }, data: { revision, nextCheckAt: new Date(+now + HOUR) } });
  if (!claim.count) return;
  const owner = { id, enabled: true, revision };
  const signal = AbortSignal.timeout(240000);
  try {
    const account = await loadGoogleAccount();
    if (account?.email !== monitor.mailbox) throw new ActionError("The connected mailbox changed. Choose the alerts label again.");
    // Replay a day of overlap for delayed delivery and newly labelled messages.
    const since = monitor.checkedAt ? +monitor.checkedAt - 24 * HOUR : +now - 30 * 24 * HOUR;
    let latest = monitor.lastAlertAt;
    let pageToken: string | undefined;
    do {
      const page = await listAlertPage(monitor.labelId, Math.floor(since / 1000), Math.ceil(+now / 1000) + 1, pageToken, signal);
      for (const { id: messageId } of page.messages ?? []) {
        const key = { mailbox: monitor.mailbox, messageId };
        const prior = await prisma.jobAlertReceipt.findUnique({ where: { mailbox_messageId: key } });
        if (prior) { if (!latest || prior.received > latest) latest = prior.received; continue; }
        const body = await getAlertBody(messageId, monitor.labelId, signal);
        if (!body) continue;
        const roles = parseAlert(body.html, body.plain);
        await prisma.$transaction(async tx => {
          if (!(await tx.jobAlertMonitor.updateMany({ where: owner, data: { revision } })).count) throw new ActionError("Alert settings changed.");
          for (const role of roles) {
            await tx.jobAlertLead.upsert({ where: { linkedinUrl: role.linkedinUrl }, create: { ...role, received: body.received }, update: {
              ...(role.employerUrl && { employerUrl: role.employerUrl }), ...(role.company && { company: role.company }), ...(role.title !== "LinkedIn opportunity" && { title: role.title }),
            } });
          }
          await tx.jobAlertReceipt.create({ data: { ...key, received: body.received, count: roles.length } });
        });
        if (!latest || body.received > latest) latest = body.received;
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    const finished = await prisma.jobAlertMonitor.updateMany({ where: owner, data: { checkedAt: now, lastAlertAt: latest, problem: null } });
    if (finished.count) {
      const { scheduleAlertReview } = await import("./review");
      await scheduleAlertReview();
    }
  } catch (error) {
    const problem = error instanceof ActionError ? error.message : "Gmail check failed. Check the Google connection. CareerAI will retry in 15 minutes.";
    await prisma.jobAlertMonitor.updateMany({ where: owner, data: { problem, nextCheckAt: new Date(+now + HOUR / 4) } });
    logServerError("LinkedIn alert check", error);
  }
}

export function startAlertSchedule() {
  const runtime = globalThis as typeof globalThis & { careerAiAlertTimer?: NodeJS.Timeout };
  if (runtime.careerAiAlertTimer) return;
  const tick = () => void checkAlerts().catch(error => logServerError("alert schedule", error));
  runtime.careerAiAlertTimer = setInterval(tick, 60000);
  runtime.careerAiAlertTimer.unref();
  tick();
}
