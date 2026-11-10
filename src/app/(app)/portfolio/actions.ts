"use server";

import { action } from "@/lib/action";
import { buildPortfolio, portfolioSelectionSchema } from "@/lib/portfolio";
import { loadProfile } from "@/lib/profile-data";

export const previewPortfolio = action(portfolioSelectionSchema, async (selection) => {
  const portfolio = buildPortfolio(await loadProfile(), selection);
  return { html: portfolio.html, hash: portfolio.hash };
});
