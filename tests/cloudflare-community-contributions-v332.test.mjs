import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {COMMUNITY_COLLECTION_ID as communityId} from '../cloudflare/community-contributions-v332.mjs';
import {canContributeCollection,canEditCollection,canManageCollectionContent} from '../cloudflare/access.mjs';
import {builderRpc,collectionCapacity} from '../cloudflare/collection-builder-v235.mjs';
import {questionManagementRpc} from '../cloudflare/question-management-v290.mjs';
import {readRpc} from '../cloudflare/read-api.mjs';
import {imageUpload} from '../cloudflare/media-write-v241.mjs';
const actor={id:'ordinary-user'},owner={id:'owner'},origin='https://fixture.test';
function setup(t){
  const db=testD1({generation:true});t.after(()=>db.close());
  db.sqlite.exec("INSERT INTO profiles(id) VALUES('owner'),('ordinary-user'),('another-user');");
  db.sqlite.prepare("INSERT INTO collections(id,owner_id,title,share_slug,visibility,published_at) VALUES(?,'owner','みん切る共有問題集','community','public','2026-09-17')").run(communityId);
  // Same title and default allow_contributions must not open another user's book.
  db.sqlite.exec("INSERT INTO collections(id,owner_id,title,share_slug,visibility,published_at) VALUES('other','owner','みん切る共有問題集','other','public','2026-09-17'),('private','owner','非公開','private','private',NULL)");
  return {db,actor,origin};
}
const question=(id,slug='community')=>({p_share_slug:slug,p_payload:{id,handBeforeDraw:['man1','man2','man3','man4','man5','man6','man7','man8','man9','pin1','pin2','pin3','ji1'],draw:'ji1',actualDiscard:'ji1',melds:[]},p_source_kind:'naga_scene',p_source_report_id:'report-'+id,p_scene_tw:0,p_scene_ts:0,p_scene_tv:1});
async function catalog(ctx){return (await readRpc('list_my_collections',{},ctx)).find(c=>c.id===communityId);}

test('any signed-in nonmember sees the community destination with addition-only capabilities',async t=>{
  const ctx=setup(t);
  for(const user of [actor,{id:'another-user'}]){
    const userCtx={...ctx,actor:user};
    assert.equal(await canContributeCollection(ctx.db,user,communityId),true);
    assert.equal(await canEditCollection(ctx.db,user,communityId),false);
    assert.equal(await canManageCollectionContent(ctx.db,user,communityId),false);
    const rows=[await catalog(userCtx),await readRpc('get_shared_collection',{p_share_slug:'community'},userCtx),(await readRpc('list_collection_directory',{},userCtx)).find(c=>c.id===communityId)];
    for(const row of rows){assert.equal(row.can_contribute,true);assert.equal(row.can_edit,false);assert.equal(row.can_manage,false);assert.equal(row.can_administer,false);}
  }
  for(const id of ['other','private'])assert.equal(await canContributeCollection(ctx.db,actor,id),false);
  assert.equal(await canContributeCollection(ctx.db,null,communityId),false);
  assert.equal((await readRpc('get_shared_collection',{p_share_slug:'community'},{...ctx,actor:null})).can_contribute,false);
});

test('nonmember saves a generated question and comment, then reloads both without gaining edit rights on others',async t=>{
  const ctx=setup(t),existing=await builderRpc('create_shared_question',question('owner'),{...ctx,actor:owner});
  const before=ctx.db.sqlite.prepare('SELECT * FROM questions WHERE id=?').get(existing.question_id);
  assert.equal((await collectionCapacity({p_share_slug:'community'},ctx)).can_create_volume,false);
  const args={...question('contributor'),p_initial_comment:'検討メモ #共有'};
  const saved=await builderRpc('create_shared_question',args,ctx);
  assert.equal(saved.question_number,2);
  const [reloaded]=await readRpc('get_shared_question_detail',{p_share_slug:'community',p_question_id:saved.question_id},ctx);
  assert.equal(reloaded.created_by,actor.id);assert.equal(reloaded.payload.number,2);
  assert.equal(ctx.db.sqlite.prepare('SELECT body FROM comments WHERE id=?').get(saved.initial_comment_id).body,'検討メモ #共有');
  assert.equal((await builderRpc('create_shared_question',args,ctx)).already_exists,true);
  for(const name of ['update_shared_question','trash_question','restore_question'])await assert.rejects(questionManagementRpc(name,{p_question_id:existing.question_id,p_title:'変更',p_payload:{}},ctx),e=>e.status===403);
  for(const name of ['update_collection_details','set_collection_book_tone','create_collection_volume'])await assert.rejects(builderRpc(name,{p_share_slug:'community',p_title:'変更',p_description:'',p_book_tone:'navy'},ctx),e=>e.status===403);
  assert.deepEqual(ctx.db.sqlite.prepare('SELECT * FROM questions WHERE id=?').get(existing.question_id),before);
  await assert.rejects(builderRpc('create_shared_question',question('anonymous'),{...ctx,actor:null}),e=>e.status===401);
  await assert.rejects(builderRpc('create_shared_question',question('other','other'),ctx),e=>e.status===403);
});

test('import accepts readable sources, preserves the original and rejects hidden sources',async t=>{
  const ctx=setup(t),ownerCtx={...ctx,actor:owner};
  const visible=await builderRpc('create_shared_question',question('source','other'),ownerCtx);
  const hidden=await builderRpc('create_shared_question',question('hidden','private'),ownerCtx);
  const before=ctx.db.sqlite.prepare('SELECT * FROM questions WHERE id=?').get(visible.question_id);
  const args={p_source_question_id:visible.question_id,p_target_share_slug:'community'};
  const saved=await builderRpc('import_shared_question',args,ctx);
  assert.equal(saved.question_number,1);assert.equal((await builderRpc('import_shared_question',args,ctx)).already_exists,true);
  assert.equal((await readRpc('get_shared_question_detail',{p_share_slug:'community',p_question_id:saved.question_id},ctx))[0].created_by,actor.id);
  assert.deepEqual(ctx.db.sqlite.prepare('SELECT * FROM questions WHERE id=?').get(visible.question_id),before);
  await assert.rejects(builderRpc('import_shared_question',{...args,p_source_question_id:hidden.question_id},ctx),e=>e.status===404);
});

test('closing, unpublishing or archiving the official book disables additions in reads and writes',async t=>{
  const ctx=setup(t);
  for(const change of ["visibility='private'","visibility='request'","published_at=NULL","allow_contributions=0","archived_at='2026-09-27'"]){
    ctx.db.sqlite.prepare(`UPDATE collections SET ${change} WHERE id=?`).run(communityId);
    assert.equal(await canContributeCollection(ctx.db,actor,communityId),false,change);
    assert.notEqual((await catalog(ctx))?.can_contribute,true,change);
    await assert.rejects(builderRpc('create_shared_question',question('closed'),ctx),e=>e.status===403);
    ctx.db.sqlite.prepare("UPDATE collections SET visibility='public',published_at='2026-09-17',allow_contributions=1,archived_at=NULL WHERE id=?").run(communityId);
  }
});

test('capacity and new volumes retain addition-only access for all users',async t=>{
  const ctx=setup(t);
  const insert=ctx.db.sqlite.prepare("INSERT INTO questions(id,collection_id,created_by,sort_order,payload) VALUES(?,?,'owner',?,?)");
  for(let i=1;i<=200;i++)insert.run('old'+i,communityId,i,JSON.stringify({id:'old'+i,number:i}));
  const blocked=await builderRpc('create_shared_question',question('full'),ctx);
  assert.equal(blocked.capacity_reached,true);assert.equal(blocked.can_create_volume,false);
  const second=await builderRpc('create_collection_volume',{p_share_slug:'community'},{...ctx,actor:owner});
  const root=ctx.db.sqlite.prepare('SELECT * FROM collections WHERE id=?').get(second.series_parent_id);
  assert.equal(await canContributeCollection(ctx.db,actor,root.id),true);
  const volumes=await readRpc('get_collection_volumes',{p_share_slug:root.share_slug},ctx);
  assert.equal(volumes.length,2);for(const row of volumes){assert.equal(row.can_contribute,true);assert.equal(row.can_edit,false);}
  const saved=await builderRpc('create_shared_question',question('next',root.share_slug),ctx);
  assert.equal(saved.share_slug,second.share_slug);assert.equal(saved.question_number,201);
  assert.equal(ctx.db.sqlite.prepare('SELECT count(*) n FROM questions WHERE collection_id=?').get(communityId).n,200);
  ctx.db.sqlite.prepare("UPDATE collections SET visibility='private' WHERE id=?").run(root.id);
  assert.equal(await canContributeCollection(ctx.db,actor,second.id),false);
});

test('question image uploads honor contribution permission and remain owned by the uploader',async t=>{
  const ctx=setup(t),objects=new Map(),bytes=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1]);
  ctx.db.sqlite.prepare('INSERT INTO private_media_budget(singleton,inventory_checked_at) VALUES(1,?)').run(new Date().toISOString());
  const env={DB:ctx.db,UPLOADS_ENABLED:'true',IMAGES:{async head(key){return objects.get(key)||null;},async put(key,data,options){const object={size:data.length,customMetadata:options.customMetadata};objects.set(key,object);return object;}}};
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  const request=slug=>new Request(origin+'/v1/assets',{method:'POST',headers:{'Content-Type':'image/png','X-Asset-Bucket':'question-assets','X-Collection-Slug':slug,'X-Asset-SHA256':hash},body:bytes});
  const uploaded=await imageUpload(request('community'),env,actor);
  assert.equal(ctx.db.sqlite.prepare('SELECT owner_id FROM media_assets').get().owner_id,actor.id);
  const saved=await builderRpc('create_shared_question',{p_share_slug:'community',p_payload:{id:'image',image:uploaded.src},p_source_kind:'manual'},ctx);
  assert.ok(saved.question_id);
  await assert.rejects(imageUpload(request('other'),env,actor),e=>e.status===403);
  assert.equal(objects.size,1);
});

test('generator and import selectors include contributors without exposing edit or management controls',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const names=['editableCollectionOptionsV130','ownedCollectionOptionsV115','generatorDestinationRowsV130','currentGeneratorDestinationV130','canAddGeneratedQuestionV130','canAddQuestionV107','isCollectionEditorV100','canEditQuestionV47','canTrashQuestionV47','collectionRoleLabelV130','collectionManagementCanManageV197','renderGeneratorDestinationV130'];
  const functions=names.map(name=>{const body=html.match(new RegExp(`      function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n      \\}`))?.[0];assert.ok(body,name);return body;}).join('\n');
  const community={share_slug:'community',display_title:'みん切る共有問題集',can_contribute:true,can_edit:false,can_manage:false,can_view:true,owner_id:'owner'};
  const context=vm.createContext({supabaseSessionV46:{user:{id:actor.id}},sharedCollectionV46:{share_slug:'source'},collectionCatalogOptionsV100:()=>[community,{share_slug:'other',owner_id:'owner'}],document:{getElementById:()=>({value:'community'})},generatorDestinationV130:'community',collectionDisplayNameV101:row=>row.display_title,isCollectionManagerV47:()=>false,isQuestionAdminV47:()=>false,isSharedQuestionV47:()=>true,isQuestionOwnerV47:()=>false,generatorDestinationOptionsV130:()=>'',renderCreateHubV235:()=>'',escapeHtml:s=>s,generatorEntryV234:'global'});
  vm.runInContext(functions,context);
  assert.deepEqual(Array.from(context.generatorDestinationRowsV130(),row=>row.share_slug),['community']);
  assert.deepEqual(Array.from(context.ownedCollectionOptionsV115(),row=>row.share_slug),['community']);
  assert.equal(context.canAddGeneratedQuestionV130(),true);
  assert.match(context.renderGeneratorDestinationV130(),/ログインしたすべての利用者/);
  assert.doesNotMatch(context.renderGeneratorDestinationV130(),/編集・整理ができます/);
  context.sharedCollectionV46=community;
  assert.equal(context.canAddQuestionV107(),true);assert.equal(context.isCollectionEditorV100(),false);
  assert.equal(context.canEditQuestionV47({}),false);assert.equal(context.canTrashQuestionV47({}),false);
  assert.equal(context.collectionManagementCanManageV197(community),false);
  assert.equal(context.collectionRoleLabelV130(community),'問題を追加できます');
  context.supabaseSessionV46=null;
  assert.equal(context.canAddGeneratedQuestionV130(),false);assert.equal(context.generatorDestinationRowsV130().length,0);
});
