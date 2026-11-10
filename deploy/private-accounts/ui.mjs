import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./assets/accounts.css', import.meta.url), 'utf8');
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const brand = '<a class="brand" href="/"><svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14.08" fill="var(--color-primary)"/><path fill="var(--color-on-primary)" transform="matrix(0.02844 0 0 -0.02844 10.214 51.200)" d="M1179.8 691.9Q1179.8 974 1032.5 1107.7Q885.3 1241.3 625.7 1241.3H354.9L338.3 1350H674.8Q936.6 1350 1111 1279.8Q1285.4 1209.6 1372.4 1068.2Q1459.5 926.8 1459.5 714.2Q1459.5 486.8 1357.2 327.4Q1254.8 168 1077.9 84Q900.9 0 678.3 0H338.3L354.9 108.7H646.1Q807.3 108.7 927.1 168.3Q1047 227.8 1113.4 356.5Q1179.8 485.1 1179.8 691.9ZM72.3 0V41L223.4 95.9V1254.2L72.3 1308.9V1350H489.4V0Z"/></svg><span>Dossier<small>Your job search, on your server</small></span></a>';

export function page(title, content, wide = false) {
  const nav = wide ? content.match(/<nav>.*?<\/nav>/s)?.[0] ?? '' : '';
  const body = nav ? content.replace(nav, '') : content;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Dossier</title><style>${css}</style></head><body class="${wide ? 'workspace' : 'centered'}">${wide ? `<aside>${brand}${nav}<div class="sidebar-footer">Private workspace · Dossier</div></aside>` : ''}<main id="main">${wide ? '' : brand}<header><p class="eyebrow">${wide ? 'Administration' : 'Your private workspace'}</p><h1>${escapeHtml(title)}</h1></header>${body}</main></body></html>`;
}
