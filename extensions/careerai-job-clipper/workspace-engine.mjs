import { extractLinkedinJob } from './extract.mjs';
import { extractLinkedinResults, expandLinkedinDescription } from './search.mjs';
import { extractWorkspace, openWorkspaceThread } from './workspace-capture.mjs';

export const linkedinUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='www.linkedin.com'&&!u.port&&!u.username&&!u.password;}catch{return false;}};
const idOf=value=>{try{const u=new URL(value);return /^\/jobs\/view\/(?:[^/]*-)?(\d+)\/?$/.exec(u.pathname)?.[1]||u.searchParams.get('currentJobId');}catch{return null;}};
export function workspaceAccess(){
  const u=new URL(location.href);
  return {blocked:u.protocol!=='https:'||u.hostname!=='www.linkedin.com'||!/^\/(jobs|feed|messaging)(\/|$)/.test(u.pathname)||!!document.querySelector('input[type="password"],iframe[src*="captcha"],iframe[src*="challenges.cloudflare.com"],form[action*="checkpoint"]')||/^(security verification|verify you are human|sign in)/i.test(document.title)};
}
export function scrollWorkspace(){window.scrollBy(0,Math.max(300,innerHeight*.8));return true;}
export function scrollJobResults(){
  const card=document.querySelector('[componentkey^="job-card-component-ref-"],li[data-occludable-job-id],.job-card-container[data-job-id]');
  for(let node=card?.parentElement;node&&node!==document.body;node=node.parentElement){
    if(node.scrollHeight>node.clientHeight+5&&/auto|scroll/.test(getComputedStyle(node).overflowY)){const before=node.scrollTop;node.scrollBy(0,Math.max(300,node.clientHeight*.8));return node.scrollTop>before+2;}
  }
  const before=window.scrollY;window.scrollBy(0,Math.max(300,innerHeight*.8));return window.scrollY>before+2;
}

/** One small step per Chrome event. State survives worker suspension. Uploads
 * interrupted in flight are paused as uncertain, never replayed automatically. */
export class WorkspaceEngine{
  constructor({chromeApi,api,now=Date.now}){this.chrome=chromeApi;this.api=api;this.now=now;this.busy=false;this.stopRequested=false;}
  async load(){return (await this.chrome.storage.session.get('workspace')).workspace||{pendingJobs:[],feed:[],inbox:[],thread:[],opportunities:[],chat:[]};}
  async store(state){await this.chrome.storage.session.set({workspace:state});}
  async connection(){const c=(await this.chrome.storage.local.get('connection')).connection;if(!c?.token||c.expiresAt<=this.now())throw new Error('Connect CareerAI using a fresh pairing code.');return c;}
  async workspace(body){const c=await this.connection();if(c.scope!=='workspace')throw new Error('Create a LinkedIn workspace pairing code in CareerAI to enable this panel.');return this.api('/api/extension/workspace',body,c.token);}
  async inject(tabId,func,args=[]){const [result]=await this.chrome.scripting.executeScript({target:{tabId},func,args});return result?.result;}
  async start(input,hostTabId){
    this.stopRequested=false;
    const before=await this.load();if(['running','reviewing'].includes(before.run?.status))throw new Error('Stop the current run before starting another.');
    if(!['jobs','job','feed','inbox','thread','thread-current'].includes(input.kind))throw new Error('Choose jobs, feed or messages.');
    const host=await this.chrome.tabs.get(hostTabId);if(!linkedinUrl(host.url))throw new Error('Open LinkedIn in this Chrome profile.');
    let url,phase=input.kind,limit=input.kind==='jobs'?Number(input.limit||25):input.kind==='job'?1:20;
    if(!Number.isInteger(limit)||limit<1||limit>50)throw new Error('Choose a run limit from 1 to 50 jobs.');
    if(input.kind==='jobs'){
      if(input.useCurrent&&/^\/jobs\/search(?:-results)?(?:\/|$)/.test(new URL(host.url).pathname)){url=new URL(host.url);url.searchParams.delete('currentJobId');url.searchParams.set('start','0');}
      else{if(typeof input.keywords!=='string'||!input.keywords.trim()||input.keywords.length>200||typeof input.location!=='string'||input.location.length>200)throw new Error('Enter the role or skills you want to search for.');url=new URL('https://www.linkedin.com/jobs/search/');url.searchParams.set('keywords',input.keywords.trim());if(input.location.trim())url.searchParams.set('location',input.location.trim());}
      url=url.href;phase='search';
    }else if(input.kind==='job'){const id=idOf(host.url);if(!/^\d+$/.test(id||''))throw new Error('Open the job you want to save in LinkedIn.');url=`https://www.linkedin.com/jobs/view/${id}/`;phase='job';}
    else if(input.kind==='feed')url='https://www.linkedin.com/feed/';
    else if(input.kind==='inbox'||input.kind==='thread')url='https://www.linkedin.com/messaging/';
    else{if(!/^\/messaging\/thread\/[^/]+\/?$/.test(new URL(host.url).pathname))throw new Error('Open a conversation in LinkedIn first.');url=host.url;phase='thread';}
    if(input.kind==='thread'&&(!input.expected||typeof input.expected.title!=='string'||typeof input.expected.text!=='string'))throw new Error('Choose the exact conversation preview to read.');
    const setup=await this.workspace({kind:'STATUS'}),reader=await this.chrome.tabs.create({url,active:false});
    const run={id:crypto.randomUUID(),kind:input.kind,hostTabId,readerTabId:reader.id,status:'running',phase,url,searchUrl:url,limit,pages:0,attempts:0,index:0,jobs:[],postingIds:[],rows:[],items:[],scrolls:0,nextAt:this.now(),navigatedAt:this.now(),aiReady:setup.aiReady,expected:input.expected||null,message:'Starting your LinkedIn read. You can stop it at any time.'};
    if(phase==='job')run.jobs=[{id:idOf(url),url,title:'Selected LinkedIn job',company:''}];
    await this.store({...before,model:setup.model,publicistModel:setup.publicistModel,chat:setup.chat,problem:null,...(input.kind==='jobs'||input.kind==='job'?{opportunities:[]}:{}),run});return run;
  }
  async stop(message='Stopped. Saved captures remain in CareerAI.'){
    this.stopRequested=true;
    const state=await this.load();if(!state.run)return;
    const run=state.run;run.status='stopped';run.message=run.phase==='saving'?'Stopped. A save was in progress; check CareerAI to confirm it.':message;
    if(run.aiJobId)await this.workspace({kind:'CANCEL_JOB',jobId:run.aiJobId}).catch(()=>undefined);
    if(run.readerTabId)await this.chrome.tabs.remove(run.readerTabId).catch(()=>undefined);
    run.readerTabId=null;await this.store(state);
  }
  async persist(run){if(this.stopRequested)return false;const state=await this.load();if(state.run?.id!==run.id||state.run.status!=='running')return false;state.run=run;await this.store(state);return true;}
  async navigate(run,url,phase){
    run.url=url;run.phase=phase;run.attempts=0;run.expanded=false;run.navigatedAt=this.now();run.nextAt=this.now()+1000;
    if(!await this.persist(run))return;
    await this.chrome.tabs.update(run.readerTabId,{url});
  }
  async enqueueJob(body,target,sourceId){
    const reply=await this.workspace({...body,requestId:crypto.randomUUID()});
    if(this.stopRequested&&['jobs','feed','inbox','thread'].includes(target)&&reply.jobId){await this.workspace({kind:'CANCEL_JOB',jobId:reply.jobId}).catch(()=>undefined);return {};}
    const state=await this.load();
    if(reply.applicationId){state.drafts={...state.drafts,[sourceId]:reply.applicationId};await this.store(state);return reply;}
    if(reply.jobId){state.pendingJobs=[...(state.pendingJobs||[]),{id:reply.jobId,target,sourceId}];await this.store(state);}return reply;
  }
  async autoReview(run,body,target){
    if(!run.aiReady||this.stopRequested)return;
    try{
      const reply=await this.enqueueJob(body,target),state=await this.load();
      if(state.run?.id===run.id&&state.run.status==='complete'&&reply.jobId){state.run.aiJobId=reply.jobId;state.run.status='reviewing';state.run.message+=' Preparing your AI review…';await this.store(state);}
    }catch(error){const state=await this.load();state.problem='Your captures are saved, but the AI request could not be confirmed. Check CareerAI before trying another review. '+error.message;await this.store(state);}
  }
  async finishCapture(run,items,kind){
    run.phase='saving';run.message=`Saving ${items.length} ${kind==='IMPORT_FEED'?'feed excerpts':kind==='IMPORT_INBOX'?'inbox previews':'conversation excerpts'}…`;
    if(!await this.persist(run))return;
    const result=await this.workspace(kind==='IMPORT_THREAD'?{kind,item:items[0]}:{kind,items});
    const state=await this.load();if(state.run?.id!==run.id)return;
    const field=kind==='IMPORT_FEED'?'feed':kind==='IMPORT_INBOX'?'inbox':'thread';
    state[field]=items.map((item,index)=>({...item,sourceId:result.items[index].id}));
    if(this.stopRequested||state.run.status!=='running'){state.run.status='stopped';state.run.message='Stopped. Captures confirmed before stopping remain saved.';await this.store(state);return;}
    run.message=`Saved ${result.saved} ${field==='feed'?'feed excerpts':field==='inbox'?'inbox previews':'conversation excerpts'}. Nothing was sent.`;run.phase='complete';run.status='complete';state.run=run;await this.store(state);
    await this.chrome.tabs.remove(run.readerTabId).catch(()=>undefined);run.readerTabId=null;
    if(items.length)await this.autoReview(run,{kind:'REVIEW_SOURCES',sourceIds:result.items.map(item=>item.id)},field);
  }
  async step(){
    if(this.busy)return;this.busy=true;
    try{
      const state=await this.load(),run=state.run;
      if(!run||run.status!=='running'||this.stopRequested||run.nextAt>this.now())return;
      if(run.phase==='saving')throw new Error('The worker restarted during a save. Check CareerAI before starting again; the save will not be replayed.');
      const tab=await this.chrome.tabs.get(run.readerTabId);
      if(!linkedinUrl(tab.url))throw new Error('LinkedIn needs your attention or the reader left LinkedIn. Collection is paused.');
      if(tab.status!=='complete'){run.nextAt=this.now()+1000;await this.persist(run);return;}
      if((await this.inject(tab.id,workspaceAccess))?.blocked)throw new Error('LinkedIn requested sign-in or a security check. Complete that yourself in normal Chrome. Nothing will be bypassed.');
      if(run.phase==='search'){
        const actual=new URL(tab.url);if(!/^\/jobs\/search(?:-results)?(?:\/|$)/.test(actual.pathname))throw new Error('The search reader changed pages. Start a new run from the search you want.');
        const captured=await this.inject(tab.id,extractLinkedinResults);
        const previousCount=run.jobs.length;
        run.pageStartCount??=previousCount;
        for(const job of captured.jobs)if(!run.jobs.some(old=>old.id===job.id)&&run.jobs.length<run.limit)run.jobs.push(job);
        run.message=`Found ${run.jobs.length} distinct jobs on search page ${run.pages+1}.`;
        if(run.jobs.length<run.limit&&(run.searchScrolls||0)<8&&await this.inject(tab.id,scrollJobResults)){run.searchScrolls=(run.searchScrolls||0)+1;run.nextAt=this.now()+8000;await this.persist(run);return;}
        run.pages++;
        const newIds=run.jobs.length-run.pageStartCount;
        if(run.jobs.length<run.limit&&newIds>=25&&run.pages<5){const next=new URL(run.searchUrl);next.searchParams.set('start',String(run.pages*25));run.nextSearchUrl=next.href;run.searchScrolls=0;delete run.pageStartCount;run.phase='waiting-search';run.nextAt=Math.max(this.now(),run.navigatedAt+8000);await this.persist(run);return;}
        run.searchStopped=run.jobs.length===run.limit?'Your chosen job limit was reached.':run.pages>=5?'The five-page search budget was reached.':!newIds?'The next page supplied no new job IDs.':'The available search page ended.';
        if(!run.jobs.length)throw new Error('No job cards were available in this search.');
        run.phase='waiting-job';run.nextAt=Math.max(this.now(),run.navigatedAt+8000);await this.persist(run);return;
      }
      if(run.phase==='waiting-search'){await this.navigate(run,run.nextSearchUrl,'search');return;}
      if(run.phase==='waiting-job'){await this.navigate(run,run.jobs[run.index].url,'job');return;}
      if(run.phase==='job'){
        const selected=run.jobs[run.index];if(idOf(tab.url)!==selected.id)throw new Error('The reader changed to another job. Collection is paused.');
        if(!run.expanded){run.expanded=true;if(await this.inject(tab.id,expandLinkedinDescription)){run.nextAt=this.now()+1200;await this.persist(run);return;}}
        const job=await this.inject(tab.id,extractLinkedinJob);
        if(job.url!==selected.url||!job.title?.trim()||!job.company?.trim()||job.text?.trim().length<80)throw new Error('The full title, company and description are not ready.');
        run.phase='saving';run.message=`Saving ${run.index+1} of ${run.jobs.length}: ${job.title} · ${job.company}`;
        if(!await this.persist(run))return;
        const connection=await this.connection(),saved=await this.api('/api/extension/jobs',{...job,approved:true,collection:true},connection.token);
        if(saved.saved!==true||typeof saved.id!=='string')throw new Error('CareerAI did not confirm the save. Check saved jobs before trying again.');
        const current=await this.load();if(current.run?.id!==run.id)return;
        run.postingIds.push(saved.id);run.rows.push({title:job.title,company:job.company,postingId:saved.id,status:'saved'});run.index++;
        if(this.stopRequested||current.run.status!=='running'){current.run.status='stopped';current.run.postingIds=run.postingIds;current.run.rows=run.rows;current.run.message='Stopped. Confirmed saves remain in CareerAI.';await this.store(current);return;}
        if(run.index<run.jobs.length){run.phase='waiting-job';run.nextAt=Math.max(this.now(),run.navigatedAt+8000);await this.persist(run);return;}
        run.status='complete';run.phase='complete';run.message=`Saved ${run.postingIds.length} full job descriptions. ${run.searchStopped||''} Nothing was submitted.`;current.run=run;await this.store(current);
        await this.chrome.tabs.remove(run.readerTabId).catch(()=>undefined);run.readerTabId=null;
        const details=await this.workspace({kind:'JOB_RESULTS',postingIds:run.postingIds});const latest=await this.load();latest.opportunities=details.items;await this.store(latest);
        await this.autoReview(run,{kind:'REVIEW_JOBS',postingIds:run.postingIds},'jobs');
        return;
      }
      if(run.phase==='thread'&&run.expected&&!run.opened){await this.inject(tab.id,openWorkspaceThread,[run.expected]);run.opened=true;run.nextAt=this.now()+1500;await this.persist(run);return;}
      const capture=await this.inject(tab.id,extractWorkspace,[run.phase==='thread'?'thread':run.phase]);
      if(!capture?.items?.length)throw new Error('The requested content has not finished loading.');
      if(run.phase==='thread'&&run.expected&&capture.items[0].title!==run.expected.title)throw new Error('The opened conversation could not be matched to the preview you chose. No conversation was saved.');
      for(const item of capture.items)if(!run.items.some(old=>old.key===item.key)&&run.items.length<20)run.items.push(item);
      if(run.phase==='feed'&&run.items.length<20&&run.scrolls<3){run.scrolls++;run.message=`Reading your feed: ${run.items.length} excerpts found.`;await this.inject(tab.id,scrollWorkspace);run.nextAt=this.now()+8000;await this.persist(run);return;}
      await this.finishCapture(run,run.items,run.phase==='feed'?'IMPORT_FEED':run.phase==='inbox'?'IMPORT_INBOX':'IMPORT_THREAD');
    }catch(error){
      const state=await this.load(),run=state.run;if(!run||run.status!=='running')return;
      // Transient DOM hydration can be re-read without another navigation.
      if(!['saving','waiting-job'].includes(run.phase)&&/loading|not ready|not finished|title.*visible/i.test(error.message||'')&&run.attempts<20){run.attempts++;run.nextAt=this.now()+1200;run.message='Waiting for LinkedIn to finish rendering…';await this.store(state);}
      else{run.status='paused';run.message=run.phase==='saving'?'A save could not be confirmed. Check CareerAI before restarting. '+error.message:error.message||'The local reader paused.';await this.store(state);}
    }finally{this.busy=false;}
  }
  async pollJobs(){
    const state=await this.load();if(!state.pendingJobs?.length||this.now()-(state.lastPoll||0)<5000)return;
    state.lastPoll=this.now();await this.store(state);
    const result=await this.workspace({kind:'JOB_STATUSES',jobIds:state.pendingJobs.slice(0,8).map(item=>item.id)});
    const latest=await this.load();
    for(const job of result.jobs||[]){if(!job)continue;const entry=latest.pendingJobs.find(item=>item.id===job.id);if(!entry)continue;
      if(!['DONE','FAILED'].includes(job.status)){latest.jobMessage=job.step||'AI is working…';continue;}
      latest.pendingJobs=latest.pendingJobs.filter(item=>item.id!==job.id);
      if(job.status==='FAILED'){latest.problem=job.error||'An AI task did not finish. Your captures are saved.';if(latest.run?.aiJobId===job.id){latest.run.status='complete';latest.run.message=latest.problem;}continue;}
      if(entry.target==='jobs'){const details=await this.workspace({kind:'JOB_RESULTS',postingIds:latest.run?.postingIds||[]});latest.opportunities=details.items;}
      else if(['feed','inbox','thread'].includes(entry.target)){for(const answer of job.result?.items||[]){const item=latest[entry.target]?.find(item=>item.sourceId===answer.id);if(item)item.analysis=answer;}}
      else if(entry.target==='writer'){latest.chat=[...(latest.chat||[]),{role:'assistant',text:job.result.reply}];latest.ideas=job.result.ideas;}
      else if(entry.target==='reply')latest.reply={...job.result,sourceId:entry.sourceId};
      else if(entry.target==='resume')latest.drafts={...latest.drafts,[entry.sourceId]:job.result.applicationId};
      if(latest.run?.aiJobId===job.id){latest.run.status='complete';latest.run.message=job.result?.message||'Your captures and AI summaries are ready. Nothing was sent.';}
    }
    await this.store(latest);
  }
}
