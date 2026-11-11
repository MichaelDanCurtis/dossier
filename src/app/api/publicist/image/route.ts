import { NextResponse } from "next/server";
import { route } from "@/lib/route";
import { loadStudio } from "@/lib/studio/data";
import { generatePublicistImage, publicistImageInput } from "@/lib/studio/publicist-images";

export const POST = route(async (request) => {
  const input = publicistImageInput.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: "Review an image prompt and the image settings before generating." }, { status: 400 });
  try {
    const image = await generatePublicistImage((await loadStudio()).publicist, input.data);
    return new Response(new Uint8Array(image), { headers: { "content-type": "image/png", "content-disposition": 'attachment; filename="careerai-publicist.png"' } });
  } catch (error) {
    // Never include a provider response or credential in the client response.
    const message = error instanceof Error && /^(Image settings|Choose |OpenAI refused|The image provider|The generated image)/.test(error.message) ? error.message : "Image generation could not be confirmed. Check provider usage before trying again.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
});
