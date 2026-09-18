import test from 'node:test';
import assert from 'node:assert/strict';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {managerRpc} from '../cloudflare/collection-managers-v290.mjs';
import {builderRpc} from '../cloudflare/collection-builder-v235.mjs';
import {questionManagementRpc} from '../cloudflare/question-management-v290.mjs';
import {readRpc} from '../cloudflare/read-api.mjs';
import {canAccessCollection,canEditCollection,canManageCollection,canManageCollectionContent} from '../cloudflare/access.mjs';
import {previewCollectionDeletion} from '../cloudflare/collection-deletion-v244.mjs';
import worker from '../cloudflare/worker.mjs';
import {sha256} from '../cloudflare/auth.mjs';

function setup(t){
  const db=testD1();t.after(()=>db.close());
  for(const [i,id,name] of [[1,'owner','作成者'],[2,'manager','ピエール'],[3,'viewer','閲覧者'],[4,'editor','編集者'],[5,'old','ピエール'],[6,'other','別の人']]){
    db.sqlite.prepare('INSERT INTO profiles(id,display_name,created_at) VALUES(?,?,?)').run(id,name,`2026-09-${String(i).padStart(2,'0')}T00:00:00Z`);
    db.sqlite.prepare('INSERT INTO auth_identities(user_id,discord_user_id,disabled) VALUES(?,?,?)').run(id,'11111111111111111'+i,id==='old'?1:0);
  }
  db.sqlite.exec(`INSERT INTO collections(id,owner_id,title,share_slug) VALUES('book','owner','チーム問題集','team'),('second','other','別の問題集','other');
    INSERT INTO collection_members(collection_id,user_id,role) VALUES('book','viewer','viewer'),('book','editor','editor');
    INSERT INTO questions(id,collection_id,created_by,title,payload) VALUES('q','book','owner','問題1','{"number":1,"answer":"pin1","comments":[{"body":"元の解説"}],"boardScene":{"fixture":true}}');
    INSERT INTO comments(id,collection_id,question_id,user_id,body) VALUES('comment','book','q','owner','元のコメント');
    INSERT INTO answer_attempts(id,client_attempt_id,user_id,question_id,grade) VALUES('attempt','attempt','owner','q','◎');`);
  return {db,actor:{id:'owner'}};
}
const input=(id='manager',enabled=true)=>({p_share_slug:'team',p_user_id:id,p_enabled:enabled});
test('owner chooses an active account and only that book gets management; revocation is immediate',async t=>{
  const ctx=setup(t),manager={id:'manager'};
  assert.equal(await canAccessCollection(ctx.db,manager,'book'),false);
  await managerRpc('set_collection_manager',input(),ctx);
  for(const [fn,expected] of [[canAccessCollection,true],[canEditCollection,true],[canManageCollectionContent,true],[canManageCollection,false]])assert.equal(await fn(ctx.db,manager,'book'),expected);
  assert.equal(await canEditCollection(ctx.db,manager,'second'),false);
  const view=await readRpc('get_shared_collection',{p_share_slug:'team'},{...ctx,actor:manager});
  assert.equal(view.can_manage,true);assert.equal(view.can_administer,false);assert.equal(view.member_role,'manager');
  const mine=await readRpc('list_my_collections',{}, {...ctx,actor:manager}),book=mine.find(x=>x.share_slug==='team');
  assert.ok(book);assert.equal(book.can_manage,true);assert.equal(book.can_administer,false);
  // A private book is available to its manager, but stays out of the public directory.
  assert.equal((await readRpc('list_collection_directory',{}, {...ctx,actor:manager})).some(x=>x.share_slug==='team'),false);
  await assert.rejects(previewCollectionDeletion({p_share_slug:'team'},{...ctx,actor:manager}),e=>e.status===403);
  await builderRpc('update_collection_details',{p_share_slug:'team',p_title:'チーム検討帳',p_description:'共有の解説'},{...ctx,actor:manager});
  await builderRpc('set_collection_book_tone',{p_share_slug:'team',p_book_tone:'navy'},{...ctx,actor:manager});
  assert.equal(ctx.db.sqlite.prepare("SELECT visibility FROM collections WHERE id='book'").get().visibility,'private');
  await managerRpc('set_collection_manager',input('manager',false),ctx);
  assert.equal(await canEditCollection(ctx.db,manager,'book'),false);
  await assert.rejects(builderRpc('set_collection_book_tone',{p_share_slug:'team',p_book_tone:'plum'},{...ctx,actor:manager}),e=>e.status===403);
});
test('manager, editor, viewer and unrelated owner cannot delegate or list book grants',async t=>{
  const ctx=setup(t);await managerRpc('set_collection_manager',input(),ctx);
  for(const actor of [null,{id:'manager'},{id:'editor'},{id:'viewer'},{id:'other'}]){
    for(const name of ['set_collection_manager','list_collection_managers','search_collection_manager_candidates']){
      await assert.rejects(managerRpc(name,{...input('other'),p_query:'ピエール',owner_id:actor?.id,is_admin:true},{...ctx,actor}),e=>[401,403].includes(e.status));
    }
  }
  for(const args of [{...input(),p_enabled:'true'},input('missing'),input('old'),input('owner')])await assert.rejects(managerRpc('set_collection_manager',args,ctx));
  ctx.db.sqlite.exec("UPDATE collections SET archived_at='2026-09-18' WHERE id='book'");
  await assert.rejects(managerRpc('set_collection_manager',input('other'),ctx),e=>e.status===403);
});
test('candidate search has bounded minimal identity data and separates same-name accounts',async t=>{
  const ctx=setup(t);ctx.db.sqlite.exec("UPDATE auth_identities SET disabled=0 WHERE user_id='old'");
  const rows=await managerRpc('search_collection_manager_candidates',{p_query:'ピエール',p_share_slug:'team'},ctx);
  assert.equal(rows.length,2);assert.notEqual(rows[0].user_id,rows[1].user_id);assert.notEqual(rows[0].registered_at,rows[1].registered_at);
  assert.deepEqual(Object.keys(rows[0]).sort(),['account_hint','display_name','registered_at','user_id']);
  assert.deepEqual(await managerRpc('search_collection_manager_candidates',{p_query:''},ctx),[]);
  ctx.db.sqlite.exec("UPDATE auth_identities SET disabled=1 WHERE user_id='old'");
  assert.equal((await managerRpc('search_collection_manager_candidates',{p_query:'ピエール'},ctx)).length,1);
});
test('grant and revoke preserve independent view/editor membership and all learning records',async t=>{
  const ctx=setup(t),tables=['collections','collection_members','questions','comments','answer_attempts'];
  const before=tables.map(table=>ctx.db.sqlite.prepare(`SELECT * FROM ${table}`).all());
  for(const id of ['viewer','editor']){
    await managerRpc('set_collection_manager',input(id),ctx);
    await managerRpc('set_collection_manager',input(id,false),ctx);
    assert.equal(await canAccessCollection(ctx.db,{id},'book'),true);
    assert.equal(await canEditCollection(ctx.db,{id},'book'),id==='editor');
    assert.equal(await canManageCollectionContent(ctx.db,{id},'book'),false);
  }
  assert.deepEqual(tables.map(table=>ctx.db.sqlite.prepare(`SELECT * FROM ${table}`).all()),before);
});
test('new book and selected managers are atomic, private by default and idempotent',async t=>{
  const ctx=setup(t),args={p_title:'新しいチーム問題集',p_request_id:crypto.randomUUID(),p_manager_ids:['manager','manager']};
  const book=await builderRpc('create_collection',args,ctx);
  assert.equal(book.visibility,'private');assert.equal(book.owner_id,'owner');
  assert.equal(await canManageCollectionContent(ctx.db,{id:'manager'},book.id),true);
  const repeat=await builderRpc('create_collection',{...args,p_manager_ids:['other']},ctx);
  assert.equal(repeat.id,book.id);assert.equal(await canManageCollectionContent(ctx.db,{id:'other'},book.id),false);
  await assert.rejects(builderRpc('create_collection',{...args,p_request_id:crypto.randomUUID(),p_manager_ids:['old']},ctx));
  ctx.db.sqlite.exec("CREATE TRIGGER fail_manager BEFORE INSERT ON collection_managers BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  await assert.rejects(builderRpc('create_collection',{...args,p_title:'rollback',p_request_id:crypto.randomUUID()},ctx));
  assert.equal(ctx.db.sqlite.prepare("SELECT count(*) n FROM collections WHERE title='rollback'").get().n,0);
});
test('question editor saves metadata without overwriting answers, board or comments; trash is reversible',async t=>{
  const ctx=setup(t);await managerRpc('set_collection_manager',input(),ctx);const manager={...ctx,actor:{id:'manager'}};
  const payload=JSON.parse(ctx.db.sqlite.prepare("SELECT payload FROM questions WHERE id='q'").get().payload);
  await questionManagementRpc('update_shared_question',{p_question_id:'q',p_title:'検討問題',p_payload:{answer:'wrong',boardScene:null,comments:[],nagaUrl:'https://example.com/report',threadUrl:''}},manager);
  const saved=JSON.parse(ctx.db.sqlite.prepare("SELECT payload FROM questions WHERE id='q'").get().payload);
  for(const key of ['number','answer','boardScene','comments'])assert.deepEqual(saved[key],payload[key]);
  await questionManagementRpc('trash_question',{p_question_id:'q'},manager);
  assert.ok(ctx.db.sqlite.prepare("SELECT deleted_at FROM questions WHERE id='q'").get().deleted_at);
  assert.equal(ctx.db.sqlite.prepare('SELECT count(*) n FROM comments').get().n,1);
  assert.equal(ctx.db.sqlite.prepare('SELECT count(*) n FROM answer_attempts').get().n,1);
  await questionManagementRpc('restore_question',{p_question_id:'q'},manager);
  assert.equal(ctx.db.sqlite.prepare("SELECT deleted_at FROM questions WHERE id='q'").get().deleted_at,null);
  assert.deepEqual(ctx.db.sqlite.prepare('SELECT event_type FROM question_audit_events ORDER BY id').all().map(x=>x.event_type),['updated','trashed','restored']);
  await managerRpc('set_collection_manager',input('manager',false),ctx);
  await assert.rejects(questionManagementRpc('trash_question',{p_question_id:'q'},manager),e=>e.status===403);
});
test('HTTP grants require session, CSRF, owner role and rate limit; spoofed body never elevates',async t=>{
  const ctx=setup(t),origin='https://fixture.test',token='a'.repeat(64),csrf='b'.repeat(64);
  ctx.db.sqlite.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?,?)').run(await sha256(token),'owner',await sha256(csrf),Math.floor(Date.now()/1000)+3600,0);
  const env={DB:ctx.db,APP_ORIGIN:origin,CUTOVER_READY:'true',DISCORD_CLIENT_ID:'111111111111111111',DISCORD_CLIENT_SECRET:'fixture-only'};
  const request=(headers={},body=input())=>new Request(origin+'/api/rpc/set_collection_manager',{method:'POST',headers:{Cookie:'__Host-minkiru_session='+token,Origin:origin,'Content-Type':'application/json','X-Minkiru-CSRF':csrf,...headers},body:JSON.stringify(body)});
  assert.equal((await worker.fetch(request({Cookie:''}),env)).status,401);
  assert.equal((await worker.fetch(request({'X-Minkiru-CSRF':'wrong'}),env)).status,403);
  assert.equal((await worker.fetch(request({Origin:'https://evil.test'}),env)).status,403);
  env.WRITE_LIMIT={limit:async()=>({success:false})};assert.equal((await worker.fetch(request(),env)).status,429);
  env.WRITE_LIMIT={limit:async()=>({success:true})};assert.equal((await worker.fetch(request(),env)).status,200);
  ctx.db.sqlite.prepare('UPDATE auth_sessions SET user_id=?').run('manager');
  assert.equal((await worker.fetch(request({}, {...input('other'),is_admin:true,owner_id:'manager'}),env)).status,403);
});

test('a selected manager can add and import comments, while unrelated books remain protected',async t=>{
  const ctx=setup(t);await managerRpc('set_collection_manager',input(),ctx);
  const manager={...ctx,actor:{id:'manager'}};
  const added=await builderRpc('create_shared_question',{p_share_slug:'team',p_title:'検討用',p_payload:{id:'manager-added',answer:'pin1'},p_initial_comment:'**検討のポイント** #押し引き'},manager);
  assert.ok(added.question_id);assert.ok(added.initial_comment_id);
  const second=await builderRpc('create_collection',{p_title:'別冊',p_request_id:crypto.randomUUID(),p_manager_ids:['manager']},ctx);
  const imported=await builderRpc('import_shared_question',{p_source_question_id:added.question_id,p_target_share_slug:second.share_slug},manager);
  assert.equal(imported.imported_comment_count,1);
  assert.equal(ctx.db.sqlite.prepare('SELECT body FROM comments WHERE question_id=?').get(imported.question_id).body,'**検討のポイント** #押し引き');
  await assert.rejects(builderRpc('import_shared_question',{p_source_question_id:added.question_id,p_target_share_slug:'other'},manager),e=>e.status===403);
  await managerRpc('set_collection_manager',input('manager',false),ctx);
  await assert.rejects(builderRpc('create_shared_question',{p_share_slug:'team',p_payload:{id:'revoked'}},manager),e=>e.status===403);
});

test('owner-created next volumes inherit managers and preserve the original questions',async t=>{
  const ctx=setup(t);await managerRpc('set_collection_manager',input(),ctx);
  const insert=ctx.db.sqlite.prepare("INSERT INTO questions(id,collection_id,created_by,title,payload) VALUES(?,'book','owner',?,'{}')");
  for(let i=2;i<=195;i++)insert.run('q'+i,'問題'+i);
  const before=ctx.db.sqlite.prepare('SELECT * FROM questions ORDER BY id').all();
  await assert.rejects(builderRpc('create_collection_volume',{p_share_slug:'team'},{...ctx,actor:{id:'manager'}}),e=>e.status===403);
  const volume=await builderRpc('create_collection_volume',{p_share_slug:'team'},ctx);
  assert.equal(await canManageCollectionContent(ctx.db,{id:'manager'},volume.id),true);
  assert.equal(await canManageCollection(ctx.db,{id:'manager'},volume.id),false);
  assert.equal(volume.visibility,'private');
  assert.deepEqual(ctx.db.sqlite.prepare('SELECT * FROM questions ORDER BY id').all(),before);
});
