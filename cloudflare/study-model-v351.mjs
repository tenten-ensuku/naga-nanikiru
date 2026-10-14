import {ApiError,requireActor,canAccessCollection,canManageCollectionContent} from './access.mjs';
export const STUDY_MODEL_READ_RPCS=new Set(['get_collection_study_model']);
export const STUDY_MODEL_WRITE_RPCS=new Set(['save_collection_study_model','set_collection_default_model']);
const names=new Set(['ニシキ','ヒバカリ','カガシ','アナンタ','ウロボロス','ガンマ','オメガ']);
const schemas=new WeakMap();
// Additive, fixed schema only. Existing question and history tables are untouched.
export function ensureStudyModelSchema(db){
 if(!schemas.has(db))schemas.set(db,(async()=>{
  const rows=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('collection_study_models','study_model_preferences')").all()).results||[];
  if(rows.length===2)return;
  const allowed=[...names].map(name=>`'${name}'`).join(',');
  await db.batch([
   db.prepare(`CREATE TABLE IF NOT EXISTS collection_study_models (collection_id TEXT PRIMARY KEY REFERENCES collections(id) ON DELETE CASCADE,default_model TEXT NOT NULL CHECK(default_model IN (${allowed})))`),
   db.prepare(`CREATE TABLE IF NOT EXISTS study_model_preferences (user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,model TEXT NOT NULL CHECK(model IN (${allowed})),PRIMARY KEY(user_id,collection_id))`)
  ]);
 })().catch(error=>{schemas.delete(db);throw error;}));
 return schemas.get(db);
}
export async function studyModelRpc(name,args,{db,actor}){
 requireActor(actor);
 const c=await db.prepare('SELECT id,series_parent_id FROM collections WHERE share_slug=? AND archived_at IS NULL').bind(String(args.p_share_slug||'')).first();
 if(!c||!await canAccessCollection(db,actor,c.id))throw new ApiError('collection_not_accessible',403);
 await ensureStudyModelSchema(db);
 if(STUDY_MODEL_WRITE_RPCS.has(name)){
  if(!names.has(args.p_model)&&!(name==='save_collection_study_model'&&args.p_model===null))throw new ApiError('invalid_study_model');
  if(name==='set_collection_default_model'){
   if(!await canManageCollectionContent(db,actor,c.id))throw new ApiError('collection_not_manageable',403);
   await db.prepare('INSERT INTO collection_study_models(collection_id,default_model) VALUES(?,?) ON CONFLICT(collection_id) DO UPDATE SET default_model=excluded.default_model').bind(c.id,args.p_model).run();
  }else if(args.p_model===null)await db.prepare('DELETE FROM study_model_preferences WHERE user_id=? AND collection_id=?').bind(actor.id,c.id).run();
  else await db.prepare('INSERT INTO study_model_preferences(user_id,collection_id,model) VALUES(?,?,?) ON CONFLICT(user_id,collection_id) DO UPDATE SET model=excluded.model').bind(actor.id,c.id,args.p_model).run();
 }else if(!STUDY_MODEL_READ_RPCS.has(name))throw new ApiError('unknown_rpc',404);
 const defaults=await db.prepare('SELECT default_model FROM collection_study_models WHERE collection_id IN (?,?) ORDER BY CASE WHEN collection_id=? THEN 0 ELSE 1 END LIMIT 1').bind(c.id,c.series_parent_id||c.id,c.id).first();
 const preference=await db.prepare('SELECT model FROM study_model_preferences WHERE user_id=? AND collection_id=?').bind(actor.id,c.id).first();
 return {default_model:defaults?.default_model||'ニシキ',preferred_model:preference?.model||null};
}
