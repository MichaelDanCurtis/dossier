"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action, ActionError } from "@/lib/action";
import { configureAlerts, checkAlerts } from "@/lib/job-alerts/monitor";
import { employerLink } from "@/lib/job-alerts/parse";
import { alertQueue } from "@/lib/job-alerts/queue";
import { prisma } from "@/lib/prisma";
import { linkKey } from "@/lib/job-search/search";
import { storePosting } from "@/lib/postings";

export const setAlertLabel = action(z.object({ label: z.string().trim().min(1).max(225).nullable() }), async ({ label }) => {
  await configureAlerts(label);
  revalidatePath("/agent");
});
export const checkAlertMail = action(z.object({}), async () => {
  await checkAlerts();
  revalidatePath("/agent");
});
export const changeAlert = action(z.object({ url: z.string().max(2000), choice: z.enum(["pass", "match", "prepare"]), boardId: z.string().max(100).optional() }), async ({ url, choice, boardId }) => {
  const queue = await alertQueue();
  const row = queue.find(row => row.lead.linkedinUrl === url);
  if (!row) throw new ActionError("This opportunity is no longer in the queue.");
  if (choice === "pass") {
    const key = row.posting && linkKey(row.posting.url);
    const ids = key ? queue.filter(item => item.posting && linkKey(item.posting.url) === key).map(item => item.lead.linkedinUrl) : [url];
    await prisma.jobAlertLead.updateMany({ where: { linkedinUrl: { in: ids } }, data: { passed: true } });
  } else {
    if (choice === "match") {
      const listing = row.suggestions.find(listing => listing.id === boardId);
      if (!listing) throw new ActionError("That listing changed. Refresh the page.");
      await prisma.jobAlertLead.update({ where: { linkedinUrl: url }, data: { boardRowId: listing.id, employerUrl: employerLink(listing.posting.url) || employerLink(listing.applicationUrl) } });
    } else {
      if (!row.posting) throw new ActionError("Add or confirm the full job description first.");
      const saved = await storePosting(row.posting, { savedAt: new Date() });
      return saved.applicationId ? "/applications/" + saved.applicationId : "/new?posting=" + saved.id;
    }
  }
  revalidatePath("/agent");
  return null;
});
