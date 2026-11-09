import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../cloudflare/worker.mjs';
import {sha256} from '../cloudflare/auth.mjs';
import {testD1} from './helpers/cloudflare-d1.mjs';

const migration=fs.readFileSync(new URL('../cloudflare/migrations/0012_retired_guard_recursion_v360.sql',import.meta.url),'utf8');
const owner='qa-current-author',other='qa-other-author';
const token='a'.repeat(64),csrf='b'.repeat(64),origin='https://fixture.test';
const retiredKey='naga-question-assets/53d3ce97-8eb2-47b7-8c58-c43f378ba806/book/retired.webp';
const discussion='テンが取れるとみて、7mチー、打8mとしそうです。\nテンパイにするためには9pも打つ必要がありますが、これは全員の現物ですね。\n#瀬利さりな';
async function setup(t){
  const db=testD1({generation:true,discord:true});t.after(()=>db.close());
  db.sqlite.exec(fs.readFileSync(new URL('../cloudflare/migrations/0005_retired_question_images_v260.sql',import.meta.url),'utf8'));
  db.sqlite.exec(migration);
  db.sqlite.prepare('INSERT INTO profiles(id,display_name) VALUES (?,?),(?,?)').run(owner,'作成者',other,'別の人');
  db.sqlite.prepare('INSERT INTO auth_identities(user_id,discord_user_id) VALUES (?,?)').run(owner,'111111111111111111');
  db.sqlite.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?,?)').run(await sha256(token),owner,await sha256(csrf),Math.floor(Date.now()/1000)+3600,0);
  for(const [id,visibility] of [['public-book','public'],['restricted-book','request']]){
    db.sqlite.prepare('INSERT INTO collections(id,owner_id,title,share_slug,visibility,published_at) VALUES(?,?,?,?,?,?)').run(id,owner,id,id,visibility,'2026-01-01');
    db.sqlite.prepare('INSERT INTO questions(id,collection_id,created_by,payload) VALUES(?,?,?,?)').run(id+'-q',id,owner,'{}');
  }
  db.sqlite.prepare('INSERT INTO private_retired_question_images(object_key) VALUES(?)').run(retiredKey);
  db.sqlite.prepare('INSERT INTO private_media_budget(singleton,inventory_checked_at) VALUES(1,?)').run(new Date().toISOString());
  return {DB:db,APP_ORIGIN:origin,CUTOVER_READY:'true',COLLECTION_BUILDER_ENABLED:'true',DISCORD_CLIENT_ID:'123456789012345678',DISCORD_CLIENT_SECRET:'fixture-only'};
}
const request=(name,args)=>new Request(origin+'/api/rpc/'+name,{method:'POST',headers:{Cookie:'__Host-minkiru_session='+token,Origin:origin,'Content-Type':'application/json','X-Minkiru-CSRF':csrf},body:JSON.stringify(args)});
async function rpc(env,name,args){const res=await worker.fetch(request(name,args),env);return {status:res.status,...await res.json()};}

test('comment post, edit and re-read work on public and restricted books with retirement guards active',async t=>{
  const env=await setup(t);
  for(const book of ['public-book','restricted-book']){
    const posted=await rpc(env,'post_shared_comment',{p_share_slug:book,p_question_id:book+'-q',p_body:discussion,p_attachments:[]});
    assert.equal(posted.status,200,JSON.stringify(posted));assert.ok(posted.data);
    const updated=discussion+'\n追記：安全度も確認。';
    assert.equal((await rpc(env,'update_shared_comment',{p_comment_id:posted.data,p_body:updated,p_attachments:[]})).status,200);
    const reloaded=await rpc(env,'get_shared_comments',{p_share_slug:book,p_question_id:book+'-q'});
    assert.equal(reloaded.status,200);assert.equal(reloaded.data.find(c=>c.id===posted.data).body,updated);
    assert.equal(reloaded.data.find(c=>c.id===posted.data).author_id,owner);
  }
});

test('creating a problem with an initial comment saves both and re-displays the comment',async t=>{
  const env=await setup(t);
  const result=await rpc(env,'create_shared_question',{p_share_slug:'restricted-book',p_source_kind:'manual',p_payload:{id:'new-local-question'},p_initial_comment:discussion});
  assert.equal(result.status,200,JSON.stringify(result));assert.ok(result.data.initial_comment_id);
  const comments=await rpc(env,'get_shared_comments',{p_share_slug:'restricted-book',p_question_id:result.data.question_id});
  assert.equal(comments.data.find(c=>c.id===result.data.initial_comment_id).body,discussion);
});

test('retired-image rejection and author checks preserve the original saved comment',async t=>{
  const env=await setup(t),db=env.DB;
  const posted=await rpc(env,'post_shared_comment',{p_share_slug:'public-book',p_question_id:'public-book-q',p_body:discussion,p_attachments:[]});
  const before=db.sqlite.prepare('SELECT * FROM comments WHERE id=?').get(posted.data);
  const rejected=await rpc(env,'update_shared_comment',{p_comment_id:posted.data,p_body:'https://fixture.test/v1/public/'+retiredKey,p_attachments:[]});
  assert.equal(rejected.status,409);assert.equal(rejected.error,'question_image_retired');
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM comments WHERE id=?').get(posted.data),before);
  db.sqlite.prepare("INSERT INTO comments(id,collection_id,question_id,user_id,body) VALUES('other-comment','public-book','public-book-q',?,'original')").run(other);
  const denied=await rpc(env,'update_shared_comment',{p_comment_id:'other-comment',p_body:'edited',p_attachments:[]});
  assert.equal(denied.status,403);assert.equal(db.sqlite.prepare("SELECT body FROM comments WHERE id='other-comment'").get().body,'original');
});

test('guard migration changes only trigger definitions and retains bounded recursion on every entry point',async t=>{
  const {DB:db}=await setup(t);
  db.sqlite.prepare("INSERT INTO comments(id,collection_id,question_id,user_id,body) VALUES('existing','public-book','public-book-q',?,?)").run(owner,discussion);
  db.sqlite.prepare("INSERT INTO answer_attempts(id,client_attempt_id,user_id,question_id,answer,grade) VALUES('answer','answer',?,'public-book-q','{}','◎')").run(owner);
  db.sqlite.prepare("INSERT INTO question_reactions(question_id,user_id,reaction_key) VALUES('public-book-q',?,'like')").run(owner);
  const tables=['questions','comments','answer_attempts','question_reactions','private_retired_question_images'];
  const before=tables.map(table=>db.sqlite.prepare('SELECT * FROM '+table).all());
  db.sqlite.exec(migration);
  assert.deepEqual(tables.map(table=>db.sqlite.prepare('SELECT * FROM '+table).all()),before);
  const guards=db.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'retired_image_%'").all().filter(x=>x.sql.includes('WITH RECURSIVE'));
  assert.equal(guards.length,10);
  for(const {sql} of guards){
    // D1 rejects a recursive arm that re-enters these materialized siblings.
    // Confirm the deployed definitions use the remotely verified bounded form.
    const chunks=sql.slice(sql.indexOf('), chunks('),sql.indexOf('), text_values('));
    const slashes=sql.slice(sql.indexOf('), slashes('),sql.indexOf('), segments('));
    assert.doesNotMatch(chunks,/JOIN inputs/);
    assert.doesNotMatch(slashes,/JOIN text_values/);
    assert.match(sql,/chunks\(input_id,input_length,offset\)/);
    assert.match(sql,/slashes\(text_id,value,previous,position\)/);
  }
});
