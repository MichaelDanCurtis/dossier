import "server-only";

import { logServerError } from "@/lib/log";

import { loadStudio } from "./data";
import { refreshNews } from "./news";

const globals = globalThis as unknown as { careerStudioNewsTimer?: ReturnType<typeof setInterval> };

export function startStudioNewsSchedule() {
  if (globals.careerStudioNewsTimer) return;
  const tick = async () => {
    const { newsAuto, lastNewsCheck } = await loadStudio();
    if (newsAuto && (!lastNewsCheck || Date.now() - Date.parse(lastNewsCheck) >= 86400000)) await refreshNews(null);
  };
  const run = () => { void tick().catch((error: unknown) => logServerError("publicist news", error)); };
  globals.careerStudioNewsTimer = setInterval(run, 15 * 60 * 1000);
  globals.careerStudioNewsTimer.unref?.();
  run();
}
