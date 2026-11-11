/** Injected only after Capture job. No network calls, cookies, storage or form input. */
export function extractLinkedinJob() {
  const here = new URL(location.href);
  if (here.protocol !== 'https:' || !['www.linkedin.com', 'linkedin.com'].includes(here.hostname)) throw new Error('Open a LinkedIn job before capturing.');
  const id = /^\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/.exec(here.pathname)?.[1] || (/^\/jobs\//.test(here.pathname) && /^\d+$/.test(here.searchParams.get('currentJobId') || '') ? here.searchParams.get('currentJobId') : null);
  if (!id) throw new Error('Open an individual job, or select a job in LinkedIn search results.');
  const pane = document.querySelector('.jobs-search__job-details--container, .jobs-search__job-details, .job-view-layout, .job-details-jobs-unified-top-card')?.closest('.jobs-search__job-details--container, .jobs-search__job-details, .job-view-layout') || document;
  const read = (selectors, max) => {
    for (const selector of selectors) {
      const node = pane.querySelector(selector);
      if (!node) continue;
      const copy = node.cloneNode(true);
      copy.querySelectorAll('script,style,noscript,button,input,textarea,select,nav,form').forEach((child) => child.remove());
      const value = copy.textContent.replace(/\r/g, '').replace(/[\t ]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
      if (value) return value.slice(0, max);
    }
    return '';
  };
  return {
    url: `https://www.linkedin.com/jobs/view/${id}/`,
    title: read(['.job-details-jobs-unified-top-card__job-title h1', '.job-details-jobs-unified-top-card__job-title', 'h1.top-card-layout__title', 'h1.topcard__title', 'h1'], 500),
    company: read(['.job-details-jobs-unified-top-card__company-name', '.topcard__org-name-link', '.top-card-layout__card a[data-tracking-control-name*="company"]'], 300),
    place: read(['.job-details-jobs-unified-top-card__tertiary-description-container', '.topcard__flavor--bullet'], 300),
    text: read(['#job-details', '.jobs-description__content', '.jobs-description-content__text', '.show-more-less-html__markup'], 100000),
    salary: '', remote: false,
  };
}
