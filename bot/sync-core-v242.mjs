import {createHash} from 'node:crypto';
import {DISCORD_TARGETS} from '../cloudflare/discord-targets-v242.mjs';
export class SyncError extends Error {
  constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
export const digest=value=>createHash('sha256').update(value).digest('hex');
export function targetFor(guildId,parentId){
  return Object.keys(DISCORD_TARGETS).find(k=>DISCORD_TARGETS[k].guildId===String(guildId)&&DISCORD_TARGETS[k].channelIds.includes(String(parentId)))||null;
}
export function orderedMessages(snapshot){
  const all=new Map();for(const m of [snapshot.parentMessage,...(snapshot.messages||[])])if(m)all.set(String(m.id),m);
  return [...all.values()].sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||String(a.id).localeCompare(String(b.id)));
}
export function fingerprint(snapshot){
  // Signed CDN query strings expire without a content change; never hash them.
  return digest(JSON.stringify({threadId:snapshot.threadId,name:snapshot.threadName,owner:snapshot.threadOwnerId,
    messages:orderedMessages(snapshot).map(m=>({id:m.id,author:m.author,createdAt:m.createdAt,editedAt:m.editedAt,content:m.content,embeds:m.embeds,
      attachments:(m.attachments||[]).map(a=>({id:a.id,name:a.name,size:a.size,contentType:a.contentType}))}))}));
}
export function qualifies(snapshot,key){
  if(targetFor(snapshot.guild?.id,snapshot.parentChannel?.id)!==key||!snapshot.nagaUrls?.[0])return false;
  if(key!=='nima')return true;
  if(Number.isSafeInteger(snapshot.problemNumber))return snapshot.problemNumber>0&&snapshot.problemNumber!==249;
  return orderedMessages(snapshot).some(m=>[m.author?.username,m.author?.displayName].includes('NAGA問題集簡易作成ツール'));
}
export function retryPolicy(error,attempt=1,at=Date.now()){
  if(error.status===429){const tomorrow=new Date(at);tomorrow.setUTCHours(24,5,0,0);return {state:'waiting',retryAt:/daily_limit/.test(error.code||'')?+tomorrow:at+15*60000};}
  if([401,402,403,507].includes(error.status)||/capacity|paused|storage_limit/.test(error.code||''))return {state:'held',retryAt:null};
  if((error.status>=500||!error.status)&&attempt<3)return {state:'waiting',retryAt:at+attempt*5*60000};
  return {state:'held',retryAt:null};
}
export function sceneForExisting(snapshot,row,parse){
  const source= parse(snapshot.nagaUrls[0].originalUrl),saved=parse(row.source_naga_url||row.source_url);
  const equal=(a,b)=>a&&b&&a.reportId===b.reportId&&['tw','ts','tv'].every(k=>a[k]===b[k]);
  const dbScene={reportId:row.source_report_id,tw:row.scene_tw,ts:row.scene_ts,tv:row.scene_tv};
  if(!equal(source,saved)&&!equal(source,dbScene))throw new SyncError('bot_scene_changed_review');
  return dbScene;
}
export async function buildComments(snapshot,{rulesFactory,isImage,uploadAttachment}){
  const messages=orderedMessages(snapshot),starter=snapshot.parentMessage||messages[0];
  const starterAuthorId=snapshot.threadOwnerId||starter?.author?.id;
  const starterImageId=messages.filter(m=>m.author?.id===starterAuthorId).flatMap(m=>m.attachments||[]).find(isImage)?.id;
  const rules=rulesFactory({starterAuthorId,starterMessageId:starter?.id,starterImageId}),comments=[];
  for(const message of messages){
    const ctx={authorId:message.author?.id,messageId:message.id,isStarterMessage:message.id===starter?.id};
    const embeds=(message.embeds||[]).flatMap(e=>[e.title,e.description,...(e.fields||[]).flatMap(f=>[f.name,f.value])]).filter(Boolean);
    const raw=[message.content||'',...embeds.filter(x=>!String(message.content||'').includes(x))].filter(Boolean).join('\n');
    const content=rules.sanitizeContent(raw,ctx),attachments=[];
    for(const attachment of message.attachments||[]){
      if(!isImage(attachment)||rules.shouldDropAttachment(attachment,ctx))continue;
      const asset=await uploadAttachment(attachment);
      attachments.push({src:asset.src,alt:attachment.name||'Discordのコメント画像',spoiler:String(attachment.name||'').startsWith('SPOILER_')});
    }
    if(content.trim()||attachments.length){
      const c={id:message.id,author:message.author?.displayName||message.author?.username||'不明な投稿者',authorId:message.author?.id,createdAt:message.createdAt,content,attachments};
      if(message.author?.avatarUrl)c.avatarUrl=message.author.avatarUrl;
      comments.push(c);
    }
  }
  if(comments.length>200)throw new SyncError('bot_comment_count_review');
  return comments;
}
export async function syncSnapshot(snapshot,key,{api,index,parse,verifiedCandidate,rulesFactory,isImage,uploadAttachment,saveCapture}){
  if(!qualifies(snapshot,key))return {skipped:true,reason:'no_qualifying_naga_source'};
  const fp=fingerprint(snapshot),legacy=DISCORD_TARGETS[key].legacyPrefix+'-'+snapshot.threadId;
  const row=index.questions.find(q=>q.legacy_key===legacy);
  if(row?.deleted_at)throw new SyncError('bot_question_deleted');
  if(row?.fingerprint===fp)return {unchanged:true,question_id:row.id};
  const messages=orderedMessages(snapshot),last=messages.at(-1);
  const input={target:key,threadId:snapshot.threadId,channelId:snapshot.parentChannel.id,fingerprint:fp,lastMessageId:last?.id,sourceUpdatedAt:messages.map(m=>m.editedAt||m.createdAt).sort().at(-1)};
  if(row){input.expectedUpdatedAt=row.updated_at;input.scene=sceneForExisting(snapshot,row,parse);}
  else{
    if(index.capacity.remaining<1)throw new SyncError('collection_capacity_reached');
    const original=snapshot.nagaUrls[0].originalUrl,spec=parse(original);
    if(index.questions.some(q=>!q.deleted_at&&q.source_report_id===spec.reportId&&q.scene_tw===spec.tw&&q.scene_ts===spec.ts&&q.scene_tv===spec.tv))throw new SyncError('bot_duplicate_scene_review');
    const {report,jobId}=await api('naga-report',{target:key,reportId:spec.reportId,targetPlayerSeat:spec.tw,sourceKind:'naga_scene'});
    const candidate=verifiedCandidate(report,original);
    input.scene={reportId:candidate.sourceReportId,tw:candidate.tw,ts:candidate.ts,tv:candidate.tv};
    const capture=await api('naga-capture',{target:key,jobId,...input.scene},{binary:true});
    const asset=await saveCapture(capture);
    input.payload={...candidate,sourceNagaUrl:original,threadUrl:snapshot.threadUrl,sourceProblemNumber:snapshot.problemNumber,
      image:asset.src,images:{off:asset.src,open:asset.src},imageSource:'naga_url',imageSourceRuleVersion:'naga-url-v237',sourceFingerprint:fp};
  }
  input.comments=await buildComments(snapshot,{rulesFactory,isImage,uploadAttachment});
  const result=await api('upsert',input);
  return {...result,fingerprint:fp,commentCount:input.comments.length,scene:input.scene};
}
