import "server-only";

import { strToU8, zipSync } from "fflate";
import { z } from "zod";
import type { ProfileData } from "@/lib/profile";
import { formatDateRange, formatMonthYear } from "@/lib/profile";
import { webHref } from "@/lib/web-link";
import { recordHash } from "@/lib/record-hash";

export const portfolioSelectionSchema = z.object({
  name: z.boolean(), headline: z.boolean(), summary: z.boolean(), email: z.boolean(), website: z.boolean(), linkedin: z.boolean(),
  projects: z.array(z.string()).max(1000), experience: z.array(z.string()).max(1000), certifications: z.array(z.string()).max(1000), skills: z.array(z.string()).max(2000),
});
export type PortfolioSelection = z.infer<typeof portfolioSelectionSchema>;
export const EMPTY_PORTFOLIO_SELECTION: PortfolioSelection = { name: false, headline: false, summary: false, email: false, website: false, linkedin: false, projects: [], experience: [], certifications: [], skills: [] };
const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const safeLink = (text: string) => { try { const normalized = webHref(text); if (!normalized) return ""; const url = new URL(normalized); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : ""; } catch { return ""; } };

/** An explicit public allowlist. Private backup data is never an input to a site. */
export function buildPortfolio(profile: ProfileData, selection: PortfolioSelection) {
  const selected = portfolioSelectionSchema.parse(selection);
  const projects = profile.projects.filter((row) => selected.projects.includes(row.id)).map((row) => ({ sourceId: row.id, name: row.name, description: row.bullets, dates: formatDateRange(row), url: safeLink(row.link) }));
  const experience = profile.experience.filter((row) => selected.experience.includes(row.id)).map((row) => ({ sourceId: row.id, company: row.company, role: row.role, description: row.bullets, dates: formatDateRange(row) }));
  const certifications = profile.certifications.filter((row) => selected.certifications.includes(row.id)).map((row) => ({ sourceId: row.id, name: row.name, issuer: row.issuer, obtained: formatMonthYear(row.year, row.month), expires: formatMonthYear(row.expiryYear, row.expiryMonth) }));
  const skills = profile.skills.filter((row) => selected.skills.includes(row.id)).map((row) => ({ sourceId: row.id, name: row.name }));
  const content = {
    format: "dossier-public-portfolio", version: 1,
    name: selected.name ? profile.basics.name : "", headline: selected.headline ? profile.basics.headline : "", about: selected.summary ? profile.basics.summary : "",
    email: selected.email ? profile.basics.email : "", website: selected.website ? safeLink(profile.basics.website) : "", linkedin: selected.linkedin ? safeLink(profile.basics.linkedin) : "",
    projects, experience, certifications, skills,
  };
  const hash = recordHash(content);
  const link = (url: string, label: string) => url ? `<a href="${escape(url)}" rel="noreferrer">${escape(label)}</a>` : "";
  const paragraph = (text: string) => `<p>${escape(text).replace(/\n/g, "<br>")}</p>`;
  const section = (title: string, entries: string[]) => entries.length ? `<section><h2>${title}</h2>${entries.join("\n")}</section>` : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(content.name || "Portfolio")}</title><style>body{font:17px/1.65 system-ui,sans-serif;color:#172033;background:#f4f7fb;margin:0}main{max-width:900px;margin:auto;padding:70px 24px}header{border-bottom:3px solid #2563eb;padding-bottom:32px}h1{font-size:clamp(2.5rem,7vw,4.5rem);line-height:1.1;margin:0 0 18px}h2{font-size:1.7rem;margin-top:50px}h3{margin-bottom:4px}article{background:white;padding:24px;margin:18px 0;border-radius:16px;border:1px solid #dce4ef}a{color:#1d4ed8}small{color:#526079}.links{display:flex;gap:20px;flex-wrap:wrap}</style></head><body><main><header><h1>${escape(content.name || "Selected work")}</h1>${paragraph(content.headline)}<div class="links">${link(content.website, "Website")}${link(content.linkedin, "LinkedIn")}${content.email ? `<a href="mailto:${encodeURIComponent(content.email)}">${escape(content.email)}</a>` : ""}</div></header>${content.about ? section("About", [paragraph(content.about)]) : ""}${section("Selected projects", content.projects.map((row) => `<article><h3>${escape(row.name)}</h3><small>${escape(row.dates)}</small>${paragraph(row.description)}${link(row.url, "View project")}</article>`))}${section("Experience", content.experience.map((row) => `<article><h3>${escape(row.role)}</h3><small>${escape(row.company)} · ${escape(row.dates)}</small>${paragraph(row.description)}</article>`))}${section("Certifications", content.certifications.map((row) => `<article><h3>${escape(row.name)}</h3><small>${escape(row.issuer)}${row.obtained ? ` · ${escape(row.obtained)}` : ""}${row.expires ? ` · expires ${escape(row.expires)}` : ""}</small></article>`))}${section("Skills", content.skills.length ? [paragraph(content.skills.map((row) => row.name).join(" · "))] : [])}</main></body></html>`;
  const manifest = { format: "dossier-portfolio-manifest", version: 1, contentHash: hash, sources: [...projects.map((row) => ({ kind: "project", id: row.sourceId, hash: recordHash(row) })), ...experience.map((row) => ({ kind: "experience", id: row.sourceId, hash: recordHash(row) })), ...certifications.map((row) => ({ kind: "certification", id: row.sourceId, hash: recordHash(row) })), ...skills.map((row) => ({ kind: "skill", id: row.sourceId, hash: recordHash(row) }))] };
  return { content, hash, html, manifest };
}

export function portfolioZip(portfolio: ReturnType<typeof buildPortfolio>): Uint8Array {
  const brief = `# Personal website brief\n\nBuild a personal website from content.json, the explicitly reviewed public source. index.html is a usable static starting point. Content hash: ${portfolio.hash}.\n\nShow the person's selected work, contributions and evidence clearly. Keep the page accessible and responsive. Do not add invented claims, credentials or politics. No analytics, accounts or external scripts are included. Review changes before publishing.\n`;
  const handoff = `# Coding-agent handoff\n\nOpen this folder with Codex, Claude Code or another coding agent. Start with site-brief.md and content.json. Ask for design changes, then preview locally. Publishing to a domain is a separate action.\n\nNever request or import a private Dossier backup, interview transcript, job preferences, reference contacts, tokens or API keys. The supplied content is the public allowlist; missing information is deliberately absent.\n\nOptional future virtual-you chat: use only the reviewed public content as evidence, disclose that answers are AI-generated, say when information is absent, and require a separate protected backend, rate limits and approval before adding paid inference or publishing. No public chat or model credentials are included in this export.\n`;
  const files = { "index.html": portfolio.html, "content.json": JSON.stringify(portfolio.content, null, 2), "manifest.json": JSON.stringify(portfolio.manifest, null, 2), "site-brief.md": brief, "agent-handoff.md": handoff, "README.md": "Open index.html in a browser to preview your reviewed portfolio. To customize it with a coding agent, read agent-handoff.md. Exporting this folder does not publish it.\n" };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, body]) => [name, strToU8(body)])));
}
