/** Read rendered job cards only, after the user opens collection from the toolbar. */
export function extractLinkedinResults() {
  const here = new URL(location.href);
  if (here.protocol !== 'https:' || !['www.linkedin.com', 'linkedin.com'].includes(here.hostname) || !/^\/jobs\/(search(?:-results)?|collections)(\/|$)/.test(here.pathname)) throw new Error('Open a LinkedIn job search in this Chrome tab first.');
  const text = node => {
    if (!node) return '';
    const copy = node.cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"],script,style,button,input,textarea,form').forEach(child => child.remove());
    return copy.textContent.replace(/\s+/g, ' ').trim();
  };
  const modern = Array.from(document.querySelectorAll('[role="button"][componentkey^="job-card-component-ref-"]'));
  const nodes = modern.length ? modern : Array.from(document.querySelectorAll('li[data-occludable-job-id], .job-card-container[data-job-id], a.job-card-list__title[href*="/jobs/view/"], a.job-card-list__title--link[href*="/jobs/view/"]'));
  const seen = new Set(), jobs = [];
  for (const node of nodes) {
    let id = /^job-card-component-ref-(\d+)$/.exec(node.getAttribute('componentkey') || '')?.[1] || node.getAttribute('data-occludable-job-id') || node.getAttribute('data-job-id');
    if (!id) { try { id = /^\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/.exec(new URL(node.href, here).pathname)?.[1]; } catch {} }
    if (!/^\d{1,30}$/.test(id || '') || seen.has(id)) continue;
    seen.add(id);
    const paragraphs = Array.from(node.querySelectorAll('p')).map(text).filter(Boolean);
    const title = modern.length ? paragraphs[0] : text(node.querySelector('.job-card-list__title,.job-card-list__title--link,h3') || node);
    jobs.push({ id, url: `https://www.linkedin.com/jobs/view/${id}/`, title: (title || 'Job ' + id).slice(0, 500), company: (modern.length ? paragraphs[1] || '' : text(node.querySelector('.artdeco-entity-lockup__subtitle,.job-card-container__primary-description'))).slice(0, 300), place: (modern.length ? paragraphs[2] || '' : text(node.querySelector('.job-card-container__metadata-wrapper'))).slice(0, 300) });
    if (jobs.length === 50) break;
  }
  if (!jobs.length) throw new Error('No job cards could be read here. Wait for the search results to load, then open CareerAI again.');
  return { jobs, sourceUrl: here.href, keywords: here.searchParams.get('keywords') || '', capturedAt: Date.now() };
}

/** This guard never reads credentials or form values. */
export function linkedinAccessState() {
  const here = new URL(location.href);
  const id = /^\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/.exec(here.pathname)?.[1] || here.searchParams.get('currentJobId');
  const challenge = !/^\/jobs\//.test(here.pathname) || !!document.querySelector('iframe[src*="captcha"],iframe[src*="challenges.cloudflare.com"],form[action*="checkpoint"],input[type="password"]') || /^(?:security verification|verify you are human|sign in)/i.test(document.title);
  return { id, blocked: challenge };
}

/** Expand only a job-description control, never an application or messaging control. */
export function expandLinkedinDescription() {
  const here = new URL(location.href), id = /^\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/.exec(here.pathname)?.[1] || here.searchParams.get('currentJobId');
  const section = id && document.getElementById(`JobDetails_AboutTheJob_${id}`) || document.querySelector('.jobs-description');
  if (!section) return false;
  const button = Array.from(section.querySelectorAll('button')).find(node => node.getAttribute('aria-expanded') !== 'true' && /^(?:show|see) more(?: description| of (?:the )?job description)?$/i.test((node.getAttribute('aria-label') || node.textContent).trim()));
  if (!button) return false;
  button.click(); return true;
}
