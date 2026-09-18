import {ApiError, requireActor, canManageCollection} from './access.mjs';

export const MANAGER_READ_RPCS = new Set(['search_collection_manager_candidates','list_collection_managers']);
export const MANAGER_WRITE_RPCS = new Set(['set_collection_manager']);
const fail = (code,status=400) => { throw new ApiError(code,status); };
const all = async (db,sql,...values) => (await db.prepare(sql).bind(...values).all()).results || [];

async function ownedBook(db,actor,share) {
  const book = typeof share==='string' && await db.prepare('SELECT id,owner_id FROM collections WHERE share_slug=? AND archived_at IS NULL').bind(share).first();
  if (!book || !await canManageCollection(db,actor,book.id)) fail('collection_owner_required',403);
  return book;
}

export async function validatedManagerIds(db,ownerId,input=[]) {
  if (!Array.isArray(input) || input.length>20 || input.some(id=>typeof id!=='string'||!id||id.length>80)) fail('invalid_manager_selection');
  const ids=[...new Set(input)].filter(id=>id!==ownerId);
  if (!ids.length) return [];
  const users=await all(db,`SELECT user_id FROM auth_identities WHERE disabled=0 AND user_id IN (${ids.map(()=>'?').join(',')})`,...ids);
  if(users.length!==ids.length) fail('manager_account_unavailable',409);
  return ids;
}

export async function managerRpc(name,args,{db,actor}) {
  requireActor(actor);
  if(name==='search_collection_manager_candidates') {
    const book=args.p_share_slug ? await ownedBook(db,actor,args.p_share_slug) : null;
    const query=typeof args.p_query==='string' ? args.p_query.trim() : '';
    if(!query || query.length>80) return [];
    return all(db,`SELECT p.id AS user_id,p.display_name,p.created_at AS registered_at,
      substr(a.discord_user_id,-6) AS account_hint
      FROM profiles p JOIN auth_identities a ON a.user_id=p.id
      WHERE a.disabled=0 AND p.id<>? AND (instr(lower(p.display_name),lower(?))>0 OR a.discord_user_id=?)
      ORDER BY p.display_name,p.created_at DESC,p.id LIMIT 20`,book?.owner_id||actor.id,query,query);
  }
  if(!MANAGER_READ_RPCS.has(name) && !MANAGER_WRITE_RPCS.has(name)) fail('rpc_not_allowed',403);
  const book=await ownedBook(db,actor,args.p_share_slug);
  if(name==='list_collection_managers') {
    return all(db,`SELECT m.user_id,p.display_name,p.created_at AS registered_at,
      substr(a.discord_user_id,-6) AS account_hint,m.granted_at,a.disabled
      FROM collection_managers m JOIN profiles p ON p.id=m.user_id
      LEFT JOIN auth_identities a ON a.user_id=p.id
      WHERE m.collection_id=? AND m.status='active' ORDER BY p.display_name,p.created_at DESC`,book.id);
  }
  if(typeof args.p_enabled!=='boolean'||typeof args.p_user_id!=='string'||!args.p_user_id||args.p_user_id.length>80) fail('invalid_manager_selection');
  if(args.p_user_id===book.owner_id) fail('collection_owner_unchanged',409);
  const now=new Date().toISOString();
  // Repeat ownership in the write itself so a stale page cannot grant access
  // after ownership has changed. The current actor comes from the session.
  const ownerGuard=`EXISTS(SELECT 1 FROM collections c WHERE c.id=? AND c.archived_at IS NULL AND (c.owner_id=? OR ?=1))`;
  let result;
  if(args.p_enabled) {
    await validatedManagerIds(db,book.owner_id,[args.p_user_id]);
    result=await db.prepare(`INSERT INTO collection_managers(collection_id,user_id,status,granted_by,granted_at,revoked_at)
      SELECT ?,?,'active',?,?,NULL WHERE ${ownerGuard}
      AND EXISTS(SELECT 1 FROM auth_identities WHERE user_id=? AND disabled=0)
      AND ((SELECT COUNT(*) FROM collection_managers WHERE collection_id=? AND status='active')<20
        OR EXISTS(SELECT 1 FROM collection_managers WHERE collection_id=? AND user_id=? AND status='active'))
      ON CONFLICT(collection_id,user_id) DO UPDATE SET status='active',granted_by=excluded.granted_by,
        granted_at=CASE WHEN collection_managers.status='active' THEN collection_managers.granted_at ELSE excluded.granted_at END,revoked_at=NULL
      RETURNING user_id,status`).bind(book.id,args.p_user_id,actor.id,now,book.id,actor.id,actor.is_admin===true?1:0,args.p_user_id,book.id,book.id,args.p_user_id).first();
    if(!result && await canManageCollection(db,actor,book.id)) fail('invalid_manager_selection');
  } else {
    result=await db.prepare(`UPDATE collection_managers SET status='revoked',revoked_at=?
      WHERE collection_id=? AND user_id=? AND ${ownerGuard} RETURNING user_id,status`)
      .bind(now,book.id,args.p_user_id,book.id,actor.id,actor.is_admin===true?1:0).first();
    if(!result && await canManageCollection(db,actor,book.id)) return {user_id:args.p_user_id,status:'revoked'};
  }
  if(!result) fail('collection_owner_required',403);
  return result;
}
