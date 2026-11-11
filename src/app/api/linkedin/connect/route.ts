import { NextResponse } from "next/server";

import { publicOrigin } from "@/lib/google/origin";
import { route } from "@/lib/route";
import { beginLinkedin, linkedinStateCookie } from "@/lib/studio/linkedin";

export const GET = route(async (request) => {
  const origin = publicOrigin(request);
  try {
    const { url, state } = await beginLinkedin(origin);
    const response = NextResponse.redirect(url, 303);
    response.cookies.set(linkedinStateCookie, state, { path: "/api/linkedin", httpOnly: true, sameSite: "lax", secure: origin.startsWith("https:"), maxAge: 600 });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/linkedin?connection=setup", origin), 303);
  }
});
