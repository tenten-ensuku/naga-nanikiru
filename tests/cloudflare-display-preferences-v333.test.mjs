import test from 'node:test';
import assert from 'node:assert/strict';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {displayPreferencesRpc} from '../cloudflare/display-preferences-v333.mjs';

function fixture(t){
  const db=testD1();t.after(()=>db.close());
  db.sqlite.exec("INSERT INTO profiles(id,display_name) VALUES('alice','Alice'),('bob','Bob')");
  const rpc=(name,args={},id='alice')=>displayPreferencesRpc(name,args,{db,actor:id?{id}:null});
  return {db,rpc};
}
test('new accounts default to ON without creating rows; setting survives a new client',async t=>{
  const {db,rpc}=fixture(t);
  assert.deepEqual(await rpc('get_display_preferences'),{dora_sheen:true});
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM display_preferences').get().n,0);
  assert.deepEqual(await rpc('save_display_preferences',{p_dora_sheen:false}),{dora_sheen:false});
  const secondClient={db,actor:{id:'alice'}};
  assert.deepEqual(await displayPreferencesRpc('get_display_preferences',{},secondClient),{dora_sheen:false});
  await rpc('save_display_preferences',{p_dora_sheen:true});
  assert.deepEqual(await rpc('get_display_preferences'),{dora_sheen:true});
});
test('authentication and actor ownership prevent reading or changing another account',async t=>{
  const {rpc}=fixture(t);
  for(const name of ['get_display_preferences','save_display_preferences'])await assert.rejects(rpc(name,{p_dora_sheen:false},null),e=>e.status===401);
  await rpc('save_display_preferences',{p_dora_sheen:false,p_user_id:'bob',user_id:'bob'});
  assert.deepEqual(await rpc('get_display_preferences',{p_user_id:'alice'},'bob'),{dora_sheen:true});
  assert.deepEqual(await rpc('get_display_preferences'),{dora_sheen:false});
});
test('only booleans are accepted and other records remain unchanged',async t=>{
  const {db,rpc}=fixture(t),profiles=db.sqlite.prepare('SELECT * FROM profiles').all();
  for(const value of [undefined,null,0,1,'false',{},[]])await assert.rejects(rpc('save_display_preferences',{p_dora_sheen:value}),e=>e.code==='invalid_display_preferences');
  await rpc('save_display_preferences',{p_dora_sheen:false});
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM profiles').all(),profiles);
  for(const table of ['questions','answer_attempts','comments','question_reactions','comment_reactions','notification_preferences'])assert.equal(db.sqlite.prepare(`SELECT count(*) n FROM ${table}`).get().n,0,table);
});
