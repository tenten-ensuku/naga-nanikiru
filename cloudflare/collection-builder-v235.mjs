import {ApiError, requireActor, canEditCollection, canManageCollection, canAccessCollection} from './access.mjs';
import {isGeneratedQuestionTitle} from './question-numbering-v235.mjs';
import {validateStoredHand} from './question-validation-v237.mjs';

export const BOOK_TONES=Object.freeze(['walnut','navy','forest','burgundy','ivory','plum','teal','ochre']);
export const BUILDER_RPCS=Object.freeze(['create_collection','create_collection_volume','set_collection_book_tone','create_shared_question','import_shared_question']);
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const rows=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results||[];
const count=async(db,id)=>Number((await first(db,'SELECT COUNT(*) n FROM questions WHERE collection_id=? AND deleted_at IS NULL',id)).n);
const fail=(code,status=400)=>{throw new ApiError(code,status);};
function text(value,max,required=false){if(typeof value!=='string'||value.trim().length>max||(required&&!value.trim()))fail('invalid_collection_input');return value.trim();}
function tone(value){if(!BOOK_TONES.includes(value))fail('invalid_book_tone');return value;}
async function stableId(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));const h=Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
const slug=id=>id.replaceAll('-','');
async function editable(db,actor,share){const c=await first(db,'SELECT * FROM collections WHERE share_slug=? AND archived_at IS NULL',share);if(!c||!await canEditCollection(db,actor,c.id))fail('collection_not_editable',403);return c;}
async function allowed(db){const control=await first(db,'SELECT armed,blocked,checked_at FROM private_ops_capacity_control WHERE singleton=1');if(control?.armed&&(control.blocked||!Number.isFinite(Date.parse(control.checked_at))||Date.now()-Date.parse(control.checked_at)>86400000))fail('heavy_operations_paused',503);}
async function rootOf(db,c){return c.series_parent_id?await first(db,'SELECT * FROM collections WHERE id=? AND archived_at IS NULL',c.series_parent_id):c;}
async function targetOf(db,actor,c){
  if(c.series_key&&!c.series_parent_id){const children=await rows(db,'SELECT * FROM collections WHERE series_parent_id=? AND archived_at IS NULL ORDER BY volume_number DESC',c.id);if(children.length)c=children[0];}
  if(!await canEditCollection(db,actor,c.id))fail('collection_not_editable',403);return c;
}
export async function collectionCapacity(args,{db,actor}){
  requireActor(actor);const selected=await editable(db,actor,String(args.p_share_slug||''));const c=await targetOf(db,actor,selected);const root=await rootOf(db,c);
  const total=await count(db,c.id),next=Number(c.volume_number||1)+1;
  const existing=await first(db,'SELECT share_slug,title FROM collections WHERE series_parent_id=? AND volume_number=? AND archived_at IS NULL',root.id,next);
  return {share_slug:c.share_slug,collection_title:c.title,question_count:total,limit:200,remaining:Math.max(0,200-total),near_capacity:total>=195,capacity_reached:total>=200,
    parent_share_slug:root.share_slug,volume_number:Number(c.volume_number||1),next_volume:next,next_title:existing?.title||`${root.title.replace(/\s*第\d+巻$/,'')} 第${next}巻`,next_share_slug:existing?.share_slug||null,
    can_create_volume:await canManageCollection(db,actor,root.id),book_tone:c.book_tone||root.book_tone};
}
async function create(args,{db,actor}){
  const title=text(args.p_title,80,true),description=text(args.p_description??'',500),visibility=args.p_visibility??'private',bookTone=tone(args.p_book_tone??'walnut');
  if(!['private','request','public'].includes(visibility)||args.p_workspace_id)fail('invalid_collection_input');
  const request=args.p_request_id;
  if(typeof request!=='string'||!/^[\da-f-]{36}$/i.test(request))fail('invalid_request_id');
  const id=await stableId(`book:${actor.id}:${request}`),share=slug(id);
  const prior=await first(db,'SELECT * FROM collections WHERE id=?',id);if(prior)return prior;
  const created=await first(db,`INSERT INTO collections(id,owner_id,title,description,visibility,share_slug,published_at,allow_contributions,book_tone)
    VALUES(?,?,?,?,?,?,?, ?,?) ON CONFLICT(id) DO NOTHING RETURNING *`,id,actor.id,title,description,visibility,share,visibility==='private'?null:new Date().toISOString(),args.p_allow_contributions===false?0:1,bookTone);
  return created||await first(db,'SELECT * FROM collections WHERE id=?',id);
}
async function createVolume(args,{db,actor}){
  let c=await editable(db,actor,String(args.p_share_slug||''));let root=await rootOf(db,c);
  if(!await canManageCollection(db,actor,root.id))fail('collection_not_manageable',403);
  c=await targetOf(db,actor,c);
  const next=Number(args.p_volume_number??(Number(c.volume_number||1)+1));
  if(!Number.isInteger(next)||next<2||next>10000)fail('invalid_volume_number');
  // Retries and two open tabs must return the same volume, not produce duplicates.
  if(root.series_key){const prior=await first(db,'SELECT * FROM collections WHERE series_parent_id=? AND volume_number=?',root.id,next);if(prior)return prior;}
  const latest=Number((await first(db,'SELECT MAX(volume_number) n FROM collections WHERE series_parent_id=? AND archived_at IS NULL',root.id))?.n||1);
  if(next!==latest+1||await count(db,c.id)<195)fail('volume_not_ready',409);
  const standalone=!root.series_key&&!root.series_parent_id;
  const rootId=standalone?await stableId(`series:${root.id}`):root.id;
  const newId=await stableId(`volume:${rootId}:${next}`),base=root.title.replace(/\s*第\d+巻$/,'');
  const statements=[];
  if(standalone){
    statements.push(db.prepare(`INSERT INTO collections(id,owner_id,workspace_id,title,description,visibility,share_slug,allow_comments,allow_contributions,published_at,series_key,book_tone)
      SELECT ?,owner_id,workspace_id,title,description,visibility,?,allow_comments,allow_contributions,published_at,?,book_tone FROM collections WHERE id=?
      ON CONFLICT(id) DO NOTHING`).bind(rootId,slug(rootId),`series-${rootId}`,root.id));
    statements.push(db.prepare(`UPDATE collections SET series_parent_id=?,series_key=?,volume_number=1,volume_start=1,volume_end=200,title=?,updated_at=? WHERE id=? AND series_parent_id IS NULL`).bind(rootId,`series-${rootId}`,`${base} 第1巻`,new Date().toISOString(),root.id));
    statements.push(db.prepare(`INSERT INTO collection_members(collection_id,user_id,role,status,granted_by,granted_at,revoked_at) SELECT ?,user_id,role,status,granted_by,granted_at,revoked_at FROM collection_members WHERE collection_id=? ON CONFLICT(collection_id,user_id) DO NOTHING`).bind(rootId,root.id));
  }
  statements.push(db.prepare(`INSERT INTO collections(id,owner_id,workspace_id,title,description,visibility,share_slug,allow_comments,allow_contributions,published_at,series_key,series_parent_id,volume_number,volume_start,volume_end,book_tone)
    SELECT ?,owner_id,workspace_id,?,description,visibility,?,allow_comments,allow_contributions,published_at,series_key,id,?,?,?,book_tone FROM collections WHERE id=?
    ON CONFLICT(series_parent_id,volume_number) WHERE series_parent_id IS NOT NULL AND volume_number IS NOT NULL DO NOTHING`).bind(newId,`${base} 第${next}巻`,slug(newId),next,(next-1)*200+1,next*200,rootId));
  statements.push(db.prepare(`INSERT INTO collection_members(collection_id,user_id,role,status,granted_by,granted_at,revoked_at) SELECT ?,user_id,role,status,granted_by,granted_at,revoked_at FROM collection_members WHERE collection_id=? ON CONFLICT(collection_id,user_id) DO NOTHING`).bind(newId,rootId));
  await db.batch(statements);
  return first(db,'SELECT * FROM collections WHERE series_parent_id=? AND volume_number=?',rootId,next);
}
async function setTone(args,{db,actor}){
  const c=await editable(db,actor,String(args.p_share_slug||''));if(!await canManageCollection(db,actor,c.id))fail('collection_not_manageable',403);
  return first(db,'UPDATE collections SET book_tone=?,updated_at=? WHERE id=? RETURNING share_slug,book_tone',tone(args.p_book_tone),new Date().toISOString(),c.id);
}
// Content uploads and NAGA retrieval remain separately gated. This small RPC only
// accepts already prepared structured questions, never embedded image bytes.
async function addQuestion(args,{db,actor},imported=null){
  const c=await targetOf(db,actor,await editable(db,actor,String(args.p_share_slug||'')));
  const payload=args.p_payload;if(!payload||typeof payload!=='object'||Array.isArray(payload))fail('invalid_question');
  const serialized=JSON.stringify(payload);
  if(new TextEncoder().encode(serialized).length>100000||/data:image\//i.test(serialized))fail('question_image_upload_required',413);
  const kind=args.p_source_kind??'manual',decision=args.p_decision_type??'discard';
    if(!['manual','discord','naga_scene','naga_match'].includes(kind)||!['discard','call','riichi','combined'].includes(decision))fail('invalid_question');
    if(Array.isArray(payload.handBeforeDraw)||(!imported&&['naga_scene','naga_match','discord'].includes(kind)))validateStoredHand(payload,decision);
  const report=args.p_source_report_id?text(args.p_source_report_id,240):null;
  const scene=[args.p_scene_tw,args.p_scene_ts,args.p_scene_tv].map((v,i)=>{if(v==null)return null;if(!Number.isSafeInteger(v)||v<0||v>(i===0?3:100000))fail('invalid_question');return v;});
  const key=imported?`import:${imported}`:String(payload.id||'');if(!key||key.length>240)fail('invalid_question');
  const prior=await first(db,`SELECT id FROM questions WHERE collection_id=? AND (legacy_key=? OR (source_report_id IS NOT NULL AND source_report_id=? AND scene_tw IS ? AND scene_ts IS ? AND scene_tv IS ?)) AND deleted_at IS NULL`,c.id,key,report,...scene);
  if(prior)return {question_id:prior.id,already_exists:true,share_slug:c.share_slug};
  const capacity=await collectionCapacity({p_share_slug:c.share_slug},{db,actor});if(capacity.capacity_reached)return {...capacity,requires_volume_confirmation:true};
  const id=crypto.randomUUID(),now=new Date().toISOString(),originalTitle=text(args.p_title??'',160);
  const title=isGeneratedQuestionTitle(originalTitle)||originalTitle==='生成候補'?'':originalTitle;
  const profile=await first(db,'SELECT display_name FROM profiles WHERE id=?',actor.id);
  // Assign in the INSERT itself: two concurrent inserts cannot select the same number.
  const validNumberSql=`CASE WHEN json_type(payload,'$.number') IN ('integer','text') AND CAST(json_extract(payload,'$.number') AS TEXT) NOT GLOB '*[^0-9]*' AND CAST(json_extract(payload,'$.number') AS INTEGER) BETWEEN 1 AND 9007199254740000 THEN CAST(json_extract(payload,'$.number') AS INTEGER) END`;
  const numberSql=`(SELECT MAX(COALESCE(MAX(valid),0),?)+COUNT(*)-COUNT(DISTINCT valid)+1 FROM (SELECT ${validNumberSql} valid FROM questions WHERE collection_id=?))`;
  const normalized={...payload};for(const k of ['serverQuestionId','sharedCollectionSlug','createdById','createdByName','updatedById','updatedByName','_sharedIndexOnlyV170'])delete normalized[k];
  try{
    const inserted=await first(db,`WITH next(n) AS (SELECT ${numberSql}) INSERT INTO questions(id,collection_id,created_by,created_by_name,title,legacy_key,sort_order,source_kind,source_report_id,source_url,scene_tw,scene_ts,scene_tv,decision_type,payload,created_at,updated_at)
      SELECT ?,?,?,?,CASE WHEN ?='' THEN '問題'||n ELSE ? END,?,n,?,?,?,?,?,?,?,json_set(?,'$.number',n,'$.id',?,'$.title',CASE WHEN ?='' THEN '問題'||n ELSE ? END),?,? FROM next
      WHERE (SELECT COUNT(*) FROM questions WHERE collection_id=? AND deleted_at IS NULL)<200 RETURNING id,sort_order`,Number(c.volume_start||1)-1,c.id,id,c.id,actor.id,String(profile?.display_name||'プレイヤー').slice(0,80),title,title,key,kind,report,args.p_source_url?text(args.p_source_url,2000):null,...scene,decision,JSON.stringify(normalized),id,title,title,now,now,c.id);
    if(!inserted)return {...await collectionCapacity({p_share_slug:c.share_slug},{db,actor}),requires_volume_confirmation:true};
    return {question_id:inserted.id,question_number:inserted.sort_order,share_slug:c.share_slug,question_count:await count(db,c.id),collection_title:c.title};
  }catch(error){
    if(String(error.message).includes('collection_capacity_reached'))return {...await collectionCapacity({p_share_slug:c.share_slug},{db,actor}),requires_volume_confirmation:true};
    if(String(error.message).includes('UNIQUE constraint')){const prior=await first(db,`SELECT id FROM questions WHERE collection_id=? AND (legacy_key=? OR (source_report_id IS NOT NULL AND source_report_id=? AND scene_tw IS ? AND scene_ts IS ? AND scene_tv IS ?)) AND deleted_at IS NULL`,c.id,key,report,...scene);if(prior)return {question_id:prior.id,already_exists:true,share_slug:c.share_slug};}
    throw error;
  }
}
async function importQuestion(args,ctx){
  const source=await first(ctx.db,'SELECT * FROM questions WHERE id=? AND deleted_at IS NULL',String(args.p_source_question_id||''));
  if(!source||!await canAccessCollection(ctx.db,ctx.actor,source.collection_id))fail('question_not_found',404);
  return addQuestion({p_share_slug:args.p_target_share_slug,p_title:source.title,p_payload:JSON.parse(source.payload),p_source_kind:source.source_kind,p_source_report_id:source.source_report_id,p_source_url:source.source_url,p_scene_tw:source.scene_tw,p_scene_ts:source.scene_ts,p_scene_tv:source.scene_tv,p_decision_type:source.decision_type},ctx,source.id);
}
export async function builderRpc(name,args,ctx){
  requireActor(ctx.actor);await allowed(ctx.db);
  switch(name){case 'create_collection':return create(args,ctx);case 'create_collection_volume':return createVolume(args,ctx);case 'set_collection_book_tone':return setTone(args,ctx);case 'create_shared_question':return addQuestion(args,ctx);case 'import_shared_question':return importQuestion(args,ctx);default:fail('rpc_not_allowed',403);}
}
