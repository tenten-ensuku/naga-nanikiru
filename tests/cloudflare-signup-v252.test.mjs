import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../cloudflare/worker.mjs';
import {finishDiscord,authCookieNames} from '../cloudflare/auth.mjs';
import {canAccessCollection,canEditCollection,canManageCollection,canViewStudent} from '../cloudflare/access.mjs';
import {testD1} from './helpers/cloudflare-d1.mjs';

const config=JSON.parse(fs.readFileSync(new URL('../wrangler.minkiru.jsonc',import.meta.url),'utf8'));
const origin='https://signup.test';
const discordId='111111111111111111';
function setup(t){
  const DB=testD1();t.after(()=>DB.close());
  return {...config.vars,DB,APP_ORIGIN:origin,DISCORD_CLIENT_SECRET:'local-fixture-only'};
}
function cookies(response){return response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');}
async function login(env){
  const start=await worker.fetch(new Request(origin+'/auth/discord?returnTo='+encodeURIComponent('/?collection=book&view=collections')),env);
  assert.equal(start.status,302);
  const redirect=new URL(start.headers.get('Location'));
  assert.equal(redirect.origin,'https://discord.com');assert.equal(redirect.searchParams.get('scope'),'identify');
  const state=redirect.searchParams.get('state');
  const callback=new Request(origin+'/auth/discord/callback?state='+state+'&code=local-only',{headers:{Cookie:cookies(start)}});
  // Exercise the real callback and SQLite schema; no production identity or API is used.
  const response=await finishDiscord(callback,env,{fetchImpl:async url=>{
    if(url==='https://discord.com/api/oauth2/token')return Response.json({access_token:'fixture-not-persisted',token_type:'Bearer'});
    assert.equal(url,'https://discord.com/api/users/@me');
    return Response.json({id:discordId,username:'new-student'});
  }});
  assert.equal(response.status,303);assert.equal(response.headers.get('Location'),origin+'/?collection=book&view=collections');
  const jar=cookies(response),csrf=jar.match(new RegExp(authCookieNames.csrf+'=([a-f0-9]{64})'))[1];
  const request=(path,args)=>new Request(origin+path,{method:args===undefined?'GET':'POST',headers:{Cookie:jar,Origin:origin,'Content-Type':'application/json','X-Minkiru-CSRF':csrf},...(args===undefined?{}:{body:JSON.stringify(args)})});
  const session=await (await worker.fetch(request('/api/session'),env)).json();
  return {id:session.session.user.id,session,request};
}

test('production configuration opens signup and health distinguishes it from existing-user readiness',async t=>{
  assert.equal(config.vars.SIGNUPS_ENABLED,'true','Recovery-era signup closure must not ship accidentally');
  const env=setup(t);
  const health=await (await worker.fetch(new Request(origin+'/health'),env)).json();
  assert.equal(health.signups,true);assert.equal(health.ready,true);
  for(const value of ['false',undefined,'TRUE']){
    const result=await (await worker.fetch(new Request(origin+'/health'),{...env,SIGNUPS_ENABLED:value})).json();
    assert.equal(result.signups,false);assert.equal(result.ready,true);
  }
  assert.equal((await (await worker.fetch(new Request(origin+'/health'),{...env,CUTOVER_READY:'false'})).json()).signups,false);
});

test('first Discord login creates only a student, preserves book access, and supports saved answers after re-login',async t=>{
  const env=setup(t),db=env.DB;
  db.sqlite.exec(`INSERT INTO profiles(id,display_name) VALUES ('owner','Owner'),('other','Other');
    INSERT INTO workspaces(id,owner_id,name) VALUES ('main','owner','NAGA問題集'),('other-space','other','Other workspace');
    INSERT INTO collections(id,owner_id,title,share_slug,visibility,published_at,workspace_id) VALUES
      ('book','owner','Public fixture','book','public','2026-09-15','main'),
      ('private','owner','Private fixture','private','private',NULL,'main'),
      ('limited','owner','Limited fixture','limited','limited',NULL,'main'),
      ('request','owner','Request fixture','request','request',NULL,'main'),
      ('workspace','owner','Workspace fixture','workspace','workspace',NULL,'main'),
      ('unrelated','other','Other workspace fixture','unrelated','workspace',NULL,'other-space');
    INSERT INTO questions(id,collection_id,created_by,payload) VALUES ('q','book','owner','{"number":1,"fixture":true}');`);
  const initial=await login(env),actor={id:initial.id,is_admin:false};
  assert.equal(initial.session.session.user.app_metadata.is_admin,false);
  assert.equal(db.sqlite.prepare('SELECT is_admin FROM auth_identities WHERE user_id=?').get(initial.id).is_admin,0);
  const memberships=db.sqlite.prepare('SELECT workspace_id,role,status FROM workspace_members WHERE user_id=?').all(initial.id);
  assert.deepEqual(memberships.map(row=>({...row})),[{workspace_id:'main',role:'student',status:'active'}]);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM collection_members WHERE user_id=?').get(initial.id).n,0);
  for(const id of ['private','limited','request','unrelated'])assert.equal(await canAccessCollection(db,actor,id),false,id);
  assert.equal(await canAccessCollection(db,actor,'book'),true);
  assert.equal(await canAccessCollection(db,actor,'workspace'),true);
  assert.equal(await canEditCollection(db,actor,'book'),false);
  assert.equal(await canManageCollection(db,actor,'book'),false);
  assert.equal(await canViewStudent(db,actor,'owner'),false);
  const detail=await worker.fetch(initial.request('/api/rpc/get_shared_question_detail',{p_share_slug:'book',p_question_id:'q'}),env);
  assert.equal(detail.status,200);assert.equal((await detail.json()).data[0].payload.fixture,true);
  const answer={p_share_slug:'book',p_question_id:'q',p_client_attempt_id:'new-student-local',p_answer:{selected:'5m',riichi:false},p_grade:'〇',p_elapsed_ms:1200};
  assert.equal((await worker.fetch(initial.request('/api/rpc/record_shared_attempt',answer),env)).status,200);
  assert.equal((await worker.fetch(initial.request('/api/logout',{}),env)).status,200);
  assert.equal((await (await worker.fetch(initial.request('/api/session'),env)).json()).session,null);
  const again=await login(env);assert.equal(again.id,initial.id);
  const saved=await worker.fetch(again.request('/api/rpc/load_my_attempts_for_collection',{p_share_slug:'book',p_limit:10,p_offset:0}),env);
  assert.equal(saved.status,200);assert.equal((await saved.json()).data.length,1);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM auth_identities').get().n,1);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM answer_attempts WHERE user_id=?').get(initial.id).n,1);
});

test('emergency closure still rejects new profiles, but existing users retain their original ID',async t=>{
  const env=setup(t);env.SIGNUPS_ENABLED='false';
  await assert.rejects(login(env),error=>error.code==='signup_temporarily_closed'&&error.status===403);
  for(const table of ['profiles','auth_identities','auth_sessions','workspace_members']){
    assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0);
  }
  env.DB.sqlite.exec(`INSERT INTO profiles(id,display_name) VALUES ('existing','Existing');
    INSERT INTO auth_identities(user_id,discord_user_id) VALUES ('existing','${discordId}');`);
  assert.equal((await login(env)).id,'existing');
  env.DB.sqlite.exec('UPDATE auth_identities SET disabled=1');
  await assert.rejects(login(env),error=>error.code==='account_disabled');
});
