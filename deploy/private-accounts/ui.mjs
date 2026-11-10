import { existsSync, readFileSync } from 'node:fs';

// The image copies the app's canonical palette; development reads that same source.
const bundledThemes = new URL('./assets/ui-themes.css', import.meta.url);
const css = readFileSync(existsSync(bundledThemes) ? bundledThemes : new URL('../../public/ui-themes.css', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('./assets/accounts.css', import.meta.url), 'utf8');
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const brand = '<a class="brand" href="/"><svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14.08" fill="var(--color-primary)"/><path fill="none" stroke="var(--color-on-primary)" stroke-width="8" stroke-linecap="round" d="M44 20a17 17 0 1 0 0 24"/></svg><span>CareerAI<small>Find work that fits you.</small></span></a>';

export function page(title, content, wide = false) {
  const nav = wide ? content.match(/<nav>.*?<\/nav>/s)?.[0] ?? '' : '';
  const body = nav ? content.replace(nav, '') : content;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · CareerAI</title><style>${css}</style></head><body class="${wide ? 'workspace' : 'centered'}">${wide ? `<aside class="app-sidebar">${brand}${nav}<div class="sidebar-footer">Private workspace · CareerAI</div></aside>` : ''}<main id="main">${wide ? '' : brand}<header><p class="eyebrow">${wide ? 'Administration' : 'Your private workspace'}</p><h1>${escapeHtml(title)}</h1></header>${body}</main></body></html>`;
}
