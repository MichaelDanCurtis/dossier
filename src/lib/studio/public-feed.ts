import "server-only";
import https from "node:https";
import { isIP } from "node:net";
import { guardedLookup, isPublicAddress } from "@/lib/posting-fetch";

export function publicFeedUrl(value: string): URL {
  const url = new URL(value), host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" || /(^|\.)(localhost|local|internal|lan)\.?$/i.test(host) || isIP(host) && !isPublicAddress(host)) throw new Error("Use a public HTTPS feed URL.");
  return url;
}

/** DNS is checked when connecting; redirects cannot reach private networks. */
export async function readPublicFeed(value: string, redirects = 0, deadline = Date.now() + 20000): Promise<string> {
  const url = publicFeedUrl(value);
  const remaining = deadline - Date.now();
  if (remaining <= 0 || redirects > 3) throw new Error("The feed timed out or redirected too often.");
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      lookup: guardedLookup, signal: AbortSignal.timeout(remaining),
      headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml", "user-agent": "CareerAI-Publicist/1.0", "accept-encoding": "identity" },
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        let next: string;
        try { next = new URL(response.headers.location, url).href; }
        catch { response.destroy(); reject(new Error("The feed returned an invalid redirect.")); return; }
        response.destroy();
        void readPublicFeed(next, redirects + 1, deadline).then(resolve, reject); return;
      }
      if (status !== 200) { response.destroy(); reject(new Error(`Feed returned HTTP ${status}.`)); return; }
      if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") { response.destroy(); reject(new Error("Use an uncompressed public RSS/Atom feed.")); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) response.destroy(new Error("Feed exceeds 2 MiB."));
        else chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
    request.on("error", reject);
  });
}
