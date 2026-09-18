import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/collection-deletion-v244.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/collection-deletion-v244.css',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
class Element {
  constructor(){this.listeners={};this.dataset={};this.attributes={};this.isConnected=false;this.disabled=false;this.children={};}
  addEventListener(type,cb){(this.listeners[type]??=[]).push(cb);}
  async fire(type){if(type==='click'&&this.disabled)return;for(const fn of this.listeners[type]||[])await fn({preventDefault(){},target:this});}
  setAttribute(key,value){this.attributes[key]=value;}
  removeAttribute(key){delete this.attributes[key];}
  querySelector(key){return this.children[key]??=new Element();}
  showModal(){this.open=true;}
  close(){this.open=false;void this.fire('close');}
  remove(){this.isConnected=false;}
  focus(){this.focused=true;}
}
function fixture(){
  const doc={body:{append(e){e.isConnected=true;}},createElement(){doc.dialog=new Element();return doc.dialog;},querySelector(){return null;}};
  const context={document:doc};vm.runInNewContext(source,context);
  const calls=[],done=[];let actor='owner';
  const preview={title:'<img src=x onerror=bad()>',share_slug:'book',question_count:3,child_count:0,collection_count:1,is_volume:false,confirmation_token:'a'.repeat(64)};
  const options={target:{title:'本',share_slug:'book'},getActor:()=>actor,api:{previewCollectionDeletion:async()=>preview,deleteCollection:async(...args)=>{calls.push(args);return {deleted:true};}},onDeleted:x=>done.push(x)};
  return {doc,api:context.MinkiruCollectionDeletionV244,preview,options,calls,done,setActor:v=>{actor=v;},node:key=>doc.dialog.querySelector(key)};
}
test('deletion requires separate confirmation; exact title is text, not injected markup',async()=>{
  const f=fixture();await f.api.open(f.options);assert.equal(f.calls.length,0);assert.equal(f.node('.book-delete-name-v244').textContent,f.preview.title);
  assert.match(f.node('#bookDeleteDescriptionV244').textContent,/3問.*共有している利用者/);assert.equal(f.node('[data-delete-cancel]').focused,true);
  await f.node('[data-delete-confirm]').fire('click');assert.deepEqual(f.calls,[['book','a'.repeat(64)]]);assert.equal(f.done.length,1);assert.equal(f.doc.dialog.isConnected,false);
});
test('cancel before or after preview performs no deletion and cannot reopen from late responses',async()=>{
  for(const pending of [false,true]){const f=fixture(),wait=deferred();if(pending)f.options.api.previewCollectionDeletion=()=>wait.promise;const opening=f.api.open(f.options);await f.node('[data-delete-cancel]').fire('click');if(pending)wait.resolve(f.preview);await opening;assert.equal(f.calls.length,0);assert.equal(f.doc.dialog.isConnected,false);}
});
test('missing/failed/mismatched previews leave destructive action disabled',async()=>{
  for(const bad of [null,{share_slug:'other'},{...fixture().preview,question_count:-1}]){const f=fixture();f.options.api.previewCollectionDeletion=async()=>bad;await f.api.open(f.options);assert.equal(f.node('[data-delete-confirm]').disabled,true);assert.match(f.node('#bookDeleteDescriptionV244').textContent,/削除は行われていません/);assert.equal(f.calls.length,0);}
});
test('duplicate confirmation clicks send once; failures preserve target and allow explicit retry',async()=>{
  const f=fixture(),wait=deferred();f.options.api.deleteCollection=async()=>{f.calls.push('delete');return wait.promise;};await f.api.open(f.options);
  const running=f.node('[data-delete-confirm]').fire('click');await f.node('[data-delete-confirm]').fire('click');assert.equal(f.calls.length,1);assert.equal(f.node('[data-delete-cancel]').disabled,true);
  wait.reject(new Error('接続エラー'));await running;assert.equal(f.node('[data-delete-confirm]').disabled,false);assert.equal(f.doc.dialog.isConnected,true);assert.equal(f.done.length,0);assert.match(f.node('.book-delete-status-v244').textContent,/接続エラー/);
});
test('account switches before confirmation and during a request cannot affect the new account',async()=>{
  const f=fixture();await f.api.open(f.options);f.setActor('other');await f.node('[data-delete-confirm]').fire('click');assert.equal(f.calls.length,0);assert.equal(f.node('[data-delete-confirm]').disabled,true);
  const g=fixture(),wait=deferred();g.options.api.deleteCollection=()=>wait.promise;await g.api.open(g.options);const running=g.node('[data-delete-confirm]').fire('click');g.setActor('other');wait.resolve({deleted:true});await running;assert.equal(g.done.length,0);
});
test('confirmation distinguishes one volume from a complete series',async()=>{
  const f=fixture();f.preview.is_volume=true;await f.api.open(f.options);assert.match(f.node('#bookDeleteDescriptionV244').textContent,/他の巻は削除しません/);
  const g=fixture();g.preview.child_count=2;g.preview.collection_count=3;await g.api.open(g.options);assert.match(g.node('#bookDeleteDescriptionV244').textContent,/シリーズと含まれる2冊/);
});
test('management exposes deletion only to owners/admins, and returns to a fresh shelf on success',()=>{
  assert.match(source,/>削除<\/button>/);assert.doesNotMatch(source,/ゴミ箱|fetch\(|setInterval/);
  assert.match(html,/const deletion = canAdminister && collection \? window\.MinkiruCollectionDeletionV244\.markup\(\) : ""/);
  assert.match(html,/if \(deletionTarget && collectionManagementCanAdministerV290\(deletionTarget\)\)/);
  assert.match(html,/rememberCollectionSlugV165\(""\);[\s\S]*url.searchParams.set\("view", "collections"\)/);
  assert.match(css,/min-height:44px/);assert.match(css,/max-height:calc\(100dvh - 32px\)/);assert.match(css,/overflow-wrap:anywhere/);assert.match(css,/:focus-visible/);
});
