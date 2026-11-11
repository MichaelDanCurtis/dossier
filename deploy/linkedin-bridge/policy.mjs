// Fixed limits reduce load. They do not imply LinkedIn approval or evade checks.
export const LIMITS = Object.freeze({ intervalMs: 30_000, runJobs: 8, dayPages: 40, cooldownMs: 15 * 60_000, manualMs: 15 * 60_000 });
export function linkedinUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['www.linkedin.com', 'linkedin.com'].includes(url.hostname)) throw new Error('Use a LinkedIn HTTPS address.');
  return url.href;
}
export function resourceAllowed(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.port && ['linkedin.com', 'licdn.com', 'google.com', 'gstatic.com', 'recaptcha.net', 'arkoselabs.com', 'funcaptcha.com'].some((host) => url.hostname === host || url.hostname.endsWith('.' + host));
  } catch { return false; }
}
export function jobUrl(value) {
  const url = new URL(linkedinUrl(value));
  const id = /^\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/.exec(url.pathname)?.[1];
  if (!id) throw new Error('Choose a LinkedIn job posting.');
  return `https://www.linkedin.com/jobs/view/${id}/`;
}
export function pageProblem(url, status, text = '') {
  if (status === 429) return 'LinkedIn asked us to slow down. Collection stopped; review the browser before another run.';
  if ([401, 403, 999].includes(status) || /\/(checkpoint|challenge|authwall|login|uas\/login)(?:[/?]|$)/i.test(url) || /verify your identity|security verification|unusual activity|quick security check/i.test(text)) return 'LinkedIn needs sign-in or verification. Open the browser and complete it yourself.';
  if (status >= 400) return 'LinkedIn could not return this page. Collection stopped without retrying.';
  return null;
}
export function nextPageAt(state, now) { return Math.max(now, state.lastPageAt + LIMITS.intervalMs); }
