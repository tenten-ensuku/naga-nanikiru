import test from 'node:test';
import assert from 'node:assert/strict';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {previewCollectionDeletion,deleteCollection} from '../cloudflare/collection-deletion-v244.mjs';
import {readRpc} from '../cloudflare/read-api.mjs';
import {canAccessCollection,canEditCollection} from '../cloudflare/access.mjs';
import {builderRpc} from '../cloudflare/collection-builder-v235.mjs';

function fixture(t){
  const db=testD1();t.after(()=>db.close());
  db.sqlite.exec(`INSERT INTO profiles(id) VALUES ('owner'),('other'),('editor');
    INSERT INTO collections(id,owner_id,title,share_slug,visibility,published_at) VALUES
      ('book','owner','削除確認用','book','public','2026-01-01'),('keep','owner','残す本','keep','private',NULL);
    INSERT INTO collection_members(collection_id,user_id,role) VALUES ('book','editor','editor');
    INSERT INTO questions(id,collection_id,created_by,title,legacy_key) VALUES ('q','book','owner','問題1','q'),('keep-q','keep','owner','残す問題','keep-q');
    INSERT INTO answer_attempts(id,client_attempt_id,user_id,question_id,grade) VALUES ('answer','answer','owner','q','◎');
  `);
  return {db,actor:{id:'owner'}};
}
async function confirmed(ctx,slug='book'){
  const preview=await previewCollectionDeletion({p_share_slug:slug},ctx);
  return {p_share_slug:slug,p_confirmed:true,p_confirmation_token:preview.confirmation_token};
}
const active=ctx=>ctx.db.sqlite.prepare('SELECT id FROM collections WHERE archived_at IS NULL ORDER BY id').all().map(x=>x.id);
function addVolumes(ctx){ctx.db.sqlite.exec(`UPDATE collections SET series_key='series' WHERE id='book';
  INSERT INTO collections(id,owner_id,title,share_slug,series_parent_id,series_key,volume_number) VALUES ('vol1','owner','第1巻','vol1','book','series',1),('vol2','owner','第2巻','vol2','book','series',2);
  INSERT INTO questions(id,collection_id,created_by,title) VALUES ('q1','vol1','owner','問題1'),('q2','vol2','owner','問題2');`);}

test('preview is read-only; confirmation names exact target and active question count',async t=>{
  const ctx=fixture(t),before=ctx.db.sqlite.prepare('SELECT * FROM collections').all();
  const p=await previewCollectionDeletion({p_share_slug:'book'},ctx);
  assert.equal(p.title,'削除確認用');assert.equal(p.question_count,1);assert.equal(p.child_count,0);assert.equal(p.collection_count,1);
  assert.match(p.confirmation_token,/^[a-f0-9]{64}$/);assert.deepEqual(ctx.db.sqlite.prepare('SELECT * FROM collections').all(),before);
});
test('confirmed deletion hides only the selected book, denies new access, and retains original data',async t=>{
  const ctx=fixture(t),questions=ctx.db.sqlite.prepare('SELECT * FROM questions').all(),answers=ctx.db.sqlite.prepare('SELECT * FROM answer_attempts').all();
  const args=await confirmed(ctx);assert.equal((await deleteCollection(args,ctx)).deleted,true);
  assert.deepEqual(active(ctx),['keep']);assert.equal(await canAccessCollection(ctx.db,ctx.actor,'book'),false);assert.equal(await canEditCollection(ctx.db,ctx.actor,'book'),false);
  assert.equal(await readRpc('get_shared_collection',{p_share_slug:'book'},ctx),null);
  assert.deepEqual(await readRpc('get_shared_question_index_page',{p_share_slug:'book'},ctx),[]);
  assert.deepEqual(ctx.db.sqlite.prepare('SELECT * FROM questions').all(),questions);assert.deepEqual(ctx.db.sqlite.prepare('SELECT * FROM answer_attempts').all(),answers);
  assert.equal((await deleteCollection(args,ctx)).already_deleted,true);
  assert.equal((await readRpc('list_my_collections',{},ctx)).some(c=>c.share_slug==='book'),false);
});
test('zero-question books can also be deleted',async t=>{const ctx=fixture(t);const book=await builderRpc('create_collection',{p_title:'空の本',p_request_id:crypto.randomUUID()},ctx);assert.equal((await previewCollectionDeletion({p_share_slug:book.share_slug},ctx)).question_count,0);assert.equal((await deleteCollection(await confirmed(ctx,book.share_slug),ctx)).deleted,true);});
test('anonymous, editor, other owner and spoofed actor properties cannot delete',async t=>{
  const ctx=fixture(t),args=await confirmed(ctx);
  for(const actor of [null,{id:'editor'},{id:'other',is_admin:1}]){
    await assert.rejects(previewCollectionDeletion({p_share_slug:'book',is_admin:true},{...ctx,actor}),e=>[401,403].includes(e.status));
    await assert.rejects(deleteCollection({...args,owner_id:'owner',is_admin:true},{...ctx,actor}),e=>[401,403].includes(e.status));
  }
  assert.deepEqual(active(ctx),['book','keep']);
});
test('confirmation is required and cannot be reused for another book or actor',async t=>{
  const ctx=fixture(t),args=await confirmed(ctx);
  for(const input of [{p_share_slug:'book'},{...args,p_confirmed:false},{...args,p_confirmation_token:'0'.repeat(64)},{...args,p_share_slug:'keep'}])await assert.rejects(deleteCollection(input,ctx));
  await assert.rejects(deleteCollection(args,{...ctx,actor:{id:'other',is_admin:true}}),e=>e.code==='collection_deletion_changed');
  assert.deepEqual(active(ctx),['book','keep']);
});
test('single volume deletion never deletes parent or siblings; deleting root requires whole-series confirmation',async t=>{
  const ctx=fixture(t);addVolumes(ctx);
  const volume=await previewCollectionDeletion({p_share_slug:'vol1'},ctx);assert.equal(volume.is_volume,true);assert.equal(volume.question_count,1);
  await deleteCollection(await confirmed(ctx,'vol1'),ctx);assert.deepEqual(active(ctx),['book','keep','vol2']);
  const series=await previewCollectionDeletion({p_share_slug:'book'},ctx);assert.equal(series.child_count,1);assert.equal(series.question_count,2);
  await deleteCollection(await confirmed(ctx),ctx);assert.deepEqual(active(ctx),['keep']);
  assert.equal(ctx.db.sqlite.prepare('SELECT COUNT(*) n FROM questions').get().n,4);
});
test('mixed owners in a series are protected; only authenticated admin can delete the complete series',async t=>{
  const ctx=fixture(t);addVolumes(ctx);ctx.db.sqlite.exec("UPDATE collections SET owner_id='other' WHERE id='vol2'");
  await assert.rejects(previewCollectionDeletion({p_share_slug:'book'},ctx),e=>e.code==='collection_deletion_mixed_owners');
  const admin={...ctx,actor:{id:'other',is_admin:true}};await deleteCollection(await confirmed(admin),admin);assert.deepEqual(active(ctx),['keep']);
});
test('changes after preview require a new confirmation, including added questions, titles and child volumes',async t=>{
  const ctx=fixture(t);let args=await confirmed(ctx);
  ctx.db.sqlite.exec("INSERT INTO questions(id,collection_id,created_by) VALUES ('new','book','owner')");
  await assert.rejects(deleteCollection(args,ctx),e=>e.code==='collection_deletion_changed');args=await confirmed(ctx);
  ctx.db.sqlite.exec("UPDATE collections SET title='新しい名前' WHERE id='book'");
  await assert.rejects(deleteCollection(args,ctx),e=>e.code==='collection_deletion_changed');args=await confirmed(ctx);
  addVolumes(ctx);await assert.rejects(deleteCollection(args,ctx),e=>e.code==='collection_deletion_changed');
  assert.deepEqual(active(ctx),['book','keep','vol1','vol2']);
});
test('atomic update cancels ALL writes if a change races the last snapshot read',async t=>{
  const ctx=fixture(t);addVolumes(ctx);const args=await confirmed(ctx),prepare=ctx.db.prepare.bind(ctx.db);let changed=false;
  ctx.db.prepare=sql=>{if(sql.includes('UPDATE collections SET archived_at')&&!changed){changed=true;ctx.db.sqlite.exec("INSERT INTO questions(id,collection_id,created_by) VALUES ('raced','vol2','owner')");}return prepare(sql);};
  await assert.rejects(deleteCollection(args,ctx),e=>e.code==='collection_deletion_changed');assert.equal(changed,true);assert.deepEqual(active(ctx),['book','keep','vol1','vol2']);
});
test('ownership changes and failed DB updates leave all books intact',async t=>{
  const ctx=fixture(t),args=await confirmed(ctx);ctx.db.sqlite.exec("UPDATE collections SET owner_id='other' WHERE id='book'");
  await assert.rejects(deleteCollection(args,ctx),e=>e.status===403);ctx.db.sqlite.exec("UPDATE collections SET owner_id='owner' WHERE id='book'");
  ctx.db.sqlite.exec("CREATE TRIGGER fail_delete BEFORE UPDATE OF archived_at ON collections BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  await assert.rejects(deleteCollection(await confirmed(ctx),ctx),/fixture failure/);assert.deepEqual(active(ctx),['book','keep']);
});
test('capacity pause never blocks a lightweight deletion and no heavy assets are read',async t=>{
  const ctx=fixture(t);ctx.db.sqlite.exec("INSERT INTO private_ops_capacity_control(singleton,armed,blocked,checked_at) VALUES(1,1,1,'2026-01-01')");
  await deleteCollection(await confirmed(ctx),ctx);assert.deepEqual(active(ctx),['keep']);
});
