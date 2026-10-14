import test from 'node:test';
import assert from 'node:assert/strict';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {studyModelRpc,ensureStudyModelSchema} from '../cloudflare/study-model-v351.mjs';
import {builderRpc} from '../cloudflare/collection-builder-v235.mjs';
function fixture(){
 const db=testD1();
 for(const id of ['owner','alice','bob','manager'])db.sqlite.prepare('INSERT INTO profiles(id,display_name) VALUES(?,?)').run(id,id);
 for(const [id,visibility] of [['book','public'],['other','private'],['parent','public'],['volume','public']])db.sqlite.prepare('INSERT INTO collections(id,owner_id,title,share_slug,visibility,published_at,series_parent_id) VALUES(?,?,?,?,?,?,?)').run(id,'owner',id,id,visibility,visibility==='public'?'2026-10-14':null,id==='volume'?'parent':null);
 const rpc=(name,actor='alice',slug='book',model)=>studyModelRpc(name,{p_share_slug:slug,...model!==undefined?{p_model:model}:{},p_user_id:'bob',is_admin:true},{db,actor:{id:actor}});
 return {db,rpc};
}
test('first authenticated use creates only the new preference tables and later calls remain read-only',async()=>{
 const {db,rpc}=fixture();try{
  db.sqlite.exec('DROP TABLE study_model_preferences; DROP TABLE collection_study_models;');
  const collections=db.sqlite.prepare('SELECT * FROM collections').all();
  await assert.rejects(rpc('get_collection_study_model','alice','other'));
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='study_model_preferences'").get().n,0);
  await rpc('get_collection_study_model');const before=db.sqlite.prepare('SELECT * FROM study_model_preferences').all();
  await Promise.all([ensureStudyModelSchema(db),ensureStudyModelSchema(db)]);
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM collections').all(),collections);
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM study_model_preferences').all(),before);
 }finally{db.close();}
});
test('preferences survive a new read and stay isolated by book and authenticated user',async()=>{
 const {db,rpc}=fixture();try{
  assert.deepEqual(await rpc('get_collection_study_model'),{default_model:'ニシキ',preferred_model:null});
  await rpc('save_collection_study_model','alice','book','ウロボロス');
  assert.equal((await rpc('get_collection_study_model')).preferred_model,'ウロボロス');
  assert.equal((await rpc('get_collection_study_model','bob')).preferred_model,null);
  assert.equal((await rpc('get_collection_study_model','alice','parent')).preferred_model,null);
  await rpc('save_collection_study_model','alice','book',null);assert.equal((await rpc('get_collection_study_model')).preferred_model,null);
 }finally{db.close();}
});
test('only book content managers can set a default, with inheritance from a series parent',async()=>{
 const {db,rpc}=fixture();try{
  await assert.rejects(rpc('set_collection_default_model','alice','book','ウロボロス'),e=>e.status===403);
  db.sqlite.prepare("INSERT INTO collection_managers(collection_id,user_id,status,granted_by) VALUES('book','manager','active','owner')").run();
  await rpc('set_collection_default_model','manager','book','アナンタ');
  await rpc('set_collection_default_model','owner','parent','ウロボロス');assert.equal((await rpc('get_collection_study_model','alice','volume')).default_model,'ウロボロス');
  await rpc('set_collection_default_model','owner','volume','アナンタ');assert.equal((await rpc('get_collection_study_model','alice','volume')).default_model,'アナンタ');
  assert.equal((await rpc('get_collection_study_model','bob')).default_model,'アナンタ');
 }finally{db.close();}
});
test('private and archived books, unauthenticated actors, and invalid models reject writes',async()=>{
 const {db,rpc}=fixture();try{
  await assert.rejects(rpc('save_collection_study_model','alice','other','アナンタ'),e=>e.status===403);
  await assert.rejects(studyModelRpc('get_collection_study_model',{p_share_slug:'book'},{db,actor:null}),e=>e.status===401);
  await assert.rejects(rpc('save_collection_study_model','alice','book','unknown'),e=>e.code==='invalid_study_model');
  db.sqlite.prepare("UPDATE collections SET archived_at='2026-10-14' WHERE id='book'").run();
  await assert.rejects(rpc('get_collection_study_model'),e=>e.status===403);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM study_model_preferences').get().n,0);
 }finally{db.close();}
});
test('creating the next volume carries a standalone book recommendation into the new series',async()=>{
 const {db,rpc}=fixture();try{
  await rpc('set_collection_default_model','owner','book','ウロボロス');
  const insert=db.sqlite.prepare("INSERT INTO questions(id,collection_id,created_by,title,payload) VALUES(?,'book','owner',?,'{}')");
  for(let i=1;i<=195;i++)insert.run('q'+i,'問題'+i);
  const volume=await builderRpc('create_collection_volume',{p_share_slug:'book',p_volume_number:2},{db,actor:{id:'owner'}});
  assert.equal((await rpc('get_collection_study_model','alice',volume.share_slug)).default_model,'ウロボロス');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM questions').get().n,195);
 }finally{db.close();}
});
