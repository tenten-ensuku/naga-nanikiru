import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {testD1} from './helpers/cloudflare-d1.mjs';
import {readRpc} from '../cloudflare/read-api.mjs';
import worker from '../cloudflare/worker.mjs';
import {sha256} from '../cloudflare/auth.mjs';
const rpc='get_collection_admin_info';
function setup(t){
  const db=testD1();t.after(()=>db.close());
  for(const [i,id] of ['admin','owner','manager','editor','viewer','revoked','disabled'].entries()){
    db.sqlite.prepare('INSERT INTO profiles(id,display_name) VALUES(?,?)').run(id,id);
    db.sqlite.prepare('INSERT INTO auth_identities(user_id,discord_user_id,is_admin,disabled) VALUES(?,?,?,?)').run(id,'11111111111111111'+i,Number(id==='admin'),Number(id==='disabled'));
  }
  db.sqlite.exec(`INSERT INTO collections(id,owner_id,title,share_slug,visibility,published_at) VALUES
    ('book','owner','private book','book','private',NULL),('other','viewer','public book','other','public','2026-09-21'),('draft','owner','draft book','draft','public',NULL);
    INSERT INTO collection_managers(collection_id,user_id,status) VALUES('book','manager','active'),('book','disabled','active'),('book','revoked','revoked');
    INSERT INTO collection_members(collection_id,user_id,role,status) VALUES('book','editor','editor','active'),('book','manager','editor','active'),('book','viewer','viewer','active'),('book','revoked','editor','revoked');`);
  return {db,actor:{id:'admin',is_admin:true}};
}
test('admin metadata rejects anonymous, ordinary owners, managers and forged flags before reading collections',async()=>{
  const db={prepare(){throw Error('unauthorized collection read');}};
  for(const actor of [null,{id:'owner'},{id:'manager'},{id:'viewer'},{id:'admin',is_admin:1}]){
    await assert.rejects(readRpc(rpc,{p_share_slug:'book',is_admin:true,actor:{id:'admin',is_admin:true}},{db,actor}),e=>e.status===(actor?403:401));
  }
});
test('admin sees only the selected book, active assigned roles, and no extra identity data or writes',async t=>{
  const ctx=setup(t),before=ctx.db.sqlite.prepare('SELECT * FROM collection_members').all();
  const book=await readRpc(rpc,{p_share_slug:'book'},ctx);
  assert.equal(book.visibility,'private');assert.equal(book.owner.display_name,'owner');
  assert.deepEqual(book.managers,[{display_name:'disabled',disabled:true},{display_name:'manager',disabled:false}]);
  assert.deepEqual(book.editors,[{display_name:'editor',disabled:false}]);
  assert.equal(JSON.stringify(book).includes('111111'),false);
  const other=await readRpc(rpc,{p_share_slug:'other'},ctx);
  assert.equal(other.owner.display_name,'viewer');assert.equal(other.visibility,'public');assert.deepEqual(other.managers,[]);
  assert.equal((await readRpc(rpc,{p_share_slug:'draft'},ctx)).published,false);
  assert.deepEqual(ctx.db.sqlite.prepare('SELECT * FROM collection_members').all(),before);
  ctx.db.sqlite.exec("UPDATE collection_managers SET status='revoked' WHERE user_id='manager'");
  const changed=await readRpc(rpc,{p_share_slug:'book'},ctx);
  assert.equal(changed.managers.some(p=>p.display_name==='manager'),false);
  assert.equal(changed.editors.some(p=>p.display_name==='manager'),true);
  ctx.db.sqlite.exec("UPDATE collections SET archived_at='2026-09-21' WHERE id='book'");
  await assert.rejects(readRpc(rpc,{p_share_slug:'book'},ctx),e=>e.status===404);
  await assert.rejects(readRpc(rpc,{p_share_slug:[]},ctx),e=>e.status===400);
});
test('HTTP uses authenticated administrator rights and prevents ordinary users from retrieving the metadata',async t=>{
  const {db}=setup(t),token='a'.repeat(64),csrf='b'.repeat(64),origin='https://fixture.test';
  db.sqlite.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?,?)').run(await sha256(token),'owner',await sha256(csrf),Math.floor(Date.now()/1000)+3600,0);
  const env={DB:db,APP_ORIGIN:origin,CUTOVER_READY:'true',DISCORD_CLIENT_ID:'111111111111111111',DISCORD_CLIENT_SECRET:'fixture-only'};
  const request=(headers={})=>new Request(origin+'/api/rpc/'+rpc,{method:'POST',headers:{Cookie:'__Host-minkiru_session='+token,Origin:origin,'X-Minkiru-CSRF':csrf,'Content-Type':'application/json',...headers},body:JSON.stringify({p_share_slug:'book',is_admin:true})});
  assert.equal((await worker.fetch(request({Cookie:''}),env)).status,401);
  assert.equal((await worker.fetch(request(),env)).status,403);
  db.sqlite.exec("UPDATE auth_sessions SET user_id='admin'");
  const response=await worker.fetch(request(),env);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal((await response.json()).data.owner.display_name,'owner');
  assert.equal((await worker.fetch(request({'X-Minkiru-CSRF':'invalid'}),env)).status,403);
  db.sqlite.exec("UPDATE auth_identities SET is_admin=0 WHERE user_id='admin'");
  assert.equal((await worker.fetch(request(),env)).status,403);
});
const uiSource=fs.readFileSync(new URL('../public/collection-admin-v328.js',import.meta.url),'utf8');
const api=()=>{const ctx=vm.createContext({});vm.runInContext(uiSource,ctx);return ctx.MinkiruCollectionAdminV328;};
const info=(slug='book')=>({share_slug:slug,visibility:'private',published:false,owner:{display_name:'作成者'},managers:[{display_name:'<script>管理</script>'}],editors:[]});
function dom(slug='book',user='admin'){
  const node={dataset:{collectionAdminV328:slug,adminUser:user},isConnected:true,innerHTML:'',addEventListener(_type,fn){this.click=fn;},remove(){this.isConnected=false;this.innerHTML='';}};
  return {node,root:{querySelector:()=>node}};
}
test('UI is absent and performs no reads for non-admin users including collection owners',async()=>{
  for(const isAdmin of [false,undefined,'true']){
    let calls=0;const ui=api().create({session:()=>({userId:'owner',isAdmin}),load:()=>{calls++;return info();}});
    assert.equal(ui.markup({slug:'book',fullTitle:'本'}),'');
    const {root,node}=dom('book','owner');await ui.bind(root);assert.equal(calls,0);assert.equal(node.isConnected,false);
  }
});
test('UI escapes labels, deduplicates reads and refreshes after management changes',async()=>{
  let calls=0;const ui=api().create({session:()=>({userId:'admin',isAdmin:true}),load:async()=>{calls++;return info();}}),{node,root}=dom();
  assert.match(ui.markup({slug:'book',fullTitle:'<本>'}),/&lt;本&gt;/);
  await Promise.all([ui.bind(root),ui.bind(root)]);assert.equal(calls,1);assert.match(node.innerHTML,/&lt;script&gt;管理/);assert.doesNotMatch(node.innerHTML,/<script>/);
  ui.clear();await ui.bind(root);assert.equal(calls,2);
});
test('late results cannot cross books or a sign-out and failed reads require an explicit retry',async()=>{
  let resolve,user={userId:'admin',isAdmin:true};
  const ui=api().create({session:()=>user,load:()=>new Promise(done=>resolve=done)}),{node,root}=dom();
  const pending=ui.bind(root);await Promise.resolve();node.isConnected=false;user={userId:'other',isAdmin:false};resolve(info());await pending;
  assert.doesNotMatch(node.innerHTML,/作成者<\/dt>/);assert.equal(ui.markup({slug:'book',fullTitle:'本'}),'');
  let calls=0;const retry=api().create({session:()=>({userId:'admin',isAdmin:true}),load:async()=>{if(++calls===1)throw Error('offline');return info();}}),next=dom();
  await retry.bind(next.root);await retry.bind(next.root);assert.equal(calls,1);assert.match(next.node.innerHTML,/再読み込み/);
  next.node.click({target:{closest:()=>true}});await new Promise(done=>setImmediate(done));assert.equal(calls,2);assert.match(next.node.innerHTML,/作成者<\/dt>/);
});
test('visibility distinguishes unpublished public books and the supported scopes',()=>{
  const {visibility}=api();
  assert.equal(visibility({visibility:'public',published:false}),'未公開（設定：全体公開）');
  assert.equal(visibility({visibility:'request',published:true}),'承認許可制');
  assert.equal(visibility({visibility:'private',published:false}),'プライベート');
  assert.equal(visibility({visibility:'limited',published:true}),'限定公開');
  assert.equal(visibility({visibility:'workspace',published:true,workspace_name:'講座'}),'ワークスペース内（講座）');
});
test('retry follows the newly selected book when the shelf reuses a details node',async()=>{
  let calls=[];
  const ui=api().create({session:()=>({userId:'admin',isAdmin:true}),load:async slug=>{calls.push(slug);if(slug==='other' && calls.length===2)throw Error('offline');return info(slug);}});
  const {root,node}=dom();await ui.bind(root);
  node.dataset.collectionAdminV328='other';await ui.bind(root);assert.match(node.innerHTML,/再読み込み/);
  node.click({target:{closest:()=>true}});await new Promise(done=>setImmediate(done));
  assert.deepEqual(calls,['book','other','other']);assert.doesNotMatch(node.innerHTML,/再読み込み/);
});
