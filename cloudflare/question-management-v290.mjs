import {ApiError,requireActor,canAccessCollection,canEditCollection,canEditQuestion} from './access.mjs';
import {retiredImageCondition} from './retired-image-write-v265.mjs';

export const QUESTION_MANAGEMENT_RPCS=new Set(['update_shared_question','trash_question','restore_question']);
const fail=(code,status=400)=>{throw new ApiError(code,status);};
function link(value){
  if(typeof value!=='string'||value.length>2048)fail('invalid_question_input');
  if(!value.trim())return '';
  try{const url=new URL(value.trim());if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error();return url.href;}catch{fail('invalid_question_input');}
}
export async function questionManagementRpc(name,args,{db,actor}){
  requireActor(actor);
  if(!QUESTION_MANAGEMENT_RPCS.has(name))fail('rpc_not_allowed',403);
  const q=await db.prepare(`SELECT q.* FROM questions q JOIN collections c ON c.id=q.collection_id
    WHERE q.id=? AND c.archived_at IS NULL`).bind(String(args.p_question_id||'')).first();
  if(!q||!await canAccessCollection(db,actor,q.collection_id))fail('question_not_editable',403);
  const editing=name==='update_shared_question';
  if(!await (editing?canEditQuestion(db,actor,q.id):canEditCollection(db,actor,q.collection_id)))fail('question_not_editable',403);
  const now=new Date().toISOString();
  const author=await db.prepare('SELECT display_name FROM profiles WHERE id=?').bind(actor.id).first();
  let update,event;
  if(editing){
    if(q.deleted_at)fail('question_not_editable',403);
    const title=args.p_title;
    if(typeof title!=='string'||!title.trim()||title.trim().length>200)fail('invalid_question_input');
    const input=args.p_payload;
    if(!input||typeof input!=='object'||Array.isArray(input))fail('invalid_question_input');
    const old=JSON.parse(q.payload),naga=link(input.nagaUrl??old.nagaUrl??''),thread=link(input.threadUrl??old.threadUrl??'');
    const guard=retiredImageCondition({naga,thread});
    // The current editor changes title and reference links only. Start from the
    // stored payload so a stale browser never overwrites answers/board/comments.
    update=db.prepare(`UPDATE questions SET title=?,source_url=?,
      payload=json_set(payload,'$.title',?,'$.nagaUrl',?,'$.threadUrl',?,'$.updatedAt',?,'$.updatedById',?,'$.updatedByName',?),
      updated_at=?,updated_by=?,updated_by_name=? WHERE id=? AND updated_at=? AND deleted_at IS NULL AND ${guard.sql} RETURNING id`)
      .bind(title.trim(),naga||null,title.trim(),naga,thread,now,actor.id,author?.display_name||'',now,actor.id,author?.display_name||'',q.id,q.updated_at,...guard.params);
    event='updated';
  }else{
    const trash=name==='trash_question';
    if(trash===Boolean(q.deleted_at))return {question_id:q.id,unchanged:true};
    update=db.prepare('UPDATE questions SET deleted_at=?,updated_at=?,updated_by=?,updated_by_name=? WHERE id=? AND updated_at=? RETURNING id')
      .bind(trash?now:null,now,actor.id,author?.display_name||'',q.id,q.updated_at);
    event=trash?'trashed':'restored';
  }
  const audit=db.prepare(`INSERT INTO question_audit_events(question_id,collection_id,actor_id,event_type,created_at,snapshot)
    SELECT ?,?,?,?,?,? WHERE changes()=1`).bind(q.id,q.collection_id,actor.id,event,now,JSON.stringify(q));
  let result;
  try{[result]=await db.batch([update,audit]);}catch(error){if(String(error).includes('collection_capacity_reached'))fail('collection_capacity_reached',409);throw error;}
  if(!result.results?.length)fail('question_changed',409);
  return {question_id:q.id};
}
