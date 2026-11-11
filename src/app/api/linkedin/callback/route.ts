import { type NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { publicOrigin } from "@/lib/google/origin";
import { completeLinkedin, linkedinStateCookie } from "@/lib/studio/linkedin";

export async function GET(request: NextRequest) {
  const origin = publicOrigin(request);
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code"), state = searchParams.get("state");
  let status = "failed";
  if (await getSession() && state && state.length <= 100 && state === request.cookies.get(linkedinStateCookie)?.value && code && code.length <= 4096) {
    try { await completeLinkedin(origin, state, code); status = "connected"; } catch { /* Provider response and codes stay private. */ }
  }
  const response = NextResponse.redirect(new URL(`/linkedin?connection=${status}`, origin), 303);
  response.cookies.set(linkedinStateCookie, "", { path: "/api/linkedin", httpOnly: true, sameSite: "lax", secure: origin.startsWith("https:"), maxAge: 0 });
  return response;
}
