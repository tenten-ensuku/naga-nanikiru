import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{jsonBody,STUDENT_FLOW_IMPLEMENTATION_COMPLETE} from '../cloudflare/worker.mjs';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {sha256} from '../cloudflare/auth.mjs';
const origin='https://fixture.test',token='a'.repeat(64),csrf='b'.repeat(64);
async function setup(t){
  const db=testD1();t.after(()=>db.close());
  db.sqlite.exec(`INSERT INTO profiles(id,display_name) VALUES ('student','生徒'),('other','別人');
    INSERT INTO auth_identities(user_id,discord_user_id) VALUES ('student','111111111111111111');
    INSERT INTO collections(id,owner_id,title,share_slug,visibility,published_at) VALUES ('c','other','学習用','one','public','2026-01-01');
    INSERT INTO questions(id,collection_id,created_by,payload) VALUES ('q','c','other','{"fixture":true}');`);
  db.sqlite.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?,?)').run(await sha256(token),'student',await sha256(csrf),Math.floor(Date.now()/1000)+3600,0);
  return {DB:db,APP_ORIGIN:origin,CUTOVER_READY:'true',DISCORD_CLIENT_ID:'123456789012345678',DISCORD_CLIENT_SECRET:'local-fixture-only'};
}
function req(path,args,headers={}){return new Request(origin+path,{method:args===undefined?'GET':'POST',headers:{Cookie:'__Host-minkiru_session='+token,Origin:origin,'Content-Type':'application/json','X-Minkiru-CSRF':csrf,...headers},...(args===undefined?{}:{body:JSON.stringify(args)})});}
test('student Worker exposes only cookie-authenticated allowlisted operations',async t=>{
  const env=await setup(t);assert.equal(STUDENT_FLOW_IMPLEMENTATION_COMPLETE,true);
  assert.equal((await worker.fetch(new Request(origin+'/api/rpc/list_my_collections',{method:'POST'}),env)).status,401);
  const session=await (await worker.fetch(req('/api/session'),env)).json();assert.equal(session.session.user.id,'student');assert.ok(!JSON.stringify(session).includes('access_token'));
  const index=await (await worker.fetch(req('/api/rpc/get_shared_question_index_page',{p_share_slug:'one',p_limit:20}),env)).json();assert.equal(index.data.length,1);assert.equal(index.data[0].payload,undefined);
  const privateTable=await worker.fetch(req('/api/table/auth_identities',{}),env);assert.equal(privateTable.status,403);
  const impersonate=await worker.fetch(req('/api/table/profiles',{operation:'upsert',rows:{id:'other',display_name:'侵入'}}),env);assert.equal(impersonate.status,403);
  const rejected=await worker.fetch(req('/api/rpc/post_shared_comment',{p_share_slug:'one',p_question_id:'q',p_body:'x'},{'X-Minkiru-CSRF':'wrong'}),env);assert.equal(rejected.status,403);
  const heavy=await worker.fetch(req('/api/rpc/create_shared_question',{}),env);assert.equal(heavy.status,503);assert.equal((await heavy.json()).error,'heavy_operations_paused');
  const bulkHistory=await worker.fetch(req('/api/table/answer_attempts',{operation:'upsert',rows:[]}),env);assert.equal(bulkHistory.status,503);
  const runtime=await (await worker.fetch(req('/runtime-config.js'),env)).text();assert.match(runtime,/"backend":"cloudflare"/);assert.ok(!runtime.includes('SECRET'));assert.ok(!runtime.includes('sb_publishable_'));
});
test('request bodies are streamed with a strict byte bound and content type',async()=>{
  await assert.rejects(jsonBody(new Request(origin,{method:'POST',body:'{}'})),e=>e.status===415);
  await assert.rejects(jsonBody(req('/',{body:'x'.repeat(9000)}),1024),e=>e.status===413);
  await assert.rejects(jsonBody(new Request(origin,{method:'POST',body:'[]',headers:{'Content-Type':'application/json'}})),e=>e.status===400);
});

test('V235 builder uses the same session, CSRF and rate limit boundary',async t=>{
  const env=await setup(t);env.COLLECTION_BUILDER_ENABLED='true';
  const args={p_title:'ローカル検証',p_book_tone:'navy',p_request_id:crypto.randomUUID()};
  assert.equal((await worker.fetch(req('/api/rpc/create_collection',args,{'X-Minkiru-CSRF':'wrong'}),env)).status,403);
  const created=await worker.fetch(req('/api/rpc/create_collection',args),env);
  assert.equal(created.status,200);const body=await created.json();assert.equal(body.data.owner_id,'student');assert.equal(body.data.book_tone,'navy');
  const replay=await (await worker.fetch(req('/api/rpc/create_collection',args),env)).json();assert.equal(replay.data.id,body.data.id);
  env.WRITE_LIMIT={limit:async()=>({success:false})};assert.equal((await worker.fetch(req('/api/rpc/create_collection',{...args,p_request_id:crypto.randomUUID()}),env)).status,429);
  assert.equal((await worker.fetch(req('/v1/upload',{}),env)).status,503);
});
test('interrupted browser OAuth has a readable safe return page',async t=>{
  const env=await setup(t);
  const response=await worker.fetch(new Request(origin+'/auth/discord/callback?code=do-not-echo',{headers:{Accept:'text/html'}}),env);
  assert.equal(response.status,400);
  assert.match(response.headers.get('Content-Type'),/text\/html/);
  const html=await response.text();assert.match(html,/みん切るの入口へ/);assert.ok(!html.includes('do-not-echo'));
});
