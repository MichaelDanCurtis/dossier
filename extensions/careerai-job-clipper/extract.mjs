/** Injected only after Capture job. No network calls, cookies, storage or form input. */
export function extractLinkedinJob() {
  const here = new URL(location.href);
  if (here.protocol !== 'https:' || !['www.linkedin.com', 'linkedin.com'].includes(here.hostname)) throw new Error('Open a LinkedIn job before capturing.');
  const id = /^\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/.exec(here.pathname)?.[1] || (/^\/jobs\//.test(here.pathname) && /^\d+$/.test(here.searchParams.get('currentJobId') || '') ? here.searchParams.get('currentJobId') : null);
  if (!id) throw new Error('Open an individual job, or select a job in LinkedIn search results.');
  const clean = (node, max) => {
    if (!node) return '';
    const copy = node.cloneNode(true);
    copy.querySelectorAll('script,style,noscript,button,input,textarea,select,nav,form').forEach(child => child.remove());
    copy.querySelectorAll('br').forEach(child => child.replaceWith('\n'));
    copy.querySelectorAll('p,li,h1,h2,h3,h4,div,section').forEach(child => child.append('\n'));
    return copy.textContent.replace(/\r/g, '').replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
  };
  // LinkedIn's newer jobs UI has stable job-scoped section IDs but generated
  // CSS classes. Bind description and title to the selected job's identity.
  const about = document.getElementById(`JobDetails_AboutTheJob_${id}`);
  if (about) {
    const titleLink = Array.from(document.querySelectorAll('a[href*="/jobs/view/"]')).find(link => {
      try { const url = new URL(link.href, here); return /^\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/.exec(url.pathname)?.[1] === id && !!clean(link, 500); } catch { return false; }
    });
    if (!titleLink) throw new Error('This job is still loading. Wait until its title and description are visible, then capture again.');
    let header = titleLink.parentElement;
    for (let node = header; node && node !== document.body; node = node.parentElement) {
      if (node.contains(about) || clean(node, 2001).length > 2000) break;
      header = node;
    }
    const links = Array.from(header.querySelectorAll('a'));
    const company = links.find(link => /\/company\//.test(link.getAttribute('href') || '') && clean(link, 300));
    const metadata = Array.from(header.querySelectorAll('p')).map(node => clean(node, 500)).find(text => text.includes('·') && !/^(Promoted|Responses managed)/i.test(text));
    const text = clean(about, 100000);
    if (text.length < 80) throw new Error('The full job description is not ready. Expand About the job and capture again.');
    return {
      url: `https://www.linkedin.com/jobs/view/${id}/`, title: clean(titleLink, 500), company: clean(company, 300),
      place: metadata?.split('·')[0].trim().slice(0, 300) || '', text,
      salary: clean(links.find(link => /[$€£]\s*\d/.test(clean(link, 300))), 300),
      remote: links.some(link => /^Remote$/i.test(clean(link, 300))),
    };
  }
  if (document.querySelector('[id^="JobDetails_AboutTheJob_"]')) throw new Error('LinkedIn is switching jobs. Wait for the selected description to finish loading, then capture again.');
  const pane = document.querySelector('.jobs-search__job-details--container, .jobs-search__job-details, .job-view-layout, .job-details-jobs-unified-top-card')?.closest('.jobs-search__job-details--container, .jobs-search__job-details, .job-view-layout') || document;
  const read = (selectors, max) => {
    for (const selector of selectors) {
      const node = pane.querySelector(selector);
      if (!node) continue;
      const value = clean(node, max);
      if (value) return value;
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
