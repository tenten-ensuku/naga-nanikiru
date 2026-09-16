import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {readableQuestionImageKeys,retiredImageCondition} from '../cloudflare/retired-image-write-v265.mjs';
import {builderRpc} from '../cloudflare/collection-builder-v235.mjs';
import {writeRpc,writeTable} from '../cloudflare/student-write-api.mjs';
import {createDiscordSyncApi} from '../cloudflare/discord-sync-v242.mjs';
import {imageUpload} from '../cloudflare/media-write-v241.mjs';
import worker from '../cloudflare/worker.mjs';
import {sha256} from '../cloudflare/auth.mjs';
import {isRetiredLocalImage,retiredLocalImagePaths} from '../cloudflare/retired-local-images-v265.mjs';

const owner='53d3ce97-8eb2-47b7-8c58-c43f378ba806';
const key='naga-question-assets/'+owner+'/pierre-thread-1462387846152196142/question.webp';
const encoded='https://minkiru-media.naga-study.workers.dev/v1/public/'+key.replace(owner,'%35'+owner.slice(1));
const actor={id:'owner'},origin='https://fixture.test';
function setup(t){
 const db=testD1({generation:true,discord:true});t.after(()=>db.close());
 db.sqlite.exec(fs.readFileSync(new URL('../cloudflare/migrations/0005_retired_question_images_v260.sql',import.meta.url),'utf8'));
 db.sqlite.exec("INSERT INTO profiles(id) VALUES('owner'); INSERT INTO collections(id,owner_id,title,share_slug,visibility,published_at) VALUES('book','owner','Fixture','book','public','2026-01-01');");
 db.sqlite.prepare('INSERT INTO private_media_budget(singleton,inventory_checked_at) VALUES(1,?)').run(new Date().toISOString());
 return {db,actor,origin};
}
const retire=db=>db.sqlite.prepare('INSERT INTO private_retired_question_images(object_key) VALUES(?)').run(key);
const question=(id,image)=>({p_share_slug:'book',p_payload:{id,image},p_source_kind:'manual'});
function raceOn(db,pattern){
 const prepare=db.prepare.bind(db);let fired=false;
 db.prepare=sql=>{const stmt=prepare(sql);if(pattern.test(sql)){const first=stmt.first.bind(stmt);stmt.first=async(...args)=>{if(!fired){fired=true;retire(db);}return first(...args);};}return stmt;};
 return ()=>assert.equal(fired,true);
}

test('readable encoded URL aliases produce bounded exact keys without changing strings',()=>{
 const input={image:encoded,comments:[{attachments:[{src:encoded.replace('%35','%2535')}]}]};
 const before=JSON.stringify(input);assert.deepEqual(readableQuestionImageKeys(input),[key]);assert.equal(JSON.stringify(input),before);
 assert.ok(readableQuestionImageKeys('see ['+encoded+').').includes(key));
 assert.deepEqual(readableQuestionImageKeys(encoded+'。'),[key,key+'。']);
 assert.deepEqual(readableQuestionImageKeys('https://fixture.test/v1/private/question-assets/'+owner+'/a%20b.webp'),['question-assets/'+owner+'/a b.webp']);
 assert.deepEqual(retiredImageCondition({boardScene:{tiles:['man1']},comments:['ordinary comment']}),{sql:'1',params:[],keys:[]});
 const plan=retiredImageCondition({image:encoded});assert.equal(JSON.parse(plan.params[0])[0],key);assert.match(plan.sql,/retired\.object_key=submitted\.value/);
 assert.throws(()=>readableQuestionImageKeys(Array.from({length:65},(_,i)=>encoded.replace('question.webp',i+'.webp'))),e=>e.code==='question_media_invalid');
});

test('actual question INSERT checks retirement committed after parsing and before the write',async t=>{
 const ctx=setup(t),checkRace=raceOn(ctx.db,/INSERT INTO questions/);
 await assert.rejects(builderRpc('create_shared_question',question('blocked',encoded),ctx),e=>e.code==='question_image_retired');checkRace();
 assert.equal(ctx.db.sqlite.prepare('SELECT count(*) n FROM questions').get().n,0);
 const safe=await builderRpc('create_shared_question',question('safe','https://example.test/other.webp'),ctx);
 assert.equal(JSON.parse(ctx.db.sqlite.prepare('SELECT payload FROM questions WHERE id=?').get(safe.question_id).payload).image,'https://example.test/other.webp');
});

test('shared import and source-only links cannot reintroduce an encoded retired image',async t=>{
 const ctx=setup(t);const source=await builderRpc('create_shared_question',question('source',encoded),ctx);
 ctx.db.sqlite.exec("INSERT INTO collections(id,owner_id,title,share_slug) VALUES('target','owner','Target','target');");retire(ctx.db);
 const before=ctx.db.sqlite.prepare('SELECT * FROM questions').all();
 await assert.rejects(builderRpc('import_shared_question',{p_source_question_id:source.question_id,p_target_share_slug:'target'},ctx),e=>e.code==='question_image_retired');
 await assert.rejects(builderRpc('create_shared_question',{...question('source-only',null),p_source_url:encoded},ctx),e=>e.code==='question_image_retired');
 assert.deepEqual(ctx.db.sqlite.prepare('SELECT * FROM questions').all(),before);
});

test('both comment POST forms and UPDATE refuse encoded images; normal comments remain intact',async t=>{
 const ctx=setup(t);const normal=await writeRpc('post_shared_comment',{p_share_slug:'book',p_body:'original',p_attachments:[]},ctx);retire(ctx.db);
 for(const args of [{p_share_slug:'book',p_body:encoded},{p_share_slug:'book',p_body:'see '+encoded+'。',p_attachments:[]}])await assert.rejects(writeRpc('post_shared_comment',args,ctx),e=>e.code==='question_image_retired');
 await assert.rejects(writeRpc('update_shared_comment',{p_comment_id:normal,p_body:encoded,p_attachments:[]},ctx),e=>e.code==='question_image_retired');
 assert.equal(ctx.db.sqlite.prepare('SELECT body FROM comments WHERE id=?').get(normal).body,'original');
 await writeRpc('update_shared_comment',{p_comment_id:normal,p_body:'normal update',p_attachments:[]},ctx);
 assert.equal(ctx.db.sqlite.prepare('SELECT body FROM comments WHERE id=?').get(normal).body,'normal update');
 // These APIs cannot turn arbitrary URLs into avatars or reaction images.
 await assert.rejects(writeTable('profiles',{id:'owner',display_name:'a',avatar_url:encoded},ctx),e=>e.code==='profile_fields_not_allowed');
 await assert.rejects(writeRpc('create_custom_reaction',{p_label:'a',p_icon:'',p_image_path:encoded},ctx),e=>e.code==='custom_reaction_image_invalid');
});

test('comment retirement race is evaluated inside the INSERT',async t=>{
 const ctx=setup(t),checkRace=raceOn(ctx.db,/INSERT INTO comments/);
 await assert.rejects(writeRpc('post_shared_comment',{p_share_slug:'book',p_body:encoded,p_attachments:[]},ctx),e=>e.code==='question_image_retired');checkRace();
 assert.equal(ctx.db.sqlite.prepare('SELECT count(*) n FROM comments').get().n,0);
});

test('Discord comment UPDATE cannot race retirement or replace the existing question',async t=>{
 const ctx=setup(t),token='a'.repeat(64),threadId='1537116162801012757',reportId='fixture_report_abcdefghijklmnop';
 const target={collectionId:'book',guildId:'1061996816394108938',channelIds:['1527684940387455169'],legacyPrefix:'nima-thread'};
 const scene={reportId,tw:0,ts:0,tv:2},nagaUrl=`https://naga.dmv.nico/htmls/report_viewer.html?report_id=${reportId}&tw=0&ts=0&tv=2`;
 const payload={id:'new',sourceReportId:reportId,nagaUrl,tw:0,ts:0,tv:2,generationRuleVersion:'meld-replay-v237',decisionType:'discard',handBeforeDraw:['man1','man2','man3','man4','man5','man6','man7','man8','man9','pin1','pin2','pin3','ji1'],draw:'ji1',actualDiscard:'ji1',melds:[]};
 const env={DB:ctx.db,APP_ORIGIN:origin,DISCORD_SYNC_ENABLED:'true',DISCORD_SYNC_TOKEN:token};
 const api=createDiscordSyncApi({targets:{nima:target}}),request=()=>new Request(origin+'/api/bot/upsert',{method:'POST',headers:{Authorization:'Bearer '+token}});
 const input={target:'nima',threadId,channelId:target.channelIds[0],fingerprint:'b'.repeat(64),scene,payload,comments:[]};
 await api(request(),env,input);const before=ctx.db.sqlite.prepare('SELECT * FROM questions').get();
 const checkRace=raceOn(ctx.db,/UPDATE questions SET payload/);
 const comment={id:'1537798761047130313',author:'テスト',createdAt:'2026-09-14T00:00:00Z',content:'説明',attachments:[{src:encoded}]};
 await assert.rejects(api(request(),env,{...input,payload:undefined,expectedUpdatedAt:before.updated_at,fingerprint:'c'.repeat(64),comments:[comment]}),e=>e.code==='bot_question_conflict');checkRace();
 assert.deepEqual(ctx.db.sqlite.prepare('SELECT * FROM questions').get(),before);
});

test('submitted-key lookup uses the retirement primary key and leaves history writable',t=>{
 const {db}=setup(t);retire(db);const plan=retiredImageCondition(encoded);
 const queryPlan=db.sqlite.prepare('EXPLAIN QUERY PLAN SELECT '+plan.sql).all(...plan.params).map(r=>r.detail);
 assert.ok(queryPlan.some(s=>/SEARCH retired USING COVERING INDEX sqlite_autoindex_private_retired_question_images/.test(s)),queryPlan.join('\n'));
 db.sqlite.prepare("INSERT INTO questions(id,collection_id,created_by,payload) VALUES('history','book','owner','{}')").run();
 db.sqlite.prepare("INSERT INTO answer_attempts(id,client_attempt_id,user_id,question_id,answer,grade) VALUES('a','a','owner','history',?,'◎')").run(JSON.stringify({oldImage:encoded}));
 db.sqlite.prepare("INSERT INTO question_audit_events(id,question_id,collection_id,event_type,snapshot) VALUES(1,'history','book','updated',?)").run(JSON.stringify({image:encoded}));
 assert.equal(db.sqlite.prepare('SELECT count(*) n FROM answer_attempts').get().n,1);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM question_audit_events').get().n,1);
});

const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1]);
test('local retirement list matches browser URL resolution without blocking other hosts or tiles',()=>{
 const paths=new Set(['question-images/q158.webp','naga-scene-off.jpg']);
 for(const value of ['question-images/q158.webp','./question-images/q158.webp','/question-images/q158.webp?cache=1','question-images/q158%2Ewebp','question-images%2Fq158.webp','#ignored','https://minkiru.naga-study.workers.dev/question-images/%71158.webp','https://tenten-ensuku.github.io/naga-nanikiru/question-images/q158.webp']){
   if(value==='#ignored')assert.equal(isRetiredLocalImage(value,paths),false);else assert.equal(isRetiredLocalImage(value,paths),true,value);
 }
 for(const value of ['https://elsewhere.test/question-images/q158.webp','tiles/man1.png','question-images/q159.webp','//elsewhere.test/naga-scene-off.jpg'])assert.equal(isRetiredLocalImage(value,paths),false);
});

test('the reviewed local retirement list prevents stale saves and preserves excluded assets',async t=>{
 assert.equal(retiredLocalImagePaths.length,237);assert.equal(new Set(retiredLocalImagePaths).size,237);assert.ok(Object.isFrozen(retiredLocalImagePaths));
 const ctx=setup(t);
 for(const image of ['question-images/q158.webp','./question-images/q249.webp','https://minkiru.naga-study.workers.dev/question-images/%71158.webp?cache=1','naga-scene.png','question-images/q005.jpg','question-images/q005.png','question-images/q139.webp','question-images/q220.png'])await assert.rejects(builderRpc('create_shared_question',question('old-local',image),ctx),e=>e.code==='question_image_retired');
 await assert.rejects(writeRpc('post_shared_comment',{p_share_slug:'book',p_body:'https://minkiru.naga-study.workers.dev/question-images/q158.webp。',p_attachments:[]},ctx),e=>e.code==='question_image_retired');
 for(const image of ['question-images/q253.webp','tiles/man1.png','https://elsewhere.test/question-images/q158.webp']){
   assert.equal(isRetiredLocalImage(image),false,image);
   const saved=await builderRpc('create_shared_question',question('retained-'+image,image),ctx);assert.ok(saved.question_id);
 }
});
async function uploadFixture(t){
 const ctx=setup(t);ctx.db.sqlite.prepare('INSERT INTO profiles(id) VALUES(?)').run(owner);ctx.db.sqlite.prepare('UPDATE collections SET owner_id=?').run(owner);
 const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',png))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const objectKey=`question-assets/${owner}/questions/book/${sha}.png`,objects=new Map();let puts=0;
 const env={DB:ctx.db,APP_ORIGIN:origin,UPLOADS_ENABLED:'true',IMAGES:{async head(key){return objects.get(key)||null;},async put(key,bytes,options){puts++;const object={size:bytes.length,...options};objects.set(key,object);return object;}}};
 const req=()=>new Request(origin+'/v1/assets',{method:'POST',headers:{'Content-Type':'image/png','X-Asset-Bucket':'question-assets','X-Collection-Slug':'book','X-Asset-SHA256':sha},body:png});
 const retireKey=()=>ctx.db.sqlite.prepare('INSERT INTO private_retired_question_images(object_key) VALUES(?)').run(objectKey);
 return {...ctx,env,req,objectKey,sha,objects,retireKey,upload:()=>imageUpload(req(),env,{id:owner}),puts:()=>puts};
}

test('retired upload cannot create a pending row or recreate its object',async t=>{
 const f=await uploadFixture(t);f.retireKey();await assert.rejects(f.upload(),e=>e.code==='media_upload_pending');
 assert.equal(f.puts(),0);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM media_assets').get().n,0);
});

test('replacement PUT claims ready atomically and loses to concurrent retirement',async t=>{
 const f=await uploadFixture(t);await f.upload();assert.equal(f.puts(),1);f.objects.clear();
 f.env.IMAGES.head=async()=>{f.retireKey();return null;};
 await assert.rejects(f.upload(),e=>e.code==='media_asset_conflict');assert.equal(f.puts(),1);
 assert.equal(f.db.sqlite.prepare('SELECT state FROM media_assets').get().state,'ready');
});

test('in-flight PUT owns pending exclusively; ready-only deletion must wait until completion',async t=>{
 const f=await uploadFixture(t),put=f.env.IMAGES.put;let entered,release;const reached=new Promise(r=>entered=r),resume=new Promise(r=>release=r);
 f.env.IMAGES.put=async(...args)=>{entered();await resume;return put(...args);};
 const operation=f.upload();await reached;
 assert.equal(f.db.sqlite.prepare('SELECT state FROM media_assets').get().state,'pending');
 await assert.rejects(f.upload(),e=>e.code==='media_upload_pending');f.retireKey();
 assert.equal(f.db.sqlite.prepare("UPDATE media_assets SET state='deleting' WHERE object_key=? AND state='ready'").run(f.objectKey).changes,0);
 release();await operation;assert.equal(f.puts(),1);
 assert.equal(f.db.sqlite.prepare("UPDATE media_assets SET state='deleting' WHERE object_key=? AND state='ready'").run(f.objectKey).changes,1);
 f.objects.delete(f.objectKey);f.db.sqlite.prepare("UPDATE media_assets SET state='deleted' WHERE object_key=?").run(f.objectKey);
 await assert.rejects(f.upload(),e=>e.code==='media_asset_conflict');assert.equal(f.puts(),1);assert.equal(f.objects.size,0);
 assert.equal(f.db.sqlite.prepare('SELECT used_bytes FROM private_media_budget').get().used_bytes,0);
});

test('retired ready object is preserved but cannot be returned as a reusable upload',async t=>{
 const f=await uploadFixture(t);await f.upload();f.retireKey();await assert.rejects(f.upload(),e=>e.code==='media_asset_conflict');
 assert.equal(f.puts(),1);assert.equal(f.objects.size,1);assert.equal(f.db.sqlite.prepare('SELECT state FROM media_assets').get().state,'ready');
});

test('real Worker routes explain pending upload and retired-image failures without false success',async t=>{
 const f=await uploadFixture(t),token='a'.repeat(64),csrf='b'.repeat(64);
 Object.assign(f.env,{CUTOVER_READY:'true',COLLECTION_BUILDER_ENABLED:'true',DISCORD_CLIENT_ID:'123456789012345678',DISCORD_CLIENT_SECRET:'fixture-only'});
 f.db.sqlite.prepare('INSERT INTO auth_identities(user_id,discord_user_id) VALUES(?,?)').run(owner,'123456789012345678');
 f.db.sqlite.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?,?)').run(await sha256(token),owner,await sha256(csrf),Math.floor(Date.now()/1000)+3600,0);
 const authenticated=request=>{const headers=new Headers(request.headers);headers.set('Cookie','__Host-minkiru_session='+token);headers.set('Origin',origin);headers.set('X-Minkiru-CSRF',csrf);return new Request(request,{headers});};
 f.env.IMAGES.put=async()=>{throw Error('fixture interrupted PUT');};await assert.rejects(f.upload());
 const pending=await worker.fetch(authenticated(f.req()),f.env);assert.equal(pending.status,409);
 const pendingBody=await pending.json();assert.equal(pendingBody.error,'media_upload_pending');assert.match(pendingBody.message,/管理者/);
 const request=new Request(origin+'/api/rpc/create_shared_question',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(question('stale-local','question-images/q158.webp'))});
 const retired=await worker.fetch(authenticated(request),f.env);assert.equal(retired.status,409);
 const retiredBody=await retired.json();assert.equal(retiredBody.error,'question_image_retired');assert.match(retiredBody.message,/最新の問題/);
 assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM questions').get().n,0);
});
