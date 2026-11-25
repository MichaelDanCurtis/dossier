import { parse } from "node-html-parser";

export type AlertRole = { linkedinUrl: string; title: string; company: string; employerUrl: string };

function jobUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (url.origin !== "https://www.linkedin.com" && url.origin !== "https://linkedin.com") return null;
    if (url.username || url.password) return null;
    const match = /^\/(?:comm\/)?jobs\/view\/(?:[^/]*-)?(\d+)\/?$/.exec(url.pathname);
    return match ? "https://www.linkedin.com/jobs/view/" + match[1] + "/" : null;
  } catch { return null; }
}

export function employerLink(raw: string) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return "";
    const patterns: Record<string, RegExp> = {
      "jobs.lever.co": /^\/[^/]+\/[\w-]+(?:\/apply)?\/?$/,
      "jobs.eu.lever.co": /^\/[^/]+\/[\w-]+(?:\/apply)?\/?$/,
      "jobs.ashbyhq.com": /^\/[^/]+\/[\w-]+(?:\/application)?\/?$/,
      "job-boards.greenhouse.io": /^\/[^/]+\/jobs\/\d+\/?$/,
      "boards.greenhouse.io": /^\/[^/]+\/jobs\/\d+\/?$/,
    };
    if (!patterns[u.hostname]?.test(u.pathname)) return "";
    return u.origin + u.pathname.replace(/\/(?:apply|application)\/?$|\/$/g, "");
  } catch { return ""; }
}

const generic = /^(view|see|apply|learn more|job details|jobs? alert)\b/i;
export function parseAlert(html: string, plain: string): AlertRole[] {
  const jobs = new Map<string, AlertRole>();
  const doc = parse(html.slice(0, 1000000));
  for (const anchor of doc.querySelectorAll("a[href]")) {
    const linkedinUrl = jobUrl(anchor.getAttribute("href") || "");
    if (!linkedinUrl) continue;
    const title = anchor.text.trim().replace(/\s+/g, " ").slice(0, 500);
    const row = jobs.get(linkedinUrl) ?? { linkedinUrl, title: "", company: "", employerUrl: "" };
    if (!row.title && title && !generic.test(title)) row.title = title;
    // Examine only a single job card. Never associate links from the next role.
    const card = anchor.closest("tr") ?? anchor.parentNode;
    if (card) {
      const links = card.querySelectorAll("a[href]").map(a => a.getAttribute("href") || "");
      const ids = new Set(links.map(jobUrl).filter(Boolean));
      if (ids.size === 1 && card.structuredText.length < 1500) {
        const employers = [...new Set(links.map(employerLink).filter(Boolean))];
        if (employers.length === 1) row.employerUrl = employers[0];
        const lines = card.structuredText.split(/\n/).map(s => s.trim()).filter(Boolean);
        const next = lines[lines.indexOf(title) + 1];
        if (lines.includes(title) && next && !generic.test(next) && !next.includes("://")) row.company ||= next.split(/ [·•] /)[0].slice(0, 300);
      }
    }
    jobs.set(linkedinUrl, row);
  }
  const lines = plain.slice(0, 1000000).split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(/https:\/\/(?:www\.)?linkedin\.com\/(?:comm\/)?jobs\/view\/[^\s<>"]+/gi)) {
      const url = jobUrl(match[0]);
      if (!url || jobs.has(url)) continue;
      const previous = lines[index - 1]?.trim() ?? "";
      jobs.set(url, { linkedinUrl: url, title: previous && !generic.test(previous) && !previous.includes("://") ? previous.slice(0, 500) : "", company: "", employerUrl: "" });
    }
  }
  return [...jobs.values()].map(row => ({ ...row, title: row.title || "LinkedIn opportunity" }));
}
