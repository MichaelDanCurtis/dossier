import { NextResponse } from "next/server";
import { z } from "zod";
import { buildPortfolio, portfolioSelectionSchema, portfolioZip } from "@/lib/portfolio";
import { loadProfile } from "@/lib/profile-data";
import { route } from "@/lib/route";

export const POST = route(async (request) => {
  const parsed = z.object({ selection: portfolioSelectionSchema, expectedHash: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Preview your portfolio selection before exporting." }, { status: 400 });
  const portfolio = buildPortfolio(await loadProfile(), parsed.data.selection);
  if (portfolio.hash !== parsed.data.expectedHash) return NextResponse.json({ error: "Your selected profile content changed. Preview and review the portfolio again before exporting." }, { status: 409 });
  return new Response(Buffer.from(portfolioZip(portfolio)), { headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="dossier-portfolio.zip"' } });
});
