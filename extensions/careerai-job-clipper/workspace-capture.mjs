/** Read rendered LinkedIn content only. Injected by the extension after a user
 * starts a capture; never reads cookies, form values or hidden API responses. */
export async function extractWorkspace(kind) {
  const here=new URL(location.href);
  if(here.protocol!=='https:'||!['www.linkedin.com','linkedin.com'].includes(here.hostname))throw new Error('Open LinkedIn in this Chrome profile.');
  const clean=node=>{
    if(!node)return'';const copy=node.cloneNode(true);
    copy.querySelectorAll('script,style,form,input,textarea,select,button,[aria-hidden="true"]').forEach(n=>n.remove());
    copy.querySelectorAll('br').forEach(n=>n.replaceWith('\n'));
    copy.querySelectorAll('p,li').forEach(n=>n.append('\n'));
    return copy.textContent.replace(/[\t ]+/g,' ').replace(/ *\n */g,'\n').trim();
  };
  const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(n=>n.toString(16).padStart(2,'0')).join('');
  if(kind==='feed'){
    if(!here.pathname.startsWith('/feed'))throw new Error('The reader is no longer on your LinkedIn feed.');
    const main=document.querySelector('main,[role="main"]');if(!main)throw new Error('Your feed is still loading.');
    const roots=[...main.querySelectorAll('[role="listitem"][componentkey^="update-card-focus"],article,[data-id^="urn:li:activity:"],.feed-shared-update-v2[data-urn]')];
    const cards=roots.filter(root=>!roots.some(other=>other!==root&&other.contains(root))),items=[],seen=new Set();
    for(const root of cards){
      const menu=root.querySelector('button[aria-label^="Open control menu for post by "]');
      const author=menu?.getAttribute('aria-label').replace(/^Open control menu for post by /,'').trim()||clean(root.querySelector('.update-components-actor__name')).split('\n')[0];
      if(!author)continue;
      const header=menu?.parentElement;
      const body=root.querySelector('.update-components-text,.feed-shared-update-v2__description')||[...root.querySelectorAll('p')].filter(p=>!header?.contains(p)).toSorted((a,b)=>clean(b).length-clean(a).length)[0];
      const text=clean(body).slice(0,6000);if(!text||text===author)continue;
      // A linked or quoted post does not establish this card's identity.
      // Without its own URN, preserve the excerpt without inventing a permalink.
      const urn=[root.getAttribute('data-urn'),root.getAttribute('data-id')].find(v=>/^urn:li:(activity|share|ugcPost):\d+$/.test(v||''));
      const url=urn?'https://www.linkedin.com/feed/update/'+urn+'/':'';
      const key=await digest(author+'\n'+text);if(seen.has(key))continue;seen.add(key);
      items.push({key,title:author.slice(0,200),text,url});if(items.length===20)break;
    }
    return {items,withoutPermalink:items.filter(item=>!item.url).length};
  }
  if(kind==='inbox'){
    if(!here.pathname.startsWith('/messaging'))throw new Error('The reader is no longer on the LinkedIn inbox.');
    const list=document.querySelector('[role="list"][aria-label="Conversation List"],ul[aria-label="Conversation List"],.msg-conversations-container__conversations-list');
    if(!list)throw new Error('The inbox list is still loading.');
    const items=[];
    for(const row of list.querySelectorAll('li')){
      const title=clean(row.querySelector('h3')).slice(0,200),text=clean(row.querySelector('p')).slice(0,1500);
      if(!title||!text)continue;
      const key=await digest(title+'\n'+text);
      items.push({key,title,text,url:''});if(items.length===20)break;
    }
    return {items};
  }
  if(kind==='thread'){
    if(!/^\/messaging\/thread\/[^/]+\/?$/.test(here.pathname))throw new Error('Open the conversation you want to read in LinkedIn, then try again.');
    const pane=document.querySelector('.msg-s-message-list-container,.msg-s-message-list,.msg-spinmail-thread-presenter__message-body');
    const header=document.querySelector('.msg-thread__link-to-profile h2,.msg-entity-lockup__entity-title,.msg-thread__topcard h2');
    const text=clean(pane).slice(0,6000),title=clean(header).slice(0,200)||'LinkedIn conversation excerpt';
    if(text.length<10)throw new Error('The selected conversation has not finished loading.');
    return {items:[{key:here.pathname,title,text,url:'https://www.linkedin.com'+here.pathname}]};
  }
  throw new Error('This reader supports feed, inbox and conversation excerpts.');
}

/** A user chose this exact preview. Do not scan/click other conversations to
 * resolve IDs, or guess when names/previews have changed or are ambiguous. */
export async function openWorkspaceThread(expected){
  const here=new URL(location.href);if(here.hostname!=='www.linkedin.com'||!here.pathname.startsWith('/messaging'))throw new Error('Open the inbox before selecting a conversation.');
  const rows=[...document.querySelectorAll('ul[aria-label="Conversation List"] li,.msg-conversations-container__conversations-list li')];
  const normalized=node=>node?.textContent.replace(/\s+/g,' ').trim()||'';
  const matches=[...new Set(rows)].filter(row=>normalized(row.querySelector('h3'))===expected.title&&normalized(row.querySelector('p'))===expected.text.replace(/\s+/g,' ').trim());
  if(matches.length!==1)throw new Error('The inbox changed or this preview is ambiguous. Refresh and choose the conversation again.');
  const target=matches[0].querySelector('.msg-conversation-listitem__link,[role="link"]');
  if(!target)throw new Error('Open this conversation yourself in LinkedIn, then use Read current conversation.');
  target.click();return {opened:true};
}
