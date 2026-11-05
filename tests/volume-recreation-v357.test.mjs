import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {builderRpc,collectionCapacity} from '../cloudflare/collection-builder-v235.mjs';
import {questionManagementRpc} from '../cloudflare/question-management-v290.mjs';

function fixture(t){
  const db=testD1();t.after(()=>db.close());
  db.sqlite.exec(`INSERT INTO profiles(id,display_name) VALUES('owner','作成者'),('viewer','閲覧者'),('manager','管理メンバー');
    INSERT INTO collections(id,owner_id,title,share_slug,series_key,visibility,book_tone) VALUES('series','owner','テスト問題集','series','test-series','public','teal');
    INSERT INTO collection_managers(collection_id,user_id,granted_by) VALUES('series','manager','owner');
    INSERT INTO collection_study_models(collection_id,default_model) VALUES('series','ウロボロス');`);
  for(let n=1;n<=7;n++)db.sqlite.prepare(`INSERT INTO collections(id,owner_id,title,share_slug,series_key,series_parent_id,volume_number,volume_start,volume_end,archived_at)
    VALUES(?,'owner',?,?,'test-series','series',?,?,?,?)`).run('v'+n,'テスト問題集 第'+n+'巻','v'+n,n,(n-1)*200+1,n*200,n===6?'2026-11-01':null);
  for(let n=1;n<=7;n++)db.sqlite.prepare(`INSERT INTO collection_managers(collection_id,user_id,granted_by) VALUES(?,'manager','owner')`).run('v'+n);
  db.sqlite.exec(`INSERT INTO questions(id,collection_id,title,legacy_key,payload,created_by) VALUES('old-q','v6','問題1001','old-q','{"number":1001,"comments":["保管するコメント"]}','owner');
    INSERT INTO question_reactions(question_id,user_id,reaction_key) VALUES('old-q','viewer','like');`);
  return {db,actor:{id:'owner'}};
}
const args={p_share_slug:'series',p_volume_number:6,p_replaces_collection_id:'v6'};
test('recreate missing sixth volume even with seventh present; retain old payload/reactions and inherit current permissions/model',async t=>{
  const ctx=fixture(t),before=ctx.db.sqlite.prepare("SELECT * FROM questions WHERE id='old-q'").get();
  const cap=await collectionCapacity({p_share_slug:'series'},ctx);
  assert.deepEqual(cap.recreatable_volumes.map(v=>v.volume_number),[6]);
  const [a,b]=await Promise.all([builderRpc('create_collection_volume',args,ctx),builderRpc('create_collection_volume',args,ctx)]);
  assert.equal(a.id,b.id);assert.notEqual(a.id,'v6');assert.equal(a.title,'テスト問題集 第6巻');
  assert.equal(a.volume_start,1001);assert.equal(a.volume_end,1200);assert.equal(a.owner_id,'owner');assert.equal(a.book_tone,'teal');
  assert.equal(ctx.db.sqlite.prepare('SELECT COUNT(*) n FROM questions WHERE collection_id=?').get(a.id).n,0);
  assert.deepEqual(ctx.db.sqlite.prepare("SELECT * FROM questions WHERE id='old-q'").get(),before);
  assert.equal(ctx.db.sqlite.prepare("SELECT COUNT(*) n FROM question_reactions WHERE question_id='old-q'").get().n,1);
  assert.ok(ctx.db.sqlite.prepare("SELECT archived_at FROM collections WHERE id='v6'").get().archived_at);
  assert.equal(ctx.db.sqlite.prepare('SELECT status FROM collection_managers WHERE collection_id=? AND user_id=?').get(a.id,'manager').status,'active');
  // Study model resolution follows the series parent, as for ordinary volumes.
  assert.equal(ctx.db.sqlite.prepare('SELECT default_model FROM collection_study_models WHERE collection_id=?').get(a.series_parent_id).default_model,'ウロボロス');
  assert.equal((await collectionCapacity({p_share_slug:'series'},ctx)).recreatable_volumes.length,0);
  assert.equal(ctx.db.sqlite.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('only owner/admin can recreate; explicit archived ID is required and wrong generation is rejected',async t=>{
  const ctx=fixture(t);
  for(const id of ['viewer','manager'])await assert.rejects(builderRpc('create_collection_volume',args,{...ctx,actor:{id}}),e=>e.status===403);
  assert.equal((await collectionCapacity({p_share_slug:'series'},{...ctx,actor:{id:'manager'}})).recreatable_volumes.length,0);
  await assert.rejects(builderRpc('create_collection_volume',{...args,p_replaces_collection_id:null},ctx),e=>e.code==='volume_recreation_confirmation_required');
  await assert.rejects(builderRpc('create_collection_volume',{...args,p_replaces_collection_id:'v5'},ctx),e=>e.code==='volume_recreation_confirmation_required');
  await assert.rejects(builderRpc('create_collection_volume',{...args,p_volume_number:8},ctx),e=>e.code==='volume_recreation_changed');
});
test('repeated deletion/recreation uses another ID; stale replay never revives the earlier generation',async t=>{
  const ctx=fixture(t),a=await builderRpc('create_collection_volume',args,ctx);
  ctx.db.sqlite.prepare('UPDATE collections SET archived_at=? WHERE id=?').run('2026-11-05',a.id);
  await assert.rejects(builderRpc('create_collection_volume',args,ctx),e=>e.code==='volume_recreation_confirmation_required');
  const b=await builderRpc('create_collection_volume',{...args,p_replaces_collection_id:a.id},ctx);
  assert.notEqual(a.id,b.id);
  await assert.rejects(builderRpc('create_collection_volume',args,ctx),e=>e.code==='volume_recreation_changed');
  assert.throws(()=>ctx.db.sqlite.prepare(`INSERT INTO collections(id,owner_id,title,share_slug,series_parent_id,volume_number) VALUES('dup','owner','重複','dup','series',6)`).run(),/UNIQUE/);
  assert.equal(ctx.db.sqlite.prepare("SELECT COUNT(*) n FROM collections WHERE series_parent_id='series' AND volume_number=6").get().n,3);
});
test('last deleted sixth volume is offered as next sixth; deleted parent blocks recreation',async t=>{
  const ctx=fixture(t);ctx.db.sqlite.prepare("UPDATE collections SET archived_at='2026-11-04' WHERE id='v7'").run();
  const cap=await collectionCapacity({p_share_slug:'v5'},ctx);assert.equal(cap.next_volume,6);assert.equal(cap.next_replaces_collection_id,'v6');
  ctx.db.sqlite.prepare("UPDATE collections SET archived_at='2026-11-05' WHERE id='series'").run();
  await assert.rejects(builderRpc('create_collection_volume',{...args,p_share_slug:'v5'},ctx));
});
test('list deletion and undo persist server state while preserving question content and reactions',async t=>{
  const ctx=fixture(t);ctx.db.sqlite.prepare("UPDATE collections SET archived_at=NULL WHERE id='v6'").run();
  const before=ctx.db.sqlite.prepare("SELECT payload FROM questions WHERE id='old-q'").get().payload;
  await assert.rejects(questionManagementRpc('trash_question',{p_question_id:'old-q'},{...ctx,actor:{id:'viewer'}}),e=>e.status===403);
  await questionManagementRpc('trash_question',{p_question_id:'old-q'},ctx);
  assert.ok(ctx.db.sqlite.prepare("SELECT deleted_at FROM questions WHERE id='old-q'").get().deleted_at);
  await questionManagementRpc('restore_question',{p_question_id:'old-q'},ctx);
  assert.equal(ctx.db.sqlite.prepare("SELECT deleted_at FROM questions WHERE id='old-q'").get().deleted_at,null);
  assert.equal(ctx.db.sqlite.prepare("SELECT payload FROM questions WHERE id='old-q'").get().payload,before);
  assert.equal(ctx.db.sqlite.prepare("SELECT COUNT(*) n FROM question_reactions WHERE question_id='old-q'").get().n,1);
});
test('capacity UI offers explicit empty sixth-volume recreation at low count and escapes metadata',()=>{
  const context=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('../public/book-builder-v235.js',import.meta.url),'utf8'),context);
  const html=context.MinkiruBookBuilderV235.capacityMarkup({question_count:0,collection_title:'第7巻',can_create_volume:true,recreatable_volumes:[{volume_number:6,collection_id:'old"<6'}]});
  assert.match(html,/第6巻を作り直す/);assert.match(html,/以前の問題は戻りません/);assert.match(html,/data-replaces-collection-id="old&quot;&lt;6"/);
});

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const source=name=>{const match=html.match(new RegExp(`^      (?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^      \\}`, 'm'));assert.ok(match,name);return match[0];};
function listFixture(t){
  const ctx=fixture(t);ctx.db.sqlite.prepare("UPDATE collections SET archived_at=NULL WHERE id='v6'").run();
  const dialog={open:false,close(){this.open=false;}},q={id:'old-q',number:1001,title:'問題1001',serverQuestionId:'old-q'},calls=[],alerts=[];
  const vmctx=vm.createContext({questionsV16:[q],sharedCollectionV46:{share_slug:'v6'},managedQuestionIndexV44:99,
    userStateV16:{trashed:[],snoozed:{},answerHistory:[{questionKey:'old-q',scoreMark:'◎'}]},
    deletingQuestionV357:false,lastDeletedQuestionV357:null,canDeleteQuestionV47:()=>true,canTrashQuestionV47:()=>true,
    isSharedQuestionV47:()=>true,questionKeyV16:q=>q.id,isTrashedV16:q=>vmctx.userStateV16.trashed.includes(q.id),
    document:{getElementById:id=>id==='questionManageDialog'?dialog:{}},window:{confirm:()=>true,alert:s=>alerts.push(s)},
    confirmSharedImpactV47:()=>vmctx.confirmation,
    invokeSharedMutationV47:async(action,payload)=>{calls.push([action,payload.questionId]);if(vmctx.failMutation)throw Error('保存失敗');await questionManagementRpc(action==='trash'?'trash_question':'restore_question',{p_question_id:payload.questionId},ctx);},
    saveUserStateV16:()=>{},renderQuestionOptionsV16:()=>{},renderMenuCardsV16:()=>{},renderQuestionDeletionNoticeV357:()=>{},
    confirmation:true,failMutation:false,calls,alerts,button:{isConnected:true,disabled:false}});
  for(const name of ['manageQuestionV44','deleteQuestionFromListV357','undoQuestionDeletionV357'])vm.runInContext(source(name),vmctx);
  return {vmctx,db:ctx.db};
}
test('list click uses selected row, cancellation/errors preserve it; confirmed deletion and undo reach the server',async t=>{
  const {vmctx,db}=listFixture(t);
  vmctx.confirmation=false;await vmctx.deleteQuestionFromListV357(0,vmctx.button);
  assert.equal(vmctx.calls.length,0);assert.equal(vmctx.lastDeletedQuestionV357,null);
  vmctx.confirmation=true;vmctx.failMutation=true;await vmctx.deleteQuestionFromListV357(0,vmctx.button);
  assert.equal(vmctx.userStateV16.trashed.length,0);assert.equal(vmctx.lastDeletedQuestionV357,null);assert.equal(vmctx.alerts.length,1);
  vmctx.failMutation=false;await vmctx.deleteQuestionFromListV357(0,vmctx.button);
  assert.ok(db.sqlite.prepare("SELECT deleted_at FROM questions WHERE id='old-q'").get().deleted_at);
  assert.equal(vmctx.lastDeletedQuestionV357.key,'old-q');assert.equal(vmctx.button.disabled,false);
  await vmctx.undoQuestionDeletionV357(vmctx.button);
  assert.equal(db.sqlite.prepare("SELECT deleted_at FROM questions WHERE id='old-q'").get().deleted_at,null);
  assert.equal(vmctx.userStateV16.trashed.length,0);assert.equal(vmctx.lastDeletedQuestionV357,null);
  assert.equal(vmctx.userStateV16.answerHistory[0].scoreMark,'◎');
});
test('list deletion ignores unauthorized rows and duplicate clicks while a mutation is pending',async t=>{
  const {vmctx}=listFixture(t);vmctx.canDeleteQuestionV47=()=>false;
  await vmctx.deleteQuestionFromListV357(0,vmctx.button);assert.equal(vmctx.calls.length,0);
  vmctx.canDeleteQuestionV47=()=>true;
  let resume;vmctx.invokeSharedMutationV47=()=>new Promise(resolve=>{resume=resolve;});
  const first=vmctx.deleteQuestionFromListV357(0,vmctx.button);
  assert.equal(vmctx.button.disabled,true);await vmctx.deleteQuestionFromListV357(0,vmctx.button);
  assert.equal(vmctx.deletingQuestionV357,true);resume();await first;assert.equal(vmctx.deletingQuestionV357,false);
});
test('row actions render favorite followed by delete only for permitted accounts',()=>{
  const render=source('renderMenuCardsV16');
  const body=render.slice(render.indexOf('grid.innerHTML = visibleEntries.map(({ question, index }) => {')+'grid.innerHTML = visibleEntries.map(({ question, index }) => {'.length,render.lastIndexOf('}).join("");'));
  const context=vm.createContext({recentScoresV16:()=>[],isFavoriteV16:()=>false,escapeHtml:s=>String(s).replaceAll('<','&lt;').replaceAll('"','&quot;'),
    questionTypeV44:()=> '打牌判断',commentNotificationCountForQuestionV65:()=>0,notificationBadgeMarkupV65:()=>'',questionKeyV16:q=>q.id,
    questionCreatedMarkupV246:()=>'',canDeleteQuestionV47:()=>true});
  vm.runInContext('function row(question,index){'+body+'}',context);
  const q={number:1001,title:'<問題>',id:'q'},row=context.row(q,3);
  assert.ok(row.indexOf('data-menu-action="favorite"')<row.indexOf('data-menu-action="delete"'));assert.match(row,/&lt;問題>/);
  context.canDeleteQuestionV47=()=>false;assert.doesNotMatch(context.row(q,3),/data-menu-action="delete"/);
});
test('leaving a book during deletion does not change another book or show a misleading undo notice',async t=>{
  const {vmctx}=listFixture(t);let resume;
  vmctx.invokeSharedMutationV47=()=>new Promise(resolve=>{resume=resolve;});
  const pending=vmctx.deleteQuestionFromListV357(0,vmctx.button);
  vmctx.sharedCollectionV46={share_slug:'another-book'};resume();await pending;
  assert.equal(vmctx.lastDeletedQuestionV357,null);assert.equal(vmctx.userStateV16.trashed.length,0);
});
