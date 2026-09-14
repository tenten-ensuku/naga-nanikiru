import test from 'node:test';
import assert from 'node:assert/strict';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {authenticateDiscordBot,createDiscordSyncApi,mergeDiscordComments} from '../cloudflare/discord-sync-v242.mjs';
import {targetFor,fingerprint,retryPolicy,buildComments,sceneForExisting,SyncError} from '../bot/sync-core-v242.mjs';
import {generator} from '../scripts/naga-generator-runtime.mjs';
const token='a'.repeat(64),origin='https://fixture.test';
const target={collectionId:'book',guildId:'1061996816394108938',channelIds:['1527684940387455169'],legacyPrefix:'nima-thread'};
const threadId='1537116162801012757',reportId='fixture_report_abcdefghijklmnop';
const scene={reportId,tw:0,ts:0,tv:2};
const nagaUrl=`https://naga.dmv.nico/htmls/report_viewer.html?report_id=${reportId}&tw=0&ts=0&tv=2`;
const comment={id:'1537798761047130313',author:'テスト投稿者',createdAt:'2026-09-14T00:00:00Z',content:'||伏せ字||',avatarUrl:'https://cdn.discordapp.com/avatars/test.png',attachments:[]};
const payload={id:'new',sourceReportId:reportId,nagaUrl,tw:0,ts:0,tv:2,generationRuleVersion:'meld-replay-v237',decisionType:'discard',handBeforeDraw:['man1','man2','man3','man4','man5','man6','man7','man8','man9','pin1','pin2','pin3','ji1'],draw:'ji1',actualDiscard:'ji1',melds:[]};
function request(op='upsert',headers={}){return new Request(origin+'/api/bot/'+op,{method:'POST',headers:{Authorization:'Bearer '+token,...headers}});}
function setup(t){
 const db=testD1({generation:true,discord:true});t.after(()=>db.close());
 db.sqlite.exec("INSERT INTO profiles(id) VALUES('real-owner'),('other');INSERT INTO collections(id,owner_id,title,share_slug) VALUES('book','real-owner','Bot test','book');");
 db.sqlite.prepare('INSERT INTO private_media_budget(singleton,inventory_checked_at) VALUES(1,?)').run(new Date().toISOString());
 const env={DB:db,APP_ORIGIN:origin,DISCORD_SYNC_ENABLED:'true',DISCORD_SYNC_TOKEN:token};
 return {env,api:createDiscordSyncApi({targets:{nima:target}}),input:{target:'nima',threadId,channelId:target.channelIds[0],fingerprint:'b'.repeat(64),scene,payload,comments:[comment]}};
}
test('machine token cannot be replaced by a browser session or widened target',async t=>{
 const {env,api,input}=setup(t);
 await assert.rejects(authenticateDiscordBot(request('index',{Authorization:'Bearer '+ 'x'.repeat(64)}),env),e=>e.status===401);
 await assert.rejects(authenticateDiscordBot(request('index',{Origin:origin}),env),e=>e.status===403);
 await assert.rejects(authenticateDiscordBot(request('index',{Cookie:'session=x'}),env),e=>e.status===403);
 await assert.rejects(api(request(),env,{...input,target:'kunitaso'}),e=>e.status===403);
 await assert.rejects(api(request(),env,{...input,channelId:'other'}),e=>e.code==='bot_source_invalid');
 await assert.rejects(authenticateDiscordBot(request(),{...env,DISCORD_SYNC_ENABLED:'false'}),e=>e.status===503);
});
test('new verified question derives actual owner, preserves source, and retries exactly once',async t=>{
 const {env,api,input}=setup(t);const first=await api(request(),env,input),again=await api(request(),env,input);
 assert.equal(first.question_id,again.question_id);assert.equal(again.unchanged,true);
 const row=env.DB.sqlite.prepare('SELECT * FROM questions').get();assert.equal(row.created_by,'real-owner');
 assert.equal(row.legacy_key,'nima-thread-'+threadId);assert.equal(JSON.parse(row.payload).number,1);assert.equal(row.source_kind,'discord');
 assert.equal(JSON.parse(row.payload).comments[0].content,'||伏せ字||');
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM questions').get().n,1);
});
test('comments update without overwriting hand, old comments, numbering or edited scene',async t=>{
 const {env,api,input}=setup(t);await api(request(),env,input);
 let row=env.DB.sqlite.prepare('SELECT * FROM questions').get();const before=JSON.parse(row.payload);
 const update={...input,payload:undefined,expectedUpdatedAt:row.updated_at,fingerprint:'c'.repeat(64),comments:[{...comment,content:'||更新||'}]};
 await api(request(),env,update);row=env.DB.sqlite.prepare('SELECT * FROM questions').get();const after=JSON.parse(row.payload);
 assert.deepEqual(after.handBeforeDraw,before.handBeforeDraw);assert.equal(after.number,before.number);assert.equal(after.comments.length,1);assert.equal(after.comments[0].content,'||更新||');
 await assert.rejects(api(request(),env,{...update,fingerprint:'d'.repeat(64),expectedUpdatedAt:row.updated_at,scene:{...scene,tv:3}}),e=>e.code==='bot_scene_changed_review');
 await assert.rejects(api(request(),env,{...update,fingerprint:'d'.repeat(64),expectedUpdatedAt:'stale'}),e=>e.code==='bot_question_conflict');
 env.DB.sqlite.prepare('UPDATE questions SET deleted_at=?').run(new Date().toISOString());
 await assert.rejects(api(request(),env,update),e=>e.code==='bot_question_deleted');
});
test('unverified payload, source mismatch, capacity outage and foreign images are rejected',async t=>{
 const {env,api,input}=setup(t);
 await assert.rejects(api(request(),env,{...input,payload:{...payload,generationRuleVersion:'old'}}),e=>e.status===422);
 await assert.rejects(api(request(),env,{...input,scene:{...scene,tv:3}}),e=>e.code==='bot_scene_invalid');
 await assert.rejects(api(request(),env,{...input,payload:{...payload,image:origin+'/v1/private/question-assets/foreign.png'}}),e=>e.status===403);
 env.DB.sqlite.exec('UPDATE private_media_budget SET used_bytes=limit_bytes');
 await assert.rejects(api(request(),env,input),e=>e.status===507);
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM questions').get().n,0);
});

test('V244 a deleted volume is not updated or recreated by Discord sync',async t=>{
 const {env,api,input}=setup(t);const result=await api(request(),env,input);
 env.DB.sqlite.exec("INSERT INTO collections(id,owner_id,title,share_slug,series_parent_id,archived_at) VALUES('deleted-volume','real-owner','削除した巻','deleted-volume','book','2026-09-14')");
 env.DB.sqlite.prepare("UPDATE questions SET collection_id='deleted-volume' WHERE id=?").run(result.question_id);
 const before=env.DB.sqlite.prepare('SELECT * FROM questions WHERE id=?').get(result.question_id);
 await assert.rejects(api(request(),env,{...input,payload:undefined,expectedUpdatedAt:before.updated_at,fingerprint:'c'.repeat(64)}),e=>e.code==='bot_question_deleted');
 assert.deepEqual(env.DB.sqlite.prepare('SELECT * FROM questions WHERE id=?').get(result.question_id),before);
 assert.equal(env.DB.sqlite.prepare('SELECT count(*) n FROM questions').get().n,1);
});
test('index contains lightweight source metadata but no question bodies or authors',async t=>{
 const {env,api,input}=setup(t);await api(request(),env,input);const result=await api(request('index'),env,{target:'nima'});
 assert.equal(result.questions.length,1);assert.equal(result.capacity.remaining,199);assert.equal('payload' in result.questions[0],false);assert.equal('comments' in result.questions[0],false);
});
test('comment merge preserves historical/native comments and avatar when no replacement exists',()=>{
 const old=[{id:'old',content:'keep'},comment];const merged=mergeDiscordComments(old,[{id:comment.id,content:'edited'}]);
 assert.equal(merged.length,2);assert.equal(merged[0].content,'keep');assert.equal(merged[1].avatarUrl,comment.avatarUrl);
});
test('Discord scope is only Pierre/Nima, including generator-bot messages',()=>{
 assert.equal(targetFor(target.guildId,target.channelIds[0]),'nima');assert.equal(targetFor('wrong',target.channelIds[0]),null);assert.equal(targetFor(target.guildId,'1434555599177126009'),null);
});
test('fingerprints ignore expiring attachment links, but retain body edits',()=>{
 const s={threadId:'t',messages:[{id:'1',createdAt:'2026-01-01',content:'||body||',attachments:[{id:'2',url:'https://cdn.discordapp.com/a?ex=1',size:10}]}]};
 const b=structuredClone(s);b.messages[0].attachments[0].url='https://cdn.discordapp.com/a?ex=2';assert.equal(fingerprint(s),fingerprint(b));
 b.messages[0].content='||edit||';assert.notEqual(fingerprint(s),fingerprint(b));
});
test('402 and capacity guards hold pending work; daily limit waits until UTC reset',()=>{
 assert.equal(retryPolicy(new SyncError('x',402)).state,'held');assert.equal(retryPolicy(new SyncError('media_capacity_unavailable',503)).state,'held');
 const result=retryPolicy(new SyncError('generation_daily_limit',429),1,Date.parse('2026-09-14T10:00Z'));assert.equal(new Date(result.retryAt).toISOString(),'2026-09-15T00:05:00.000Z');
 assert.equal(retryPolicy(new SyncError('network',502),3).state,'held');
});
test('existing canonical replay is preserved when original URL has a pre-normalized frame',()=>{
 const s={nagaUrls:[{originalUrl:nagaUrl}]},row={source_naga_url:nagaUrl,source_report_id:reportId,scene_tw:0,scene_ts:0,scene_tv:1};
 assert.equal(sceneForExisting(s,row,generator.parseNagaUrl).tv,1);
 assert.throws(()=>sceneForExisting({nagaUrls:[{originalUrl:nagaUrl.replace('tv=2','tv=7')}]},row,generator.parseNagaUrl),/review/);
});
test('spoiler attachments and original spoiler text survive comment materialization',async()=>{
 const snap={threadOwnerId:'owner',messages:[{id:'123',author:{id:'owner',displayName:'Author',avatarUrl:'https://cdn.discordapp.com/a.png'},createdAt:'2026-09-14',content:'||text||',attachments:[{id:'a',name:'SPOILER_secret.png'}]}]};
 const result=await buildComments(snap,{rulesFactory:()=>({sanitizeContent:x=>x,shouldDropAttachment:()=>false}),isImage:()=>true,uploadAttachment:async()=>({src:origin+'/v1/private/question-assets/a.png'})});
 assert.equal(result[0].content,'||text||');assert.equal(result[0].attachments[0].spoiler,true);assert.match(result[0].avatarUrl,/cdn.discordapp.com/);
});
