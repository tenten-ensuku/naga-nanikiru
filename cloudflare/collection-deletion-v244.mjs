import {ApiError, requireActor, canManageCollection} from './access.mjs';
import {sha256} from './auth.mjs';

// A deletion removes a collection from normal use, but never physically erases
// questions, answers, comments or shared R2 objects. Existing reads already
// exclude archived_at. The target is always the selected book, not its parent.
const fail=(code,status=400)=>{throw new ApiError(code,status);};
const MAX_COLLECTIONS=500;
const SCOPE=`WITH RECURSIVE scope(id) AS (
  SELECT id FROM collections WHERE id=?
  UNION SELECT c.id FROM collections c JOIN scope s ON c.series_parent_id=s.id
), live AS MATERIALIZED (
  SELECT c.id,c.share_slug,c.title,c.owner_id,c.updated_at,c.series_parent_id,c.visibility,
    (SELECT COUNT(*) FROM questions q WHERE q.collection_id=c.id AND q.deleted_at IS NULL) question_count
  FROM collections c JOIN scope s ON s.id=c.id WHERE c.archived_at IS NULL
  ORDER BY c.id LIMIT 501
), snapshot AS MATERIALIZED (
  SELECT json_group_array(json_array(id,share_slug,title,owner_id,updated_at,series_parent_id,visibility,question_count)) value FROM live
)`;
async function selected(args,{db,actor}){
  requireActor(actor);
  const slug=args?.p_share_slug;
  if(typeof slug!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(slug))fail('invalid_collection_input');
  const c=await db.prepare('SELECT id,share_slug,title,owner_id,archived_at,series_parent_id,series_key FROM collections WHERE share_slug=?').bind(slug).first();
  if(!c||!await canManageCollection(db,actor,c.id))fail('collection_not_manageable',403);
  return c;
}
async function snapshotFor(db,id){
  const row=await db.prepare(SCOPE+' SELECT value FROM snapshot').bind(id).first();
  const entries=JSON.parse(row.value);
  if(entries.length>MAX_COLLECTIONS)fail('collection_deletion_too_large',409);
  return {value:row.value,entries};
}
function authorized(entries,actor){
  if(entries.some(row=>row[3]!==actor.id&&actor.is_admin!==true))fail('collection_deletion_mixed_owners',403);
}
const fingerprint=(actor,c,snapshot)=>sha256(JSON.stringify(['collection-deletion-v244',actor.id,c.id,snapshot]));

export async function previewCollectionDeletion(args,context){
  const c=await selected(args,context);
  if(c.archived_at)fail('collection_already_deleted',409);
  const snapshot=await snapshotFor(context.db,c.id);
  authorized(snapshot.entries,context.actor);
  return {
    collection_id:c.id,share_slug:c.share_slug,title:c.title,
    question_count:snapshot.entries.reduce((n,row)=>n+row[7],0),
    collection_count:snapshot.entries.length,
    child_count:snapshot.entries.length-1,
    is_volume:!!c.series_parent_id,
    confirmation_token:await fingerprint(context.actor,c,snapshot.value),
  };
}

export async function deleteCollection(args,context){
  if(args?.p_confirmed!==true||typeof args.p_confirmation_token!=='string'||!/^[a-f0-9]{64}$/.test(args.p_confirmation_token))fail('collection_confirmation_required');
  const c=await selected(args,context);
  // Lost responses / double clicks must never cause a second deletion.
  if(c.archived_at)return {deleted:true,already_deleted:true,share_slug:c.share_slug};
  const snapshot=await snapshotFor(context.db,c.id);
  authorized(snapshot.entries,context.actor);
  if(args.p_confirmation_token!==await fingerprint(context.actor,c,snapshot.value))fail('collection_deletion_changed',409);
  const time=new Date().toISOString();
  // The fingerprint is a stale-preview guard, not an authorization credential.
  // Recheck the complete snapshot and ownership inside ONE atomic UPDATE so
  // a concurrent added question/volume or ownership change cancels all writes.
  const result=await context.db.prepare(SCOPE+`
    UPDATE collections SET archived_at=?,updated_at=?
    WHERE id IN (SELECT id FROM live)
      AND (SELECT value FROM snapshot)=?
      AND NOT EXISTS(SELECT 1 FROM live WHERE owner_id<>? AND ?<>1)
    RETURNING id,share_slug
  `).bind(c.id,time,time,snapshot.value,context.actor.id,context.actor.is_admin===true?1:0).all();
  if(!result.results?.length)fail('collection_deletion_changed',409);
  return {deleted:true,already_deleted:false,share_slug:c.share_slug,collection_count:result.results.length};
}
