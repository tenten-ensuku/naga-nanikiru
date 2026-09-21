import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {readRpc} from '../cloudflare/read-api.mjs';
import {writeRpc} from '../cloudflare/student-write-api.mjs';
import {STANDARD_REACTION_KEYS,isAddedStandardReaction} from '../cloudflare/standard-reactions-v329.mjs';
import worker from '../cloudflare/worker.mjs';
import {sha256} from '../cloudflare/auth.mjs';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const ctx=vm.createContext({});vm.runInContext(html.slice(html.indexOf('    const REACTION_DEFINITIONS_V209 ='),html.indexOf('    const REACTION_TOP_KEYS_V211 ='))+'\nglobalThis.base=REACTION_DEFINITIONS_V209;',ctx);
const initial=()=>Array.from(ctx.base,item=>({key:item.storageKey,label:item.label,icon:item.icon,iconType:item.iconType||'emoji',tone:item.tone,hidden:false}));
const addition={key:'standard_'+'f'.repeat(32),label:'ここを確認',icon:'🔎',iconType:'emoji',tone:'teal',hidden:false};
const save=(ctx,rows,revision=0)=>writeRpc('save_standard_reactions',{p_rows:rows,p_revision:revision},ctx);
function setup(t){
  const db=testD1();t.after(()=>db.close());
  for(const [i,id] of ['admin','member'].entries()){
    db.sqlite.prepare('INSERT INTO profiles(id,display_name) VALUES(?,?)').run(id,id);
    db.sqlite.prepare('INSERT INTO auth_identities(user_id,discord_user_id,is_admin) VALUES(?,?,?)').run(id,'11111111111111111'+i,Number(id==='admin'));
  }
  db.sqlite.exec(`INSERT INTO collections(id,owner_id,title,share_slug,visibility,published_at,allow_comments) VALUES('book','member','fixture','book','public','2026-09-22',1);
    INSERT INTO questions(id,collection_id,title,payload,created_by,updated_by) VALUES('question','book','fixture','{}','member','member');
    INSERT INTO question_reactions(question_id,user_id,reaction_key) VALUES('question','member','difficult');`);
  return {db,actor:{id:'admin',is_admin:true}};
}
test('catalog starts with bundled defaults and every existing storage key is preserved',async t=>{
  const ctx=setup(t);assert.deepEqual(initial().map(row=>row.key),STANDARD_REACTION_KEYS);
  assert.deepEqual(await readRpc('get_standard_reactions',{},ctx),{revision:0,rows:[]});
  const before=ctx.db.sqlite.prepare('SELECT * FROM question_reactions').all();
  const rows=initial().reverse();rows.find(row=>row.key==='difficult').label='難しい';
  const result=await save(ctx,rows);assert.equal(result.revision,1);assert.deepEqual(result.rows,rows);
  assert.deepEqual(await readRpc('get_standard_reactions',{}, {...ctx,actor:{id:'member',is_admin:false}}),result);
  assert.deepEqual(ctx.db.sqlite.prepare('SELECT * FROM question_reactions').all(),before);
});
test('only a trusted administrator can mutate the shared catalog',async()=>{
  const db={prepare(){throw Error('Unauthorized query');}};
  for(const actor of [null,{id:'member'},{id:'owner',is_admin:false},{id:'admin',is_admin:'true'}]){
    await assert.rejects(writeRpc('save_standard_reactions',{p_rows:initial(),p_revision:0,is_admin:true},{db,actor}),e=>e.status===(actor?403:401));
  }
  await assert.rejects(readRpc('get_standard_reactions',{}, {db,actor:null}),e=>e.status===401);
});
test('validation rejects malformed or duplicate keys, missing base items, oversized fields and empty catalogs',async t=>{
  const ctx=setup(t);
  const bad=[[],initial().slice(1),[...initial(),initial()[0]],initial().map((r,i)=>i? r:{...r,key:'custom_'+'a'.repeat(32)}),
    initial().map((r,i)=>i?r:{...r,label:'あ'.repeat(25)}),initial().map((r,i)=>i?r:{...r,icon:'a'.repeat(17)}),
    initial().map((r,i)=>i?r:{...r,label:' ',icon:' '}),initial().map(r=>({...r,hidden:true})),
    initial().map((r,i)=>i?r:{...r,iconType:'image'}),initial().map((r,i)=>i?r:{...r,tone:'<script>'})];
  for(const rows of bad)await assert.rejects(save(ctx,rows),e=>e.status===400);
  assert.equal((await readRpc('get_standard_reactions',{},ctx)).revision,0);
});
test('stale saves cannot overwrite a newer catalog and failed writes leave it unchanged',async t=>{
  const ctx=setup(t),rows=initial();const saved=await save(ctx,rows);
  rows[0].label='new';await assert.rejects(save(ctx,rows),e=>e.status===409);
  assert.deepEqual(await readRpc('get_standard_reactions',{},ctx),saved);
  await save(ctx,rows,1);assert.equal((await readRpc('get_standard_reactions',{},ctx)).rows[0].label,'new');
});
test('new and hidden standard reactions remain usable without rewriting existing reactions',async t=>{
  const ctx=setup(t),rows=[...initial(),addition];await save(ctx,rows);
  assert.equal(await isAddedStandardReaction(ctx.db,addition.key),true);
  const member={...ctx,actor:{id:'member',is_admin:false}};
  await writeRpc('set_shared_question_reaction',{p_question_id:'question',p_reaction_key:addition.key,p_active:true},member);
  assert.equal(ctx.db.sqlite.prepare('SELECT count(*) n FROM question_reactions').get().n,2);
  const hidden=rows.map(row=>({...row,hidden:row.key===addition.key}));await save(ctx,hidden,1);
  await assert.rejects(save(ctx,initial(),2),e=>e.code==='standard_reactions_keep_history');
  await writeRpc('set_shared_question_reaction',{p_question_id:'question',p_reaction_key:addition.key,p_active:false},member);
  assert.equal(ctx.db.sqlite.prepare('SELECT reaction_key FROM question_reactions').get().reaction_key,'difficult');
  assert.equal(await isAddedStandardReaction(ctx.db,'standard_'+'0'.repeat(32)),false);
});
test('HTTP enforces session, CSRF, origin, and fresh administrator privileges on save',async t=>{
  const {db}=setup(t),origin='https://fixture.test',token='a'.repeat(64),csrf='b'.repeat(64);
  db.sqlite.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?,?)').run(await sha256(token),'admin',await sha256(csrf),Math.floor(Date.now()/1000)+3600,0);
  const env={DB:db,APP_ORIGIN:origin,CUTOVER_READY:'true',DISCORD_CLIENT_ID:'111111111111111111',DISCORD_CLIENT_SECRET:'fixture-only'};
  const request=(headers={},name='save_standard_reactions',body={p_rows:initial(),p_revision:0})=>new Request(origin+'/api/rpc/'+name,{method:'POST',headers:{Cookie:'__Host-minkiru_session='+token,Origin:origin,'X-Minkiru-CSRF':csrf,'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await worker.fetch(request({Cookie:''}),env)).status,401);
  assert.equal((await worker.fetch(request({'X-Minkiru-CSRF':'invalid'}),env)).status,403);
  assert.equal((await worker.fetch(request({Origin:'https://other.invalid'}),env)).status,403);
  const response=await worker.fetch(request(),env);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  db.sqlite.exec("UPDATE auth_identities SET is_admin=0 WHERE user_id='admin'");
  assert.equal((await worker.fetch(request({},'save_standard_reactions',{p_rows:initial(),p_revision:1}),env)).status,403);
  const read=await worker.fetch(request({},'get_standard_reactions',{}),env);assert.equal(read.status,200);assert.equal((await read.json()).data.revision,1);
});
