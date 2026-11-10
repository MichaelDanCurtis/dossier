"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/action";
import { addCompanyBoard, changeCompanyBoard } from "@/lib/company-boards/data";
import { boardInputSchema } from "@/lib/company-boards/feeds";
import { companyBoardJob, companyScoreJob } from "@/lib/company-boards/jobs";
import { companyBoardJobKey } from "@/lib/company-boards/schedule";
import { findUnfinishedJobs, startJob } from "@/lib/jobs/runner";

export const addBoard = action(boardInputSchema, async (input) => {
  const board = await addCompanyBoard(input);
  const jobId = await startJob(companyBoardJob, { boardId: board.id, force: true }, { key: companyBoardJobKey(board.id) });
  revalidatePath("/companies");
  return { id: board.id, jobId };
});
export const checkBoard = action(z.object({ id: z.string() }), async ({ id }) => {
  const running = await findUnfinishedJobs(companyBoardJobKey(id));
  return { jobId: running[0]?.id ?? await startJob(companyBoardJob, { boardId: id, force: true }, { key: companyBoardJobKey(id) }) };
});
export const changeBoard = action(z.object({ id: z.string(), change: z.enum(["enable", "pause", "remove", "confirm-disappearance"]) }), async ({ id, change }) => {
  await changeCompanyBoard(id, change);
  revalidatePath("/companies");
  return { changed: true };
});
export const scoreCompanyRoles = action(companyScoreJob.input, async (input) => ({ jobId: await startJob(companyScoreJob, input, { key: "company-score" }) }));
