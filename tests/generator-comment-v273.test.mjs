import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {builderRpc} from '../cloudflare/collection-builder-v235.mjs';
import {readRpc} from '../cloudflare/read-api.mjs';
const fixture=JSON.parse(await readFile(new URL('./fixtures/json-board-v248/1603.json',import.meta.url)));
function setup(t){
  const db=testD1();t.after(()=>db.close());
  db.sqlite.exec("INSERT INTO profiles(id,display_name) VALUES('owner','作者'),('viewer','読者'); INSERT INTO collections(id,owner_id,title,share_slug,visibility,published_at) VALUES('book-id','owner','ローカル検証','book','public','2026-01-01');");
  const q=fixture.question;
  return {ctx:{db,actor:{id:'owner'}},args:{p_share_slug:'book',p_title:'生成候補',p_payload:{...q,boardScene:fixture.scene,image:null},p_source_kind:'naga_scene',p_source_report_id:q.sourceReportId,p_scene_tw:q.tw,p_scene_ts:q.ts,p_scene_tv:q.tv,p_decision_type:q.decisionType,p_initial_comment:'この局面を検討します。\n#押し引き'}};
}
test('generation atomically saves an attributed comment, readable and searchable without an answer',async t=>{
  const {ctx,args}=setup(t),saved=await builderRpc('create_shared_question',args,ctx);
  const comment=ctx.db.sqlite.prepare('SELECT * FROM comments WHERE question_id=?').get(saved.question_id);
  assert.equal(comment.id,saved.initial_comment_id);assert.equal(comment.user_id,'owner');assert.equal(comment.body,args.p_initial_comment);
  assert.equal(ctx.db.sqlite.prepare('SELECT count(*) n FROM answer_attempts').get().n,0);
  const comments=await readRpc('get_shared_comments',{p_share_slug:'book',p_question_id:saved.question_id},{...ctx,actor:{id:'viewer'}});
  assert.equal(comments[0].body,args.p_initial_comment);
  const index=await readRpc('get_shared_question_index_page',{p_share_slug:'book',p_offset:0,p_limit:20},ctx);
  assert.ok(index[0].comment_tags.includes('押し引き'));
  const payload=JSON.parse(ctx.db.sqlite.prepare('SELECT payload FROM questions WHERE id=?').get(saved.question_id).payload);
  assert.deepEqual(payload.boardScene,fixture.scene);assert.equal(payload.image,null);
  assert.equal(ctx.db.sqlite.prepare('SELECT count(*) n FROM media_assets').get().n,0);
  assert.equal((await builderRpc('create_shared_question',args,ctx)).already_exists,true);
  assert.equal(ctx.db.sqlite.prepare('SELECT count(*) n FROM comments').get().n,1);
});
test('invalid, disabled and unauthorized generation comments do not create a question',async t=>{
  const {ctx,args}=setup(t);
  await assert.rejects(builderRpc('create_shared_question',{...args,p_initial_comment:'字'.repeat(4001)},ctx),e=>e.code==='comment_content_invalid');
  await assert.rejects(builderRpc('create_shared_question',args,{...ctx,actor:{id:'viewer'}}),e=>e.status===403);
  ctx.db.sqlite.exec('UPDATE collections SET allow_comments=0');
  await assert.rejects(builderRpc('create_shared_question',args,ctx),e=>e.code==='comments_disabled');
  assert.equal(ctx.db.sqlite.prepare('SELECT count(*) n FROM questions').get().n,0);
  assert.ok((await builderRpc('create_shared_question',{...args,p_initial_comment:''},ctx)).question_id);
});
test('comment insertion failure rolls back the question, and retry can save both',async t=>{
  const {ctx,args}=setup(t);
  ctx.db.sqlite.exec("CREATE TRIGGER fail_comment BEFORE INSERT ON comments BEGIN SELECT RAISE(ABORT,'injected_comment_failure'); END;");
  await assert.rejects(builderRpc('create_shared_question',args,ctx),/injected_comment_failure/);
  assert.equal(ctx.db.sqlite.prepare('SELECT count(*) n FROM questions').get().n,0);
  ctx.db.sqlite.exec('DROP TRIGGER fail_comment');
  assert.ok((await builderRpc('create_shared_question',args,ctx)).initial_comment_id);
});
test('two tabs submitting the same scene create only one question and one comment',async t=>{
  const {ctx,args}=setup(t);
  // D1 serializes transactions; this local single-connection adapter needs the same ordering.
  const batch=ctx.db.batch.bind(ctx.db);let pending=Promise.resolve();
  ctx.db.batch=statements=>{const result=pending.then(()=>batch(statements));pending=result.catch(()=>{});return result;};
  const results=await Promise.all([builderRpc('create_shared_question',args,ctx),builderRpc('create_shared_question',{...args,p_payload:{...args.p_payload,id:'second-tab'}},ctx)]);
  assert.equal(results[0].question_id,results[1].question_id);
  assert.equal(ctx.db.sqlite.prepare('SELECT count(*) n FROM questions').get().n,1);
  assert.equal(ctx.db.sqlite.prepare('SELECT count(*) n FROM comments').get().n,1);
});
