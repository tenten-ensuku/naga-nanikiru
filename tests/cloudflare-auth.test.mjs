import test from 'node:test';
import assert from 'node:assert/strict';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {startDiscord,finishDiscord,sessionFor,sessionResponse,endSession,requireCsrf,safeReturnPath,authCookieNames} from '../cloudflare/auth.mjs';
import {canAccessCollection,canManageCollection,canEditCollection,canViewStudent} from '../cloudflare/access.mjs';
const origin='https://minkiru.test';
function setup(t){const db=testD1();t.after(()=>db.close());return {DB:db,APP_ORIGIN:origin,DISCORD_CLIENT_ID:'123456789012345678',DISCORD_CLIENT_SECRET:'fixture-only',SIGNUPS_ENABLED:'true'};}
function cookies(response){return response.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');}
async function login(env){
  const start=await startDiscord(new Request(origin+'/auth/discord?returnTo=%2F%3Fcollection%3Done'),env);
  const state=new URL(start.headers.get('Location')).searchParams.get('state');
  let calls=0;
  const callback=new Request(origin+'/auth/discord/callback?state='+state+'&code=fixture-code',{headers:{Cookie:cookies(start)}});
  const finish=await finishDiscord(callback,env,{fetchImpl:async(url,options)=>{
    calls++;
    if(url.endsWith('/token')){assert.equal(options.body.get('redirect_uri'),origin+'/auth/discord/callback');return Response.json({access_token:'never-stored',token_type:'Bearer'});}
    assert.equal(options.headers.Authorization,'Bearer never-stored');return Response.json({id:'111111111111111111',username:'fixture'});
  }});
  assert.equal(calls,2);return {start,callback,finish,cookie:cookies(finish)};
}
test('Discord ID preserves existing UUID and admin identity, tokens never reach DB',async t=>{
  const env=setup(t);env.DB.sqlite.exec("INSERT INTO profiles(id,display_name) VALUES ('original','original'); INSERT INTO auth_identities(user_id,discord_user_id,is_admin) VALUES ('original','111111111111111111',1)");
  const result=await login(env);assert.equal(result.finish.headers.get('Location'),origin+'/?collection=one');
  const request=new Request(origin+'/api/session',{headers:{Cookie:result.cookie}}),session=await sessionFor(request,env);
  assert.equal(session.actor.id,'original');assert.equal(session.actor.is_admin,true);
  const response=await sessionResponse(session).json();assert.equal(response.session.user.id,'original');
  assert.ok(!JSON.stringify(response).includes('token_hash'));
  assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM profiles').get().n,1);
  const rows=env.DB.sqlite.prepare('SELECT * FROM auth_sessions').all();assert.equal(rows.length,1);
  assert.ok(!JSON.stringify(rows).includes('never-stored'));
  assert.ok(result.finish.headers.getSetCookie().find(x=>x.startsWith(authCookieNames.session+'=')).includes('HttpOnly'));
  await assert.rejects(finishDiscord(result.callback,env),e=>e.code==='oauth_state_invalid');
});
test('state browser binding, csrf, duplicate cookies, expiration and revocation fail closed',async t=>{
  const env=setup(t),result=await login(env);
  const request=new Request(origin+'/api/session',{headers:{Cookie:result.cookie}}),session=await sessionFor(request,env);
  assert.equal(await sessionFor(new Request(origin,{headers:{Cookie:result.cookie+'; '+result.cookie}}),env),null);
  await assert.rejects(requireCsrf(new Request(origin,{headers:{Origin:origin}}),env,session),e=>e.code==='csrf_denied');
  const csrf=result.cookie.match(new RegExp(authCookieNames.csrf+'=([a-f0-9]+)'))[1];
  await assert.rejects(requireCsrf(new Request(origin,{headers:{Origin:'https://evil.test','X-Minkiru-CSRF':csrf}}),env,session),e=>e.code==='origin_denied');
  assert.equal(await sessionFor(request,env,{now:Date.now()+8*24*3600000}),null);
  const start=await startDiscord(new Request(origin+'/auth/discord'),env),state=new URL(start.headers.get('Location')).searchParams.get('state');
  await assert.rejects(finishDiscord(new Request(origin+'/auth/discord/callback?state='+state+'&code=fixture',{headers:{Cookie:authCookieNames.state+'='+'0'.repeat(64)}}),env),e=>e.code==='oauth_state_invalid');
  const end=await endSession(new Request(origin+'/api/logout',{method:'POST',headers:{Origin:origin,'X-Minkiru-CSRF':csrf}}),env,session);
  assert.equal(end.status,200);assert.equal(await sessionFor(request,env),null);
});
test('new users get no administrative role and disabled users cannot sign in',async t=>{
  const env=setup(t);await login(env);
  assert.equal(env.DB.sqlite.prepare('SELECT is_admin FROM auth_identities').get().is_admin,0);
  env.DB.sqlite.exec('UPDATE auth_identities SET disabled=1');
  await assert.rejects(login(env),e=>e.code==='account_disabled');
});
test('return paths cannot redirect off site or preserve old auth credentials',()=>{
  for(const input of ['https://evil.test','//evil.test','/\\evil.test','/auth/discord','/\r\nevil'])assert.equal(safeReturnPath(input),'/');
  assert.equal(safeReturnPath('/?q=123&code=secret#access_token=secret'),'/?q=123');
});
test('collection and student permission rules preserve private and suspended boundaries',async t=>{
  const {DB:db}=setup(t);
  db.sqlite.exec(`INSERT INTO profiles(id) VALUES ('owner'),('viewer'),('editor'),('outsider');
    INSERT INTO collections(id,owner_id,title,visibility,share_slug) VALUES ('private','owner','fixture','private','a');
    INSERT INTO collections(id,owner_id,title,visibility,share_slug,published_at) VALUES ('public','owner','fixture','public','b','2026-01-01');
    INSERT INTO collection_members(collection_id,user_id,role) VALUES ('private','viewer','viewer'),('private','editor','editor');
    INSERT INTO workspaces(id,owner_id,name) VALUES ('workspace','owner','fixture');
    INSERT INTO workspace_members(workspace_id,user_id,role) VALUES ('workspace','owner','owner'),('workspace','viewer','student');`);
  assert.equal(await canAccessCollection(db,null,'public'),true);assert.equal(await canAccessCollection(db,null,'private'),false);
  assert.equal(await canAccessCollection(db,{id:'outsider'},'private'),false);assert.equal(await canAccessCollection(db,{id:'viewer'},'private'),true);
  assert.equal(await canEditCollection(db,{id:'viewer'},'private'),false);assert.equal(await canEditCollection(db,{id:'editor'},'private'),true);
  assert.equal(await canManageCollection(db,{id:'editor'},'private'),false);
  assert.equal(await canViewStudent(db,{id:'owner'},'viewer'),false);assert.equal(await canViewStudent(db,{id:'owner',is_admin:true},'viewer'),true);
  db.sqlite.exec("UPDATE workspace_members SET status='suspended' WHERE user_id='viewer'; UPDATE collections SET archived_at='2026-01-01' WHERE id='private'");
  assert.equal(await canViewStudent(db,{id:'owner',is_admin:true},'viewer'),false);
  assert.equal(await canAccessCollection(db,{id:'owner',is_admin:true},'private'),false);
  assert.equal(await canManageCollection(db,{id:'owner'},'private'),true);
});
