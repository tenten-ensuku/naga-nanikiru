import {ApiError,requireActor,canEditCollection,canAccessCollection} from './access.mjs';
import {imageType} from '../worker/media.mjs';
import {requireGenerationCapacity,reserveUsage,nowIso} from './generation-capacity-v241.mjs';
import {canReadPrivateAsset} from './media-read.mjs';
import {retiredImageCondition} from './retired-image-write-v265.mjs';
const rules={'question-assets':10485760,'comment-assets':5242880,'reaction-assets':1048576};
const extensions={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'};
export async function boundedBytes(source,maximum){
  if(Number(source.headers.get('content-length'))>maximum)throw new ApiError('request_too_large',413);
  const reader=source.body?.getReader();if(!reader)throw new ApiError('empty_body',400);
  const parts=[];let length=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>maximum){await reader.cancel();throw new ApiError('request_too_large',413);}parts.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}
export async function imageUpload(request,env,actor,{purpose='question'}={}){
  requireActor(actor);if(env.UPLOADS_ENABLED!=='true')throw new ApiError('heavy_operations_paused',503);
  const bucket=request.headers.get('x-asset-bucket');if(!Object.hasOwn(rules,bucket))throw new ApiError('media_bucket_invalid',400);
  const slug=request.headers.get('x-collection-slug'),id=request.headers.get('x-collection-id');let collection=null;
  if(slug||id){collection=await env.DB.prepare('SELECT * FROM collections WHERE '+(slug?'share_slug':'id')+'=? AND archived_at IS NULL').bind(slug||id).first();if(!collection||(id&&collection.id!==id))throw new ApiError('collection_not_found',403);}
  if(bucket==='question-assets'){
    if(!collection||!await canEditCollection(env.DB,actor,collection.id))throw new ApiError('collection_not_editable',403);
    if(collection.series_key&&!collection.series_parent_id){
      const child=await env.DB.prepare('SELECT * FROM collections WHERE series_parent_id=? AND archived_at IS NULL ORDER BY volume_number DESC LIMIT 1').bind(collection.id).first();
      if(child)collection=child;
      if(!await canEditCollection(env.DB,actor,collection.id))throw new ApiError('collection_not_editable',403);
    }
    const count=await env.DB.prepare('SELECT COUNT(*) n FROM questions WHERE collection_id=? AND deleted_at IS NULL').bind(collection.id).first();
    if(count.n>=200&&purpose!=='comment')throw new ApiError('collection_capacity_reached',409);
  }else if(bucket==='comment-assets'&&(!collection||!collection.allow_comments||!await canAccessCollection(env.DB,actor,collection.id)))throw new ApiError('collection_not_accessible',403);
  await requireGenerationCapacity(env);
  const bytes=await boundedBytes(request,rules[bucket]),type=imageType(bytes);
  if(!type||type!==request.headers.get('content-type')?.split(';')[0]||(bucket==='question-assets'&&type==='image/gif'))throw new ApiError('media_content_type_invalid',415);
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  if(request.headers.get('x-asset-sha256')!==sha256)throw new ApiError('media_hash_mismatch',422);
  const folder=bucket==='question-assets'?'questions/'+collection.id:bucket==='comment-assets'?'comments':'reactions';
  const path=actor.id+'/'+folder+'/'+sha256+'.'+extensions[type],key=bucket+'/'+path;
  const imageGuard=retiredImageCondition(key),claimAt=nowIso();
  const asset=await env.DB.prepare('SELECT * FROM media_assets WHERE object_key=?').bind(key).first();
  if(asset&&(!['pending','ready'].includes(asset.state)||asset.owner_id!==actor.id||asset.sha256!==sha256||asset.size_bytes!==bytes.length))throw new ApiError('media_asset_conflict',409);
  // A pending row belongs to one in-flight PUT. Blind retry could revive an
  // object after another request completed and the operator deleted it.
  // Interrupted pending rows remain reserved for explicit operator recovery.
  if(asset?.state==='pending')throw new ApiError('media_upload_pending',409);
  let claimed=false;
  if(!asset){
    await reserveUsage(env.DB,'uploads','all',1,150);
    try{claimed=!!await env.DB.prepare(`INSERT INTO media_assets(object_key,bucket,path,owner_id,collection_id,size_bytes,sha256,content_type,state,updated_at) SELECT ?,?,?,?,?,?,?,?,'pending',? WHERE ${imageGuard.sql} ON CONFLICT(object_key) DO NOTHING RETURNING object_key`)
      .bind(key,bucket,path,actor.id,collection?.id??null,bytes.length,sha256,type,claimAt,...imageGuard.params).first();}
    catch(error){if(String(error.message).includes('media_capacity_unavailable'))throw new ApiError('media_capacity_unavailable',507);throw error;}
    if(!claimed)throw new ApiError('media_upload_pending',409);
  }
  let object=await env.IMAGES.head(key);const reused=!!object;
  if(object&&(object.size!==bytes.length||object.customMetadata?.sha256!==sha256))throw new ApiError('media_object_mismatch',409);
  if(!object){
    if(!claimed){
      // Deletion claims only ready rows. This same-statement retirement check
      // and ready->pending claim keep deletion and a replacement PUT exclusive.
      claimed=!!await env.DB.prepare(`UPDATE media_assets SET state='pending',updated_at=? WHERE object_key=? AND state='ready' AND updated_at=? AND ${imageGuard.sql} RETURNING object_key`)
        .bind(claimAt,key,asset.updated_at,...imageGuard.params).first();
      if(!claimed)throw new ApiError('media_asset_conflict',409);
    }
    object=await env.IMAGES.put(key,bytes,{sha256,onlyIf:{etagDoesNotMatch:'*'},storageClass:'Standard',httpMetadata:{contentType:type},customMetadata:{sha256}});object||=await env.IMAGES.head(key);
  }
  if(!object||object.size!==bytes.length||object.customMetadata?.sha256!==sha256)throw new ApiError('media_object_mismatch',409);
  if(claimed){
    const completed=await env.DB.prepare("UPDATE media_assets SET state='ready',updated_at=? WHERE object_key=? AND state='pending' AND updated_at=? RETURNING object_key").bind(nowIso(),key,claimAt).first();
    if(!completed)throw new ApiError('media_asset_conflict',409);
  }else{
    const current=await env.DB.prepare(`SELECT object_key FROM media_assets WHERE object_key=? AND state='ready' AND ${imageGuard.sql}`).bind(key,...imageGuard.params).first();
    if(!current)throw new ApiError('media_asset_conflict',409);
  }
  const route=bucket==='question-assets'?'private':'public';
  return {bucket,path,src:new URL(request.url).origin+'/v1/'+route+'/'+key,size:bytes.length,sha256,reused};
}
export async function questionMediaKeys(payload,{db,actor,origin},targetId){
  const keys=new Set();
  function visit(value){if(typeof value==='string'&&value.includes('/v1/private/')){let url;try{url=new URL(value);}catch{throw new ApiError('question_media_invalid',422);}if(url.origin!==(origin||'https://minkiru.naga-study.workers.dev')||url.search||url.hash)throw new ApiError('question_media_invalid',422);const key=decodeURIComponent(url.pathname.split('/v1/private/')[1]||'');if(!key.startsWith('question-assets/')||key.includes('..')||key.includes('%'))throw new ApiError('question_media_invalid',422);keys.add(key);}else if(value&&typeof value==='object')for(const child of Object.values(value))visit(child);}
  visit(payload);if(keys.size>8)throw new ApiError('question_media_invalid',422);
  for(const key of keys){const row=await db.prepare("SELECT object_key,owner_id,collection_id FROM media_assets WHERE object_key=? AND state='ready'").bind(key).first();if(!row||!await canReadPrivateAsset({DB:db,MEDIA_LINKS_ENABLED:'true'},actor,row))throw new ApiError('media_access_denied',403);}
  return [...keys];
}
