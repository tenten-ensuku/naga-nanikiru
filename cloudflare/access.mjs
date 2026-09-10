// Derived from live Supabase private permission functions (2026-09-10).
// Actor is server-authenticated. Never accept is_admin / user ID from a request body.
export class ApiError extends Error {
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
export function requireActor(actor){if(!actor?.id)throw new ApiError('login_required',401);return actor;}
const admin=actor=>actor?.is_admin===true?1:0;
export async function canAccessCollection(db,actor,id){
  const row=await db.prepare(`SELECT 1 AS ok FROM collections c WHERE c.id=? AND c.archived_at IS NULL AND (
    c.owner_id=? OR ?=1 OR (c.published_at IS NOT NULL AND c.visibility IN ('public','unlisted'))
    OR (c.visibility='workspace' AND EXISTS(SELECT 1 FROM workspace_members w WHERE w.workspace_id=c.workspace_id AND w.user_id=? AND w.status='active'))
    OR (c.visibility IN ('private','limited','request') AND EXISTS(SELECT 1 FROM collection_members m WHERE m.collection_id=c.id AND m.user_id=? AND m.status='active'))
  )`).bind(id,actor?.id??null,admin(actor),actor?.id??null,actor?.id??null).first();
  return !!row;
}
export async function canManageCollection(db,actor,id){
  if(!actor?.id)return false;
  return !!await db.prepare('SELECT 1 AS ok FROM collections WHERE id=? AND (owner_id=? OR ?=1)').bind(id,actor.id,admin(actor)).first();
}
export async function canEditCollection(db,actor,id){
  if(!actor?.id)return false;
  return !!await db.prepare(`SELECT 1 AS ok FROM collections c WHERE c.id=? AND c.archived_at IS NULL AND (c.owner_id=? OR ?=1
    OR EXISTS(SELECT 1 FROM collection_members m WHERE m.collection_id=c.id AND m.user_id=? AND m.status='active' AND m.role='editor'))`)
    .bind(id,actor.id,admin(actor),actor.id).first();
}
export async function canEditQuestion(db,actor,id){
  if(!actor?.id)return false;
  const q=await db.prepare('SELECT collection_id,created_by FROM questions WHERE id=?').bind(id).first();
  return !!q&&(q.created_by===actor.id||await canEditCollection(db,actor,q.collection_id));
}
export async function canViewStudent(db,actor,id){
  if(!actor?.id||!id)return false;
  if(actor.id===id)return true;
  if(!admin(actor))return false;
  return !!await db.prepare(`SELECT 1 AS ok FROM workspace_members o JOIN workspace_members s ON s.workspace_id=o.workspace_id
    WHERE o.user_id=? AND o.role='owner' AND o.status='active' AND s.user_id=? AND s.role='student' AND s.status='active' LIMIT 1`)
    .bind(actor.id,id).first();
}
