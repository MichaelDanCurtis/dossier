import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractWorkspace, openWorkspaceThread } from './workspace-capture.mjs';
import { WorkspaceEngine } from './workspace-engine.mjs';

function dom(html,url){const page=new JSDOM(html,{url});globalThis.document=page.window.document;globalThis.location=page.window.location;return page;}
test('modern feed keeps authors and excerpts separate from a quoted post and private form fields',async()=>{
  const page=dom('<main><div role="listitem" componentkey="update-card-focus-fixture"><header><button aria-label="Open control menu for post by Real Author"></button><p>Someone follows Other Company</p></header><p>A lesson learned from shipping reliable services.<input value="PRIVATE"><button>…more</button></p><a href="/feed/update/urn:li:activity:999/">Quoted post</a></div></main>','https://www.linkedin.com/feed/');
  try{const result=await extractWorkspace('feed');assert.equal(result.items.length,1);assert.equal(result.items[0].title,'Real Author');assert.equal(result.items[0].url,'');assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.match(result.items[0].text,/reliable services/);}finally{page.window.close();}
});
test('inbox reads previews without clicking, then refuses an ambiguous conversation',async()=>{
  const row='<li><div role="link"><h3>Alex</h3><p>Can we talk about the role?</p></div></li>';
  const page=dom('<ul aria-label="Conversation List" role="list">'+row+row+'</ul><input value="PRIVATE">','https://www.linkedin.com/messaging/');let clicks=0;page.window.document.addEventListener('click',()=>clicks++);
  try{const result=await extractWorkspace('inbox');assert.equal(clicks,0);assert.ok(!JSON.stringify(result).includes('PRIVATE'));await assert.rejects(openWorkspaceThread(result.items[0]),/ambiguous/);assert.equal(clicks,0);}finally{page.window.close();}
});
test('a conversation capture uses the active thread, never inbox snippets or draft text',async()=>{
  const page=dom('<ul aria-label="Conversation List"><li>PRIVATE OTHER THREAD</li></ul><span class="msg-entity-lockup__entity-title">Alex</span><div class="msg-s-message-list"><p>Would you like more information about the role?</p><textarea>PRIVATE DRAFT</textarea></div>','https://www.linkedin.com/messaging/thread/fixture/');
  try{const {items}=await extractWorkspace('thread');assert.equal(items[0].title,'Alex');assert.equal(items[0].url,'https://www.linkedin.com/messaging/thread/fixture/');assert.ok(!items[0].text.includes('PRIVATE'));}finally{page.window.close();}
});
function fixture(){
  const data={},state={clock:0,tabs:new Map([[1,{id:1,status:'complete',url:'https://www.linkedin.com/jobs/search/?keywords=platform'}]]),navigations:[],calls:[],blocked:false,failSave:false,stopOnSave:false};
  const storage={get:async key=>structuredClone({[key]:data[key]}),set:async values=>Object.assign(data,structuredClone(values))};
  const connection={token:'fixture-token',account:'alice',scope:'workspace',expiresAt:9999999};
  const chromeApi={storage:{session:storage,local:{get:async()=>({connection})}},tabs:{get:async id=>structuredClone(state.tabs.get(id)),create:async({url})=>{state.tabs.set(2,{id:2,url,status:'complete'});return{id:2};},remove:async id=>state.tabs.delete(id),update:async(id,{url})=>{state.navigations.push({url,at:state.clock});state.tabs.get(id).url=url;}},scripting:{executeScript:async({target,func})=>{
    const tab=state.tabs.get(target.tabId),start=Number(new URL(tab.url).searchParams.get('start')||0);
    let result;
    if(func.name==='workspaceAccess')result={blocked:state.blocked};
    else if(func.name==='extractLinkedinResults')result={jobs:Array.from({length:25},(_,n)=>({id:String(1000+start+n),url:`https://www.linkedin.com/jobs/view/${1000+start+n}/`,title:'Engineer',company:'Example'}))};
    else if(func.name==='scrollJobResults'||func.name==='expandLinkedinDescription')result=false;
    else if(func.name==='extractLinkedinJob')result={url:tab.url,title:'Engineer',company:'Example',text:'Build reliable cloud services for engineering teams. '.repeat(4),place:'Remote',salary:'',remote:true};
    else if(func.name==='extractWorkspace')result={items:[{key:'fixture',title:'Alex',text:'A useful career message excerpt.',url:''}]};
    return[{result}];
  }}};
  let engine;
  const api=async(path,body)=>{state.calls.push({path,body});if(body.kind==='STATUS')return{aiReady:false,model:'fixture',chat:[]};if(body.kind==='JOB_RESULTS')return{items:[]};if(path==='/api/extension/jobs'){if(state.stopOnSave)engine.stopRequested=true;if(state.failSave)throw new Error('Response lost');return{saved:true,id:'saved-'+body.url.split('/').at(-2)};}return{items:[{id:'source-fixture'}],saved:1};};
  engine=new WorkspaceEngine({chromeApi,api,now:()=>state.clock});return{engine,state,data,connection};
}
async function drive(f,count=100){for(let n=0;n<count;n++){const run=(await f.engine.load()).run;if(run.status!=='running')return;f.state.clock=Math.max(f.state.clock,run.nextAt);await f.engine.step();}throw new Error('Run did not settle');}
test('whole search collection paginates, saves full jobs and spaces every navigation',async()=>{
  const f=fixture();await f.engine.start({kind:'jobs',useCurrent:true,limit:30},1);await drive(f);
  const run=(await f.engine.load()).run;assert.equal(run.status,'complete');assert.equal(run.postingIds.length,30);assert.equal(run.pages,2);assert.equal(f.state.calls.filter(c=>c.path==='/api/extension/jobs').length,30);
  assert.ok(f.state.calls.filter(c=>c.path==='/api/extension/jobs').every(c=>c.body.text.length>80));
  for(let n=1;n<f.state.navigations.length;n++)assert.ok(f.state.navigations[n].at-f.state.navigations[n-1].at>=8000);
  assert.equal(f.state.tabs.has(1),true);assert.equal(f.state.tabs.has(2),false);
});
test('lost save response pauses without replay, including after worker restart',async()=>{
  const f=fixture();f.state.failSave=true;await f.engine.start({kind:'jobs',useCurrent:true,limit:2},1);await drive(f);assert.equal((await f.engine.load()).run.status,'paused');
  const saves=()=>f.state.calls.filter(c=>c.path==='/api/extension/jobs').length;assert.equal(saves(),1);await f.engine.step();assert.equal(saves(),1);
  const current=await f.engine.load();current.run.status='running';current.run.phase='saving';await f.engine.store(current);await f.engine.step();assert.equal(saves(),1);assert.equal((await f.engine.load()).run.status,'paused');
});
test('Stop racing an upload retains its confirmed save without another navigation or AI spend',async()=>{
  const f=fixture();f.state.stopOnSave=true;await f.engine.start({kind:'jobs',useCurrent:true,limit:3},1);await drive(f);
  const run=(await f.engine.load()).run;assert.equal(run.status,'stopped');assert.equal(run.postingIds.length,1);assert.equal(f.state.navigations.length,1);assert.ok(!f.state.calls.some(c=>c.body.kind==='REVIEW_JOBS'));
});
test('security checks pause, old grant scopes refuse, and foreign pages cannot start',async()=>{
  const f=fixture();f.state.blocked=true;await f.engine.start({kind:'feed'},1);await drive(f);assert.equal((await f.engine.load()).run.status,'paused');assert.equal(f.state.calls.filter(c=>c.body.kind==='IMPORT_FEED').length,0);
  f.connection.scope='jobs';await assert.rejects(f.engine.start({kind:'feed'},1),/workspace pairing/);
  f.state.tabs.get(1).url='https://www.linkedin.com.evil.test/';await assert.rejects(f.engine.start({kind:'feed'},1),/Open LinkedIn/);
});
test('packaged workspace contains its worker and modal, without the old collection page',async()=>{
  const {readFile}=await import('node:fs/promises'),{unzipSync,strFromU8}=await import('fflate');
  const zip=unzipSync(await readFile(new URL('../../public/careerai-job-clipper.zip',import.meta.url)));
  for(const name of ['worker.mjs','panel.js','workspace-engine.mjs','workspace-capture.mjs','api.mjs','search.mjs','extract.mjs'])assert.ok(zip[name],name+' is packaged');
  assert.equal(JSON.parse(strFromU8(zip['manifest.json'])).version,'0.3.0');assert.equal(zip['collect.html'],undefined);
});
test('worker refuses foreign senders and page pairing, and never returns its bearer token',async()=>{
  const listeners=[],stored={connection:{token:'DO-NOT-EXPOSE',scope:'workspace',account:'alice',expiresAt:Date.now()+100000}};
  const store={get:async key=>({[key]:stored[key]}),set:async value=>Object.assign(stored,value),setAccessLevel:async()=>{}};
  const event={addListener:()=>{}};
  globalThis.chrome={storage:{local:store,session:store},runtime:{id:'own-extension',getURL:path=>'chrome-extension://own-extension/'+path,onMessage:{addListener:fn=>listeners.push(fn)},onInstalled:event,onStartup:event},permissions:{contains:async()=>false,onAdded:event,onRemoved:event},scripting:{getRegisteredContentScripts:async()=>[]},tabs:{onUpdated:event}};
  try{
    await import('./worker.mjs?test-worker');const listener=listeners[0];
    assert.equal(listener({type:'STATUS'},{id:'other-extension',url:'https://www.linkedin.com/feed/'},()=>assert.fail()),false);
    const invoke=(message,sender)=>new Promise(resolve=>listener(message,sender,resolve));
    const refused=await invoke({type:'PAIR',code:'injected'},{id:'own-extension',url:'https://www.linkedin.com/feed/',tab:{id:1}});assert.equal(refused.ok,false);
    const result=await invoke({type:'STATUS'},{id:'own-extension',url:'https://www.linkedin.com/feed/',tab:{id:1}});assert.equal(result.ok,true);assert.equal(result.state.account,'alice');assert.ok(!JSON.stringify(result).includes('DO-NOT-EXPOSE'));
  }finally{delete globalThis.chrome;}
});
