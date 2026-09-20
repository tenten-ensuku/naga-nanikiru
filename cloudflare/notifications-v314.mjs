import {ApiError,requireActor} from './access.mjs';

export const NOTIFICATION_READ_RPCS=new Set(['get_notification_preferences','list_account_notifications','get_notification_target']);
export const NOTIFICATION_WRITE_RPCS=new Set(['save_notification_preferences','mark_account_notifications_read']);
export const DEFAULT_PREFERENCES=Object.freeze({enabled:true,created_comments:true,managed_comments:true,conversation_comments:true,added_questions:false,access_requests:true});
const keys=Object.keys(DEFAULT_PREFERENCES);
const all=async(db,sql,...params)=>(await db.prepare(sql).bind(...params).all()).results||[];
// c and u are always SQL aliases owned by this module, never request input.
const accessible=`c.archived_at IS NULL AND (c.owner_id=u.id OR EXISTS(SELECT 1 FROM auth_identities ai WHERE ai.user_id=u.id AND ai.is_admin=1 AND ai.disabled=0)
 OR (c.published_at IS NOT NULL AND c.visibility IN ('public','unlisted'))
 OR EXISTS(SELECT 1 FROM collection_managers m WHERE m.collection_id=c.id AND m.user_id=u.id AND m.status='active')
 OR (c.visibility='workspace' AND EXISTS(SELECT 1 FROM workspace_members w WHERE w.workspace_id=c.workspace_id AND w.user_id=u.id AND w.status='active'))
 OR (c.visibility IN ('private','limited','request') AND EXISTS(SELECT 1 FROM collection_members m WHERE m.collection_id=c.id AND m.user_id=u.id AND m.status='active')))`;
const idSql="lower(hex(randomblob(16)))";

// Append these statements to the same D1 transaction as the originating write.
// INSERT SELECT also ensures a failed/duplicate question or comment creates no event.
export function commentNotificationStatement(db,commentId){
 return db.prepare(`INSERT OR IGNORE INTO account_notifications(id,recipient_id,actor_id,kind,event_id,collection_id,question_id,comment_id,created_at)
 SELECT ${idSql},u.id,cm.user_id,'comment',cm.id,c.id,q.id,cm.id,cm.created_at
 FROM comments cm JOIN questions q ON q.id=cm.question_id JOIN collections c ON c.id=q.collection_id
 JOIN profiles u ON u.id<>cm.user_id LEFT JOIN notification_preferences p ON p.user_id=u.id
 WHERE cm.id=? AND cm.deleted_at IS NULL AND q.deleted_at IS NULL AND ${accessible} AND COALESCE(p.enabled,1)=1 AND (
 (COALESCE(p.created_comments,1)=1 AND q.created_by=u.id)
 OR (COALESCE(p.managed_comments,1)=1 AND (c.owner_id=u.id OR EXISTS(SELECT 1 FROM collection_managers m WHERE m.collection_id=c.id AND m.user_id=u.id AND m.status='active')))
 OR (COALESCE(p.conversation_comments,1)=1 AND EXISTS(SELECT 1 FROM comments prior WHERE prior.question_id=q.id AND prior.user_id=u.id AND prior.deleted_at IS NULL)))`).bind(commentId);
}
export function questionNotificationStatement(db,questionId){
 return db.prepare(`INSERT OR IGNORE INTO account_notifications(id,recipient_id,actor_id,kind,event_id,collection_id,question_id,created_at)
 SELECT ${idSql},u.id,q.created_by,'question',q.id,c.id,q.id,q.created_at
 FROM questions q JOIN collections c ON c.id=q.collection_id JOIN notification_subscriptions s ON s.collection_id=COALESCE(c.series_parent_id,c.id)
 JOIN profiles u ON u.id=s.user_id AND u.id<>q.created_by JOIN notification_preferences p ON p.user_id=u.id
 WHERE q.id=? AND q.deleted_at IS NULL AND p.enabled=1 AND p.added_questions=1 AND ${accessible}`).bind(questionId);
}
export function accessNotificationStatement(db,requestId){
 return db.prepare(`INSERT OR IGNORE INTO account_notifications(id,recipient_id,actor_id,kind,event_id,collection_id,request_id,created_at)
 SELECT ${idSql},c.owner_id,r.requester_id,'access_requested',r.id,c.id,r.id,r.created_at
 FROM collection_access_requests r JOIN collections c ON c.id=r.collection_id LEFT JOIN notification_preferences p ON p.user_id=c.owner_id
 WHERE r.id=? AND c.owner_id<>r.requester_id AND COALESCE(p.enabled,1)=1 AND COALESCE(p.access_requests,1)=1`).bind(requestId);
}
async function preferences(db,actor){
 const row=await db.prepare('SELECT * FROM notification_preferences WHERE user_id=?').bind(actor.id).first();
 const collections=await all(db,`SELECT DISTINCT root.id,root.title,root.share_slug,root.series_key,root.volume_number
 FROM collections c JOIN collections root ON root.id=COALESCE(c.series_parent_id,c.id) JOIN profiles u ON u.id=?
 WHERE ${accessible} AND root.archived_at IS NULL ORDER BY root.title,root.id`,actor.id);
 const subscriptions=await all(db,'SELECT collection_id FROM notification_subscriptions WHERE user_id=?',actor.id);
 return {preferences:Object.fromEntries(keys.map(k=>[k,row?Boolean(row[k]):DEFAULT_PREFERENCES[k]])),subscriptions:subscriptions.map(s=>s.collection_id),collections};
}
async function savePreferences(db,actor,args){
 const p=args.p_preferences,subscriptions=args.p_subscriptions;
 if(!p||keys.some(k=>typeof p[k]!=='boolean')||!Array.isArray(subscriptions)||subscriptions.length>500||subscriptions.some(id=>typeof id!=='string'||id.length>200))throw new ApiError('invalid_notification_preferences');
 const available=await preferences(db,actor),allowed=new Set(available.collections.map(c=>c.id));
 // Keep already saved subscriptions even when access has since been revoked.
 const prior=new Set(available.subscriptions),ids=[...new Set(subscriptions)];
 if(ids.some(id=>!allowed.has(id)&&!prior.has(id)))throw new ApiError('notification_collection_unavailable',403);
 const statements=[db.prepare(`INSERT INTO notification_preferences(user_id,${keys.join(',')}) VALUES (?,${keys.map(()=>'?').join(',')}) ON CONFLICT(user_id) DO UPDATE SET ${keys.map(k=>`${k}=excluded.${k}`).join(',')}`).bind(actor.id,...keys.map(k=>Number(p[k]))),db.prepare('DELETE FROM notification_subscriptions WHERE user_id=?').bind(actor.id)];
 if(ids.length)statements.push(db.prepare('INSERT INTO notification_subscriptions(user_id,collection_id) SELECT ?,value FROM json_each(?)').bind(actor.id,JSON.stringify(ids)));
 await db.batch(statements);return preferences(db,actor);
}
const inboxSelect=`SELECT n.*,c.title collection_title,c.share_slug,c.owner_id,c.archived_at,
 q.title question_title,q.deleted_at question_deleted,q.collection_id question_collection,
 substr(cm.body,1,160) body,cm.deleted_at comment_deleted,cm.question_id comment_question,
 r.message request_message,r.status request_status,author.display_name actor_name,
 CASE WHEN c.id IS NOT NULL AND ${accessible} THEN 1 ELSE 0 END can_access,
 c.id found_collection,q.id found_question,cm.id found_comment,r.id found_request
 FROM account_notifications n JOIN profiles u ON u.id=n.recipient_id
 LEFT JOIN collections c ON c.id=n.collection_id LEFT JOIN questions q ON q.id=n.question_id
 LEFT JOIN comments cm ON cm.id=n.comment_id LEFT JOIN collection_access_requests r ON r.id=n.request_id
 LEFT JOIN profiles author ON author.id=n.actor_id`;
function decorate(row,actor){
 const result={id:row.id,kind:row.kind,collection_id:row.collection_id,question_id:row.question_id,comment_id:row.comment_id,request_id:row.request_id,created_at:row.created_at,read_at:row.read_at,available:true};
 let reason='';
 if(!row.found_collection||row.archived_at)reason='この問題集は削除されています。';
 else if(!row.can_access)reason='この問題集を閲覧する権限がありません。';
 else if(row.request_id&&row.owner_id!==actor.id&&!actor.is_admin)reason='この申請を確認する権限がありません。';
 if(reason)return {...result,available:false,unavailable_reason:reason};
 Object.assign(result,{actor_name:row.actor_name||'利用者',collection_title:row.collection_title,share_slug:row.share_slug,question_title:row.question_title||'',body:row.request_id?row.request_message:row.body||'',request_status:row.request_status});
 if(row.question_id&&(!row.found_question||row.question_deleted||row.question_collection!==row.collection_id))reason='この問題は削除または移動されています。';
 else if(row.comment_id&&(!row.found_comment||row.comment_deleted||row.comment_question!==row.question_id))reason='このコメントは削除されています。';
 else if(row.request_id&&!row.found_request)reason='この申請は削除されています。';
 if(reason){result.available=false;result.unavailable_reason=reason;result.body='';}
 return result;
}
export async function notificationRpc(name,args,{db,actor}){
 requireActor(actor);
 if(name==='get_notification_preferences')return preferences(db,actor);
 if(name==='save_notification_preferences')return savePreferences(db,actor,args);
 if(name==='get_notification_target'){
  const row=await db.prepare(inboxSelect+' WHERE n.id=? AND n.recipient_id=?').bind(String(args.p_id||''),actor.id).first();
  if(!row)throw new ApiError('notification_not_found',404);
  return decorate(row,actor);
 }
 if(name==='list_account_notifications'){
  const cursor=args.p_cursor; if(cursor&&(typeof cursor.created_at!=='string'||typeof cursor.id!=='string'))throw new ApiError('invalid_notification_cursor');
  const rows=await all(db,`${inboxSelect} WHERE n.recipient_id=? AND (?=0 OR n.read_at IS NULL)
   ${cursor?'AND (n.created_at<? OR (n.created_at=? AND n.id<?))':''} ORDER BY n.created_at DESC,n.id DESC LIMIT 51`,actor.id,args.p_unread_only===true?1:0,...(cursor?[cursor.created_at,cursor.created_at,cursor.id]:[]));
  const more=rows.length>50,page=rows.slice(0,50),last=page.at(-1);
  const count=await db.prepare('SELECT COUNT(*) n FROM account_notifications WHERE recipient_id=? AND read_at IS NULL').bind(actor.id).first();
  return {items:page.map(row=>decorate(row,actor)),unread_count:count.n,next_cursor:more?{created_at:last.created_at,id:last.id}:null};
 }
 if(name==='mark_account_notifications_read'){
  const ids=args.p_ids;
  if(ids!==null&&(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string')))throw new ApiError('invalid_notification_ids');
  if(ids?.length===0)return true;
  const now=new Date().toISOString(),where=ids?'AND id IN ('+ids.map(()=>'?').join(',')+')':'';
  await db.batch(['account_notifications','collection_access_notifications'].map(table=>db.prepare(`UPDATE ${table} SET read_at=COALESCE(read_at,?) WHERE recipient_id=? ${where}`).bind(now,actor.id,...(ids||[]))));return true;
 }
 throw new ApiError('rpc_not_allowed',403);
}
