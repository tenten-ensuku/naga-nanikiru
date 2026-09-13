// The legacy package supplies Discord parsing/rules only. Its old bot and all
// Supabase sync modules are deliberately never imported or executed.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {DISCORD_TARGETS} from '../cloudflare/discord-targets-v242.mjs';
import {generator,verifiedSceneCandidate} from '../scripts/naga-generator-runtime.mjs';
import {SyncError,digest,targetFor,fingerprint,retryPolicy,syncSnapshot} from './sync-core-v242.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const parseEnv=text=>Object.fromEntries(text.split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).trim().replace(/^(['"])(.*)\1$/,'$2')];}));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const canonical='https://minkiru.naga-study.workers.dev';
export async function limitedBytes(response,max){
  if(Number(response.headers.get('content-length'))>max)throw new SyncError('remote_body_too_large',413);
  const reader=response.body?.getReader();if(!reader)throw new SyncError('remote_empty_body',502);
  let size=0;const parts=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new SyncError('remote_body_too_large',413);}parts.push(Buffer.from(value));}}finally{reader.releaseLock();}return Buffer.concat(parts);
}
export async function createRuntime({legacyRoot=path.resolve(root,'../../outputs/naga-thread-bot'),stateRoot=path.join(root,'output/discord-bot-v242')}={}){
  const env=parseEnv(await fs.readFile(path.join(legacyRoot,'.env'),'utf8'));
  const local=parseEnv(await fs.readFile(path.join(root,'.env.minkiru-bot'),'utf8').catch(()=>''));
  const discordToken=env.DISCORD_BOT_TOKEN,botToken=local.DISCORD_SYNC_TOKEN;
  if(!discordToken)throw new SyncError('discord_token_missing',401);
  const requireLegacy=createRequire(path.join(legacyRoot,'package.json'));
  const {Client,GatewayIntentBits}=requireLegacy('discord.js');
  const {buildThreadSnapshot}=await import(pathToFileURL(path.join(legacyRoot,'src/snapshot.mjs')));
  const {createThreadCommentRules,isImageAttachment}=await import(pathToFileURL(path.join(legacyRoot,'src/nima-comment-rules.mjs')));
  const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent]});
  await fs.mkdir(path.join(stateRoot,'assets'),{recursive:true});await fs.mkdir(path.join(stateRoot,'snapshots'),{recursive:true});
  const statePath=path.join(stateRoot,'state.json');
  const state=JSON.parse(await fs.readFile(statePath,'utf8').catch(()=>'{"queue":{},"seen":{},"assets":{},"status":{}}'));
  const indexes={};let stopping=false,persistChain=Promise.resolve();
  function save(){const data=JSON.stringify(state,null,2);persistChain=persistChain.then(async()=>{await fs.writeFile(statePath+'.tmp',data);await fs.rename(statePath+'.tmp',statePath);});return persistChain;}
  function log(event,details={}){process.stdout.write(JSON.stringify({at:new Date().toISOString(),event,...details})+'\n');}
  client.on('error',()=>log('discord_client_error'));
  async function api(op,input,{binary=false,bytes,type,purpose}={}){
    if(!botToken)throw new SyncError('cloudflare_bot_token_missing',401);
    if(!['index','heartbeat','assets','naga-report','naga-capture','upsert'].includes(op))throw new SyncError('bot_operation_denied',403);
    const headers={Authorization:'Bearer '+botToken,'Content-Type':bytes?type:'application/json','X-Discord-Target':input.target};
    if(bytes){headers['X-Asset-Sha256']=digest(bytes);headers['X-Bot-Asset-Purpose']=purpose||'question';}
    const response=await fetch(canonical+'/api/bot/'+op,{method:'POST',headers,body:bytes||JSON.stringify(input),redirect:'error',signal:AbortSignal.timeout(binary?70000:40000)});
    if(!response.ok){const data=await response.json().catch(()=>({}));throw new SyncError(data.error||'bot_api_error',response.status);}
    if(binary)return {bytes:await limitedBytes(response,8*1024*1024),type:response.headers.get('content-type')?.split(';')[0]};
    return JSON.parse((await limitedBytes(response,op==='naga-report'?34*1024*1024:2*1024*1024)).toString());
  }
  async function discord(route){
    const response=await fetch('https://discord.com/api/v10'+route,{headers:{Authorization:'Bot '+discordToken},redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new SyncError('discord_'+response.status,response.status);
    return JSON.parse((await limitedBytes(response,3*1024*1024)).toString());
  }
  async function refreshIndex(key){indexes[key]=await api('index',{target:key});return indexes[key];}
  async function discover(){
    const summary={};
    for(const [key,target] of Object.entries(DISCORD_TARGETS)){
      let checked=0,added=0;const active=await discord('/guilds/'+target.guildId+'/threads/active');
      const threads=new Map((active.threads||[]).filter(t=>target.channelIds.includes(t.parent_id)).map(t=>[t.id,t]));
      // Bounded recovery window. Each archive page contains metadata, not bodies.
      // Older unprocessed IDs remain recorded and are never mass-rewritten.
      for(const parent of target.channelIds){
        const page=await discord('/channels/'+parent+'/threads/archived/public?limit=50');
        for(const t of page.threads||[])threads.set(t.id,t);
        await delay(150);
      }
      for(const thread of threads.values()){
        checked++;const seen=state.seen[thread.id],q=state.queue[thread.id];
        const row=indexes[key]?.questions.find(x=>x.legacy_key===target.legacyPrefix+'-'+thread.id);
        const last=thread.last_message_id||null;
        // Existing imported threads are rechecked only when recently active.
        const recent=Date.parse(thread.thread_metadata?.archive_timestamp||'')>Date.now()-14*86400000;
        const changed=seen?seen.lastMessageId!==last:row?.last_message_id?row.last_message_id!==last:(!row||recent);
        if(changed&&!q){state.queue[thread.id]={key,threadId:thread.id,state:'pending',attempts:0,addedAt:new Date().toISOString()};added++;}
      }
      summary[key]={metadataChecked:checked,newlyQueued:added,pending:Object.values(state.queue).filter(q=>q.key===key).length};
    }
    await save();log('discovered',summary);return summary;
  }
  async function snapshot(threadId,key){
    const thread=await client.channels.fetch(threadId,{force:true});
    if(!thread?.isThread?.()||targetFor(thread.guildId,thread.parentId)!==key)throw new SyncError('discord_scope_denied',403);
    const starter=await thread.fetchStarterMessage();
    const messages=new Map();let before,done=false;
    for(let page=0;page<10;page++){
      const batch=await thread.messages.fetch({limit:100,...(before?{before}:{})});
      for(const m of batch.values())messages.set(m.id,m);
      if(batch.size<100){done=true;break;}before=batch.last().id;
    }
    if(!done)throw new SyncError('thread_too_large_review');
    const result=buildThreadSnapshot({thread,starterMessage:starter,messages:[...messages.values()]});
    for(const m of [result.parentMessage,...result.messages]){
      if(!m)continue;const source=messages.get(m.id)||starter;
      if(source?.author)m.author.avatarUrl=source.author.displayAvatarURL({size:128,extension:'png'});
    }
    await fs.writeFile(path.join(stateRoot,'snapshots',threadId+'.json'),JSON.stringify(result));
    return result;
  }
  async function upload(key,bytes,type,purpose){
    if(!['image/png','image/jpeg','image/webp','image/gif'].includes(type))throw new SyncError('attachment_format_review',415);
    const hash=digest(bytes),ext=type.split('/')[1];await fs.writeFile(path.join(stateRoot,'assets',hash+'.'+ext),bytes,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    return api('assets',{target:key},{bytes,type,purpose});
  }
  async function attachment(key,a){
    const cache=key+':'+a.id;if(state.assets[cache])return state.assets[cache];
    let url;try{url=new URL(a.url);}catch{throw new SyncError('attachment_url_invalid',422);}
    if(url.protocol!=='https:'||!['cdn.discordapp.com','media.discordapp.net'].includes(url.hostname)||!url.pathname.startsWith('/attachments/'))throw new SyncError('attachment_url_invalid',422);
    if(a.size>5*1024*1024)throw new SyncError('attachment_too_large_review',413);
    const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new SyncError('attachment_fetch_failed',response.status);
    const asset=await upload(key,await limitedBytes(response,5*1024*1024),response.headers.get('content-type')?.split(';')[0],'comment');
    state.assets[cache]=asset;await save();return asset;
  }
  async function processOne(entry,{dry=false}={}){
    const {key,threadId}=entry;const snap=await snapshot(threadId,key);
    if(dry)return {key,threadId,name:snap.threadName,number:snap.problemNumber,messages:snap.messages.length,nagaUrls:snap.nagaUrls.length,fingerprint:fingerprint(snap)};
    const index=indexes[key]||await refreshIndex(key);
    const result=await syncSnapshot(snap,key,{api,index,parse:generator.parseNagaUrl,verifiedCandidate:verifiedSceneCandidate,rulesFactory:createThreadCommentRules,isImage:isImageAttachment,
      uploadAttachment:a=>attachment(key,a),saveCapture:c=>upload(key,c.bytes,c.type,'question')});
    state.seen[threadId]={fingerprint:fingerprint(snap),lastMessageId:snap.messages.at(-1)?.id,result,checkedAt:new Date().toISOString()};
    delete state.queue[threadId];await save();if(result.question_id&&!result.unchanged)await refreshIndex(key);
    log('synced',{key,threadId,...result});return result;
  }
  async function heartbeat(){
    for(const key of Object.keys(DISCORD_TARGETS)){
      const queued=Object.values(state.queue).filter(q=>q.key===key),held=queued.find(q=>q.state==='held');
      const value={target:key,pending:queued.length,status:state.pausedReason||state.waitUntil>Date.now()?'paused':'running',error:state.pausedReason||(held?'held:'+queued.filter(q=>q.state==='held').length+':'+held.error:'')};
      await api('heartbeat',value);state.status[key]={...value,checkedAt:new Date().toISOString()};
    }await save();
  }
  function enqueue(thread){
    const key=targetFor(thread?.guildId,thread?.parentId);if(!key)return;
    const existing=state.queue[thread.id];if(existing?.state==='held')return;
    state.queue[thread.id]={key,threadId:thread.id,state:'pending',attempts:0,retryAt:Date.now()+15000,addedAt:new Date().toISOString()};void save();
  }
  async function connect(){
    await client.login(discordToken);if(!client.isReady())await new Promise((resolve,reject)=>{client.once('clientReady',resolve);setTimeout(()=>reject(new SyncError('discord_connect_timeout',503)),30000).unref();});
    log('connected',{targets:Object.keys(DISCORD_TARGETS)});
  }
  async function run(){
    await Promise.all(Object.keys(DISCORD_TARGETS).map(refreshIndex));
    client.on('threadCreate',enqueue);client.on('threadUpdate',(_a,b)=>enqueue(b));
    for(const event of ['messageCreate','messageUpdate'])client.on(event,(...args)=>{const m=args.at(-1);if(m?.channel?.isThread?.())enqueue(m.channel);});
    await discover();await heartbeat();let discoveryAt=Date.now(),heartbeatAt=Date.now();
    while(!stopping){
      const entry=!state.pausedReason&&(!state.waitUntil||state.waitUntil<=Date.now())&&Object.values(state.queue).find(q=>q.state!=='held'&&(!q.retryAt||q.retryAt<=Date.now()));
      if(entry){
        try{await processOne(entry);}catch(e){
          entry.attempts=(entry.attempts||0)+1;Object.assign(entry,retryPolicy(e,entry.attempts),{error:e.code||'sync_unavailable'});await save();
          if(e.code==='bot_question_conflict')await refreshIndex(entry.key).catch(()=>{});
          log('deferred',{key:entry.key,threadId:entry.threadId,error:entry.error,state:entry.state});
          // System-wide failures hold all pending transfers for operator review.
          if([401,402,507].includes(e.status)||/capacity_unavailable|heavy_operations_paused|storage_limit/.test(e.code||'')){
            state.pausedReason=entry.error;
            for(const q of Object.values(state.queue))Object.assign(q,{state:'held',error:entry.error});await save();
          }
          if(e.status===429&&/daily_limit/.test(e.code||'')){state.waitUntil=entry.retryAt;await save();}
        }
        await delay(65000);
      }else await delay(5000);
      if(Date.now()-discoveryAt>15*60000){try{await discover();}catch(e){log('discovery_failed',{error:e.code||'discord_unavailable'});}discoveryAt=Date.now();}
      if(Date.now()-heartbeatAt>3600000){try{await heartbeat();}catch(e){log('heartbeat_failed',{error:e.code||'api_unavailable'});}heartbeatAt=Date.now();}
    }
  }
  return {state,api,refreshIndex,discover,snapshot,processOne,heartbeat,connect,run,async stop(){stopping=true;client.destroy();await save();}};
}
