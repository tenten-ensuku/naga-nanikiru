import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {builderRpc,collectionCapacity} from '../cloudflare/collection-builder-v235.mjs';
import {previewCollectionDeletion,deleteCollection} from '../cloudflare/collection-deletion-v244.mjs';
import {readRpc} from '../cloudflare/read-api.mjs';
const actor={id:'owner'};
function fixture(t,n=0){const db=testD1();t.after(()=>db.close());db.sqlite.exec(`INSERT INTO profiles(id,display_name) VALUES ('owner','所有者'),('viewer','閲覧者'),('editor','編集者');INSERT INTO collections(id,owner_id,title,share_slug,book_tone) VALUES ('c','owner','テスト問題集','book','teal');INSERT INTO collection_members(collection_id,user_id,role) VALUES ('c','editor','editor'),('c','viewer','viewer');`);for(let i=1;i<=n;i++)db.sqlite.prepare(`INSERT INTO questions(id,collection_id,created_by,legacy_key,sort_order,source_report_id,payload,title) VALUES (?,'c','owner',?,?,?,?,?)`).run(`q${i}`,`legacy${i}`,i,`report${i}`,JSON.stringify({number:i,id:`q${i}`,answer:'fixture'}),`問題${i}`);return {db,actor};}
const question=i=>({p_share_slug:'book',p_title:'生成候補',p_payload:{id:`new${i}`,handBeforeDraw:['man1','man2','man3','man4','man5','man6','man7','man8','man9','pin1','pin2','pin3','ji1'],draw:'ji1',actualDiscard:'ji1',melds:[]},p_source_kind:'naga_scene',p_source_report_id:`new${i}`,p_scene_tw:0,p_scene_ts:0,p_scene_tv:i});

test('deleting the last volume reserves its number and allows the next new volume',async t=>{
  const ctx=fixture(t,195);
  const second=await builderRpc('create_collection_volume',{p_share_slug:'book'},ctx);
  const preview=await previewCollectionDeletion({p_share_slug:second.share_slug},ctx);
  await deleteCollection({p_share_slug:second.share_slug,p_confirmed:true,p_confirmation_token:preview.confirmation_token},ctx);
  const capacity=await collectionCapacity({p_share_slug:'book'},ctx);
  assert.equal(capacity.next_volume,3);assert.equal(capacity.next_share_slug,null);
  await assert.rejects(builderRpc('create_collection_volume',{p_share_slug:'book',p_volume_number:2},ctx),e=>e.code==='collection_already_deleted');
  const third=await builderRpc('create_collection_volume',{p_share_slug:'book'},ctx);
  assert.equal(third.volume_number,3);assert.notEqual(third.id,second.id);
  assert.ok(ctx.db.sqlite.prepare('SELECT archived_at FROM collections WHERE id=?').get(second.id).archived_at);
  assert.equal((await collectionCapacity({p_share_slug:'book'},ctx)).next_share_slug,third.share_slug);
  assert.equal((await builderRpc('create_collection_volume',{p_share_slug:'book'},ctx)).id,third.id);
});
test('retrying creation of a deleted standalone book cannot resurrect it',async t=>{
  const ctx=fixture(t);const args={p_title:'削除する本',p_request_id:crypto.randomUUID()};
  const book=await builderRpc('create_collection',args,ctx);
  const preview=await previewCollectionDeletion({p_share_slug:book.share_slug},ctx);
  await deleteCollection({p_share_slug:book.share_slug,p_confirmed:true,p_confirmation_token:preview.confirmation_token},ctx);
  await assert.rejects(builderRpc('create_collection',args,ctx),e=>e.code==='collection_already_deleted');
  assert.ok(ctx.db.sqlite.prepare('SELECT archived_at FROM collections WHERE id=?').get(book.id).archived_at);
});

test('old duplicate numbers do not add repeated gaps to new questions',async t=>{const ctx=fixture(t,3);ctx.db.sqlite.prepare("UPDATE questions SET payload=json_set(payload,'$.number',2) WHERE id='q3'").run();const a=await builderRpc('create_shared_question',question(41),ctx),b=await builderRpc('create_shared_question',question(42),ctx);assert.equal(a.question_number,4);assert.equal(b.question_number,5);assert.equal(JSON.parse(ctx.db.sqlite.prepare("SELECT payload FROM questions WHERE id='q3'").get().payload).number,2);});
test('mixed malformed and duplicate legacy labels reserve their virtual numbers only once',async t=>{const ctx=fixture(t,3);ctx.db.sqlite.exec("UPDATE questions SET sort_order=0;UPDATE questions SET payload=json_set(payload,'$.number',1) WHERE id='q2';UPDATE questions SET payload=json_set(payload,'$.number',NULL),title='問題-Infinity' WHERE id='q3'");const a=await builderRpc('create_shared_question',question(43),ctx),b=await builderRpc('create_shared_question',question(44),ctx);assert.equal(a.question_number,4);assert.equal(b.question_number,5);assert.equal(JSON.parse(ctx.db.sqlite.prepare("SELECT payload FROM questions WHERE id='q3'").get().payload).number,null);});
test('create with chosen color is private, idempotent and cannot impersonate',async t=>{const ctx=fixture(t);const input={p_title:'新しい本',p_book_tone:'plum',p_request_id:crypto.randomUUID(),owner_id:'viewer'};const a=await builderRpc('create_collection',input,ctx),b=await builderRpc('create_collection',input,ctx);assert.equal(a.id,b.id);assert.equal(a.owner_id,'owner');assert.equal(a.visibility,'private');assert.equal(a.book_tone,'plum');await assert.rejects(builderRpc('create_collection',{...input,p_book_tone:'red;url(x)'},ctx));});
test('195 preview, next-volume inheritance and replay preserve the original questions',async t=>{const ctx=fixture(t,195);const cap=await collectionCapacity({p_share_slug:'book'},ctx);assert.equal(cap.near_capacity,true);assert.equal(cap.remaining,5);const a=await builderRpc('create_collection_volume',{p_share_slug:'book',p_volume_number:2},ctx);const b=await builderRpc('create_collection_volume',{p_share_slug:'book',p_volume_number:2},ctx);assert.equal(a.id,b.id);assert.equal(a.book_tone,'teal');assert.equal(a.visibility,'private');assert.equal(ctx.db.sqlite.prepare("SELECT COUNT(*) n FROM questions WHERE collection_id='c'").get().n,195);assert.equal(ctx.db.sqlite.prepare('SELECT role FROM collection_members WHERE collection_id=? AND user_id=?').get(a.id,'editor').role,'editor');assert.equal(a.title,'テスト問題集 第2巻');});
test('194 has no warning and cannot create an early extra volume',async t=>{const ctx=fixture(t,194);assert.equal((await collectionCapacity({p_share_slug:'book'},ctx)).near_capacity,false);await assert.rejects(builderRpc('create_collection_volume',{p_share_slug:'book'},ctx),e=>e.code==='volume_not_ready');});
test('at 199 simultaneous inserts stop at 200 and duplication is idempotent',async t=>{const ctx=fixture(t,199);const result=await Promise.all([builderRpc('create_shared_question',question(1),ctx),builderRpc('create_shared_question',question(2),ctx)]);assert.equal(result.filter(x=>x.question_id).length,1);assert.equal(result.filter(x=>x.capacity_reached).length,1);assert.equal(ctx.db.sqlite.prepare('SELECT COUNT(*) n FROM questions').get().n,200);const duplicate=await builderRpc('create_shared_question',question(result[0].question_id?1:2),ctx);assert.equal(duplicate.already_exists,true);});
test('DB also rejects direct insert and restore above cap',async t=>{const ctx=fixture(t,200);assert.throws(()=>ctx.db.sqlite.exec(`INSERT INTO questions(id,collection_id,created_by,source_report_id) VALUES ('extra','c','owner','extra')`),/collection_capacity_reached/);ctx.db.sqlite.exec(`INSERT INTO questions(id,collection_id,created_by,source_report_id,deleted_at) VALUES ('old','c','owner','old','2026-01-01')`);assert.throws(()=>ctx.db.sqlite.exec("UPDATE questions SET deleted_at=NULL WHERE id='old'"),/collection_capacity_reached/);});
test('editor may add but cannot recolor or create volumes, viewer cannot write',async t=>{const ctx=fixture(t,195);for(const name of ['create_collection_volume','set_collection_book_tone'])await assert.rejects(builderRpc(name,{p_share_slug:'book',p_book_tone:'navy'},{...ctx,actor:{id:'editor'}}),e=>e.status===403);await assert.rejects(builderRpc('create_shared_question',question(1),{...ctx,actor:{id:'viewer'}}),e=>e.status===403);assert.ok((await builderRpc('create_shared_question',question(1),{...ctx,actor:{id:'editor'}})).question_id);});
test('guard and embedded image uploads remain blocked',async t=>{const ctx=fixture(t);ctx.db.sqlite.exec("INSERT INTO private_ops_capacity_control(singleton,armed,blocked,checked_at) VALUES(1,1,1,'2026-09-12')");await assert.rejects(builderRpc('create_shared_question',question(1),ctx),e=>e.code==='heavy_operations_paused');ctx.db.sqlite.exec('UPDATE private_ops_capacity_control SET armed=0');await assert.rejects(builderRpc('create_shared_question',{...question(1),p_payload:{id:'a',image:'data:image/png;base64,a'}},ctx),e=>e.code==='question_image_upload_required');});
test('import requires source access and uses server-assigned number',async t=>{const ctx=fixture(t,1);const book=await builderRpc('create_collection',{p_title:'保存先',p_request_id:crypto.randomUUID()},ctx);const a=await builderRpc('import_shared_question',{p_source_question_id:'q1',p_target_share_slug:book.share_slug},ctx);assert.equal(a.question_number,1);const b=await builderRpc('import_shared_question',{p_source_question_id:'q1',p_target_share_slug:book.share_slug},ctx);assert.equal(b.already_exists,true);await assert.rejects(builderRpc('import_shared_question',{p_source_question_id:'q1',p_target_share_slug:book.share_slug},{...ctx,actor:{id:'outsider'}}),e=>e.status===404);});

test('V287 owners can edit a book name and description without changing its contents or access',async t=>{
  const ctx=fixture(t,1),before=ctx.db.sqlite.prepare('SELECT * FROM questions').all();
  const original=ctx.db.sqlite.prepare("SELECT * FROM collections WHERE id='c'").get();
  const args={p_share_slug:'book',p_title:'  NANAリーグ 練習帳  ',p_description:'  みんなで検討\n#押し引き  ',owner_id:'viewer',visibility:'public'};
  const saved=await builderRpc('update_collection_details',args,ctx);
  assert.equal(saved.title,'NANAリーグ 練習帳');assert.equal(saved.description,'みんなで検討\n#押し引き');
  const reread=await readRpc('get_shared_collection',{p_share_slug:'book'},ctx);
  assert.equal(reread.title,saved.title);assert.equal(reread.description,saved.description);
  const row=ctx.db.sqlite.prepare("SELECT * FROM collections WHERE id='c'").get();
  for(const key of ['id','owner_id','visibility','share_slug','created_at','book_tone'])assert.equal(row[key],original[key]);
  assert.deepEqual(ctx.db.sqlite.prepare('SELECT * FROM questions').all(),before);
  await builderRpc('update_collection_details',{...args,p_description:''},ctx);
  assert.equal(ctx.db.sqlite.prepare("SELECT description FROM collections WHERE id='c'").get().description,'');
});

test('V287 book details enforce management permission, validation and archive boundaries',async t=>{
  const ctx=fixture(t),args={p_share_slug:'book',p_title:'変更後',p_description:'説明'};
  for(const actor of [{id:'viewer'},{id:'editor'},{id:'outsider'},null]){
    await assert.rejects(builderRpc('update_collection_details',args,{...ctx,actor}),e=>[401,403].includes(e.status));
  }
  for(const patch of [{p_title:' '},{p_title:'a'.repeat(121)},{p_description:'a'.repeat(3001)},{p_description:null}]){
    await assert.rejects(builderRpc('update_collection_details',{...args,...patch},ctx),e=>e.code==='invalid_collection_input');
  }
  assert.equal(ctx.db.sqlite.prepare("SELECT title FROM collections WHERE id='c'").get().title,'テスト問題集');
  await builderRpc('update_collection_details',args,{...ctx,actor:{id:'viewer',is_admin:true}});
  ctx.db.sqlite.exec("UPDATE collections SET archived_at='2026-09-18' WHERE id='c'");
  await assert.rejects(builderRpc('update_collection_details',args,ctx),e=>e.status===403);
});

test('V287 import retains posted and embedded comments, authors, dates, formatting and images exactly once',async t=>{
  const ctx=fixture(t,2),db=ctx.db.sqlite;
  db.exec("UPDATE profiles SET avatar_url='https://cdn.discordapp.com/avatars/author/avatar.png' WHERE id='viewer'");
  const embedded=[{id:'embedded',author:'元の解説者',content:'**基本序列**',createdAt:'2026-08-01T00:00:00Z',attachments:[]}];
  db.prepare("UPDATE questions SET payload=json_set(payload,'$.comments',json(?)) WHERE id='q1'").run(JSON.stringify(embedded));
  const attachments=JSON.stringify([{path:'viewer/comments/example.png',alt:'解説図',spoiler:true}]);
  const insert=db.prepare('INSERT INTO comments(id,collection_id,question_id,user_id,body,attachments,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?)');
  insert.run('comment-a','c','q1','viewer','**太字** ||伏字|| #押し引き',attachments,'2026-08-02T00:00:00Z','2026-08-03T00:00:00Z',null);
  insert.run('comment-b','c','q1','editor','二人目のコメント','[]','2026-08-04T00:00:00Z','2026-08-04T00:00:00Z',null);
  insert.run('deleted','c','q1','viewer','削除済み','[]','2026-08-01','2026-08-01','2026-08-05');
  insert.run('other-question','c','q2','owner','別の問題','[]','2026-08-01','2026-08-01',null);
  insert.run('collection-chat','c',null,'owner','問題集全体','[]','2026-08-01','2026-08-01',null);
  const originals=db.prepare('SELECT * FROM comments ORDER BY id').all();
  const book=await builderRpc('create_collection',{p_title:'保存先',p_request_id:crypto.randomUUID()},ctx);
  const args={p_source_question_id:'q1',p_target_share_slug:book.share_slug};
  const imported=await builderRpc('import_shared_question',args,ctx);
  assert.equal(imported.imported_comment_count,2);
  assert.deepEqual(JSON.parse(db.prepare('SELECT payload FROM questions WHERE id=?').get(imported.question_id).payload).comments,embedded);
  const copied=await readRpc('get_shared_comments',{p_share_slug:book.share_slug,p_question_id:imported.question_id},ctx);
  assert.equal(copied.length,2);assert.equal(copied[0].author_id,'viewer');assert.equal(copied[0].author_name,'閲覧者');
  assert.equal(copied[0].author_avatar_url,'https://cdn.discordapp.com/avatars/author/avatar.png');
  assert.equal(copied[0].body,'**太字** ||伏字|| #押し引き');assert.deepEqual(copied[0].attachments,JSON.parse(attachments));
  assert.equal(copied[0].created_at,'2026-08-02T00:00:00Z');assert.equal(copied[0].updated_at,'2026-08-03T00:00:00Z');
  assert.notEqual(copied[0].id,'comment-a');assert.equal(copied[1].author_id,'editor');
  assert.equal((await builderRpc('import_shared_question',args,ctx)).already_exists,true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM comments WHERE question_id=?').get(imported.question_id).n,2);
  assert.deepEqual(db.prepare("SELECT * FROM comments WHERE collection_id='c' ORDER BY id").all(),originals);
});

test('V287 an import rolls back its question when copying a comment fails',async t=>{
  const ctx=fixture(t,1),db=ctx.db.sqlite;
  db.exec("INSERT INTO comments(id,collection_id,question_id,user_id,body) VALUES ('comment','c','q1','owner','解説')");
  const book=await builderRpc('create_collection',{p_title:'保存先',p_request_id:crypto.randomUUID()},ctx);
  db.exec("CREATE TRIGGER reject_imported_comment BEFORE INSERT ON comments WHEN NEW.collection_id<>'c' BEGIN SELECT RAISE(ABORT,'fixture_comment_failure'); END");
  await assert.rejects(builderRpc('import_shared_question',{p_source_question_id:'q1',p_target_share_slug:book.share_slug},ctx),/fixture_comment_failure/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM questions WHERE collection_id=?').get(book.id).n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM comments').get().n,1);
});
test('generated broken titles are repaired on add, custom numbered titles stay intact',async t=>{const ctx=fixture(t);const a=await builderRpc('create_shared_question',{...question(1),p_title:'問題-Infinity'},ctx);assert.equal(ctx.db.sqlite.prepare('SELECT title FROM questions WHERE id=?').get(a.question_id).title,'問題1');const b=await builderRpc('create_shared_question',{...question(2),p_title:'問題5 の手筋'},ctx);assert.equal(ctx.db.sqlite.prepare('SELECT title FROM questions WHERE id=?').get(b.question_id).title,'問題5 の手筋');});
test('concurrent requests for the same scene with different payload IDs reuse the row',async t=>{const ctx=fixture(t);const a=question(1),b={...a,p_payload:{...a.p_payload,id:'another-client-id'}};const result=await Promise.all([builderRpc('create_shared_question',a,ctx),builderRpc('create_shared_question',b,ctx)]);assert.equal(result[0].question_id,result[1].question_id);assert.equal(ctx.db.sqlite.prepare('SELECT COUNT(*) n FROM questions').get().n,1);});
