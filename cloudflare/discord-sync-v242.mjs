import {ApiError} from './access.mjs';
import {sha256} from './auth.mjs';
import {DISCORD_TARGETS} from './discord-targets-v242.mjs';
import {builderRpc,collectionCapacity} from './collection-builder-v235.mjs';
import {imageUpload,questionMediaKeys} from './media-write-v241.mjs';
import {retiredImageCondition} from './retired-image-write-v265.mjs';
import {createGenerationApi} from './generation-api-v241.mjs';
import {requireGenerationCapacity,reserveUsage} from './generation-capacity-v241.mjs';
const fail=(code,status=400)=>{throw new ApiError(code,status);};
const snowflake=v=>typeof v==='string'&&/^\d{15,22}$/.test(v);
const rows=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results||[];
const now=()=>new Date().toISOString();
export async function authenticateDiscordBot(request,env){
 if(env.DISCORD_SYNC_ENABLED!=='true'||!env.DISCORD_SYNC_TOKEN)fail('bot_paused',503);
 const token=request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{40,128})$/)?.[1];
 if(!token||await sha256(token)!==await sha256(env.DISCORD_SYNC_TOKEN))fail('bot_auth_required',401);
 // Machine-only API: browser sessions and cross-origin requests are not accepted.
 if(request.headers.has('Origin')||request.headers.has('Cookie'))fail('bot_machine_only',403);
}
function validComments(value){
 if(!Array.isArray(value)||value.length>200)fail('bot_comments_invalid');
 for(const c of value){if(!snowflake(c?.id)||typeof c.content!=='string'||c.content.length>12000||typeof c.author!=='string'||c.author.length>160||!Number.isFinite(Date.parse(c.createdAt)))fail('bot_comments_invalid');}
 return value;
}
export function mergeDiscordComments(existing,incoming){
 const result=Array.isArray(existing)?structuredClone(existing):[],byId=new Map(result.map((c,i)=>[String(c.id),i]));
 for(const comment of incoming){const index=byId.get(comment.id);if(index===undefined){byId.set(comment.id,result.length);result.push(comment);}else result[index]={...result[index],...comment};}
 return result; // Never remove an app-side or older transferred comment implicitly.
}
async function context(env,key,targets){
 const target=targets[key];if(!target)fail('bot_target_denied',403);
 const root=await env.DB.prepare('SELECT * FROM collections WHERE id=? AND archived_at IS NULL').bind(target.collectionId).first();
 if(!root)fail('bot_target_missing',409);
 const actor={id:root.owner_id,is_admin:false};
 return {target,root,actor,db:env.DB,origin:env.APP_ORIGIN};
}
async function lookup(ctx,threadId){
 const key=ctx.target.legacyPrefix+'-'+threadId;
 return ctx.db.prepare(`SELECT q.*,c.share_slug,c.archived_at AS collection_archived_at FROM questions q JOIN collections c ON c.id=q.collection_id
 WHERE q.legacy_key=? AND (c.id=? OR c.series_parent_id=?) LIMIT 1`).bind(key,ctx.root.id,ctx.root.id).first();
}
async function writeReceipt(ctx,input,qId){
 await ctx.db.prepare(`INSERT INTO private_discord_sync(target,thread_id,question_id,fingerprint,last_message_id,source_updated_at,synced_at) VALUES(?,?,?,?,?,?,?)
 ON CONFLICT(target,thread_id) DO UPDATE SET question_id=excluded.question_id,fingerprint=excluded.fingerprint,last_message_id=excluded.last_message_id,source_updated_at=excluded.source_updated_at,synced_at=excluded.synced_at`)
 .bind(input.target,input.threadId,qId,input.fingerprint,input.lastMessageId||null,input.sourceUpdatedAt||null,now()).run();
}
function checkSource(input,target){
 if(!snowflake(input.threadId)||!target.channelIds.includes(input.channelId)||!/^([a-f0-9]{64})$/.test(input.fingerprint||'')||input.lastMessageId&&!snowflake(input.lastMessageId))fail('bot_source_invalid');
}
export function createDiscordSyncApi({targets=DISCORD_TARGETS,generation=createGenerationApi({cache:globalThis.caches?.default??null})}={}){
 return async function handle(request,env,input={}){
  await authenticateDiscordBot(request,env);
  if(request.method!=='POST')fail('method_not_allowed',405);
  const op=new URL(request.url).pathname.replace('/api/bot/','');
  const key=input.target||request.headers.get('X-Discord-Target');
  const ctx=await context(env,key,targets),{db,target,root,actor}=ctx;
  if(op==='heartbeat'){
   if(!['running','paused','error'].includes(input.status)||!Number.isInteger(input.pending)||input.pending<0||input.pending>10000)fail('bot_status_invalid');
   await db.prepare('INSERT INTO private_discord_bot_status(target,checked_at,pending,status,last_error) VALUES(?,?,?,?,?) ON CONFLICT(target) DO UPDATE SET checked_at=excluded.checked_at,pending=excluded.pending,status=excluded.status,last_error=excluded.last_error')
    .bind(key,now(),input.pending,input.status,String(input.error||'').replace(/https?:\/\/\S+/g,'[url]').slice(0,120)||null).run();
   return {ok:true};
  }
  if(op==='index'){
   const questions=await rows(db,`SELECT q.id,q.legacy_key,q.updated_at,q.deleted_at,q.source_report_id,q.source_url,json_extract(q.payload,'$.sourceNagaUrl') source_naga_url,q.scene_tw,q.scene_ts,q.scene_tv,s.fingerprint,s.last_message_id
    FROM questions q JOIN collections c ON c.id=q.collection_id LEFT JOIN private_discord_sync s ON s.question_id=q.id AND s.target=?
    WHERE (c.id=? OR c.series_parent_id=?) AND q.legacy_key LIKE ? LIMIT 5000`,key,root.id,root.id,target.legacyPrefix+'-%');
   return {questions,capacity:await collectionCapacity({p_share_slug:root.share_slug},ctx)};
  }
  await requireGenerationCapacity(env);
  if(op==='assets'){
   const headers=new Headers(request.headers);headers.set('X-Asset-Bucket','question-assets');headers.set('X-Collection-Slug',root.share_slug);headers.delete('X-Collection-Id');
   return imageUpload(new Request(request,{headers}),env,actor,{purpose:request.headers.get('X-Bot-Asset-Purpose')==='comment'?'comment':'question'});
  }
  if(op==='naga-report'||op==='naga-capture')return generation(op,input,env,actor);
  if(op!=='upsert')fail('bot_operation_denied',403);
  checkSource(input,target);const old=await lookup(ctx,input.threadId);
  if(old?.deleted_at||old?.collection_archived_at)fail('bot_question_deleted',409);
  const receipt=await db.prepare('SELECT fingerprint FROM private_discord_sync WHERE target=? AND thread_id=?').bind(key,input.threadId).first();
  if(old&&receipt?.fingerprint===input.fingerprint)return {question_id:old.id,share_slug:old.share_slug,unchanged:true};
  if(old&&(typeof input.expectedUpdatedAt!=='string'||old.updated_at!==input.expectedUpdatedAt))fail('bot_question_conflict',409);
  if(!old&&input.expectedUpdatedAt)fail('bot_question_conflict',409);
  await reserveUsage(db,'bot_changes','all',1,100);
  const comments=validComments(input.comments||[]);
  await questionMediaKeys({comments,payload:input.payload},{db,actor,origin:env.APP_ORIGIN},root.id);
  let result;
  if(old){
   // Existing source decisions and V237 repairs are not regenerated because of
   // a comment. A changed NAGA scene is held for review rather than overwritten.
   if(input.scene?.reportId!==old.source_report_id||input.scene?.tw!==old.scene_tw||input.scene?.ts!==old.scene_ts||input.scene?.tv!==old.scene_tv)fail('bot_scene_changed_review',409);
   if(input.payload)fail('bot_existing_payload_denied',409);
   const payload=JSON.parse(old.payload);payload.comments=mergeDiscordComments(payload.comments,comments);
   payload.commentTransferRuleVersion='v7-starter-author-first-naga-url';
   const changed=JSON.stringify(payload)!==old.payload;const stamp=now();
   if(changed){
    if(new TextEncoder().encode(JSON.stringify(payload)).length>120000)fail('bot_payload_too_large',413);
    const imageGuard=retiredImageCondition(payload);
    const updated=await db.prepare('UPDATE questions SET payload=?,updated_at=?,updated_by=?,updated_by_name=? WHERE id=? AND updated_at=? AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM collections c WHERE c.id=questions.collection_id AND c.archived_at IS NULL) AND '+imageGuard.sql+' RETURNING id')
     .bind(JSON.stringify(payload),stamp,actor.id,'Discord Bot',old.id,input.expectedUpdatedAt,...imageGuard.params).first();
    if(!updated)fail('bot_question_conflict',409);
    await db.prepare(`INSERT OR IGNORE INTO media_question_links(object_key,question_id) SELECT m.object_key,q.id FROM questions q,json_tree(q.payload) j JOIN media_assets m ON m.object_key=substr(j.value,instr(j.value,'/v1/private/')+12) WHERE q.id=? AND j.type='text' AND instr(j.value,'/v1/private/')>0 AND m.state='ready'`).bind(old.id).run();
   }
   result={question_id:old.id,share_slug:old.share_slug,updated:changed,updated_at:changed?stamp:old.updated_at};
  }else{
   if(!input.payload||input.payload.generationRuleVersion!=='meld-replay-v237')fail('bot_verified_payload_required',422);
   let url;try{url=new URL(input.payload.nagaUrl);}catch{fail('bot_scene_invalid',422);}
   if(url.origin!=='https://naga.dmv.nico'||url.searchParams.get('report_id')!==input.scene?.reportId||['tw','ts','tv'].some(k=>url.searchParams.get(k)!==String(input.scene?.[k])||input.payload[k]!==input.scene?.[k])||input.payload.sourceReportId!==input.scene?.reportId)fail('bot_scene_invalid',422);
   const duplicate=await db.prepare('SELECT q.id FROM questions q JOIN collections c ON c.id=q.collection_id WHERE (c.id=? OR c.series_parent_id=?) AND q.source_report_id=? AND q.scene_tw=? AND q.scene_ts=? AND q.scene_tv=? AND q.deleted_at IS NULL LIMIT 1').bind(root.id,root.id,input.scene.reportId,input.scene.tw,input.scene.ts,input.scene.tv).first();
   if(duplicate)fail('bot_duplicate_scene_review',409);
   const threadUrl='https://discord.com/channels/'+target.guildId+'/'+input.threadId;
   const payload={...input.payload,id:target.legacyPrefix+'-'+input.threadId,threadUrl,comments,commentTransferRuleVersion:'v7-starter-author-first-naga-url'};
   result=await builderRpc('create_shared_question',{p_share_slug:root.share_slug,p_payload:payload,p_source_kind:'discord',p_source_report_id:input.scene?.reportId,p_source_url:payload.nagaUrl,p_scene_tw:input.scene?.tw,p_scene_ts:input.scene?.ts,p_scene_tv:input.scene?.tv,p_decision_type:payload.decisionType||'discard'},ctx);
   if(result.requires_volume_confirmation)fail('collection_capacity_reached',409);
   // A scene imported by a person is not silently relabelled as a Bot thread.
   if(result.already_exists&&!await lookup(ctx,input.threadId))fail('bot_duplicate_scene_review',409);
  }
  await writeReceipt(ctx,{...input,target:key},result.question_id);
  return result;
 };
}
