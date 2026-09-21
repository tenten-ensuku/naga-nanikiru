import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../public/standard-reactions-v329.js',import.meta.url),'utf8');
const base=[{id:'hard',storageKey:'difficult',label:'ムズい',icon:'😥',tone:'blue'},{id:'like',storageKey:'like',label:'いいね！',icon:'👍',tone:'gold'}];
const api=()=>{const ctx=vm.createContext({crypto:{randomUUID:()=> 'f'.repeat(32)}});vm.runInContext(source,ctx);return ctx.MinkiruStandardReactionsV329;};
const rows=()=>base.map(item=>({key:item.storageKey,label:item.label,icon:item.icon,tone:item.tone,iconType:'emoji',hidden:false}));
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function dom(){
  const slots=new Map(),listeners={};
  const node={isConnected:true,innerHTML:'',querySelector(selector){if(!slots.has(selector))slots.set(selector,{innerHTML:'',textContent:'',disabled:false,focus(){},select(){}});return slots.get(selector);},addEventListener(type,fn){listeners[type]=fn;},remove(){this.isConnected=false;},replaceChildren(){this.innerHTML='';}};
  const root={querySelector:()=>node};
  return {node,root,click:async(data={})=>listeners.click({target:{closest:()=>({dataset:data,hasAttribute:name=>name in data})}}),input:(field,value)=>listeners.input({target:{dataset:{standardField:field},value,checked:value}}),changePosition:n=>listeners.change({target:{matches:()=>true,value:n}})};
}
test('merged order and labels keep stable IDs and hidden entries for existing counts and history',()=>{
  const edited=rows().reverse();edited[1].label='難しい';edited[1].hidden=true;edited.push({key:'standard_'+'f'.repeat(32),label:'追加',icon:'🔎',tone:'gold'});
  const merged=api().merge(base,edited);assert.deepEqual(Array.from(merged,item=>item.id),['like','hard','standard_'+'f'.repeat(32)]);
  assert.equal(merged[1].storageKey,'difficult');assert.equal(merged[1].label,'難しい');assert.equal(merged[1].hidden,true);
  assert.equal(api().merge(base,[{key:'<script>',label:'x',icon:'x'}]).length,2);
});
test('ordinary users can read the shared catalog but never receive the editor',async()=>{
  for(const isAdmin of [false,undefined,'true']){
    let reads=0;const ui=api().create({base,session:()=>({userId:'member',isAdmin}),load:async()=>{reads++;return {revision:1,rows:rows().reverse()};}});
    assert.equal(ui.markup(),'');await ui.refresh();assert.equal(reads,1);assert.equal(ui.definitions()[0].id,'like');
    const d=dom();ui.bind(d.root);assert.equal(d.node.isConnected,false);
  }
});
test('failed loads use bundled defaults and late responses cannot cross logout',async()=>{
  let user={userId:'one',isAdmin:true},resolve;
  const ui=api().create({base,session:()=>user,load:()=>new Promise(done=>resolve=done)});
  const task=ui.refresh();user={userId:'',isAdmin:false};resolve({revision:1,rows:rows().reverse()});await task;
  assert.equal(ui.definitions()[0].id,'hard');assert.equal(ui.markup(),'');
  const offline=api().create({base,session:()=>({userId:'x'}),load:async()=>{throw Error('offline');}});
  assert.equal(await offline.refresh(),false);assert.equal(offline.definitions()[0].id,'hard');
});
test('editing, reordering and adding stay in a draft until save and survive fresh reads',async()=>{
  let saved={revision:0,rows:[]},calls=0;
  const make=()=>api().create({base,session:()=>({userId:'admin',isAdmin:true}),load:async()=>saved,save:async(items,revision)=>{calls++;assert.equal(revision,saved.revision);saved={revision:revision+1,rows:items};return saved;}});
  const ui=make(),d=dom();await ui.refresh();ui.bind(d.root);
  d.input('label','<検証>');assert.equal(ui.definitions()[0].label,'ムズい');assert.match(d.node.querySelector('[data-standard-grid]').innerHTML,/&lt;検証&gt;/);
  await d.click({standardMove:'1'});assert.equal(calls,0);
  await d.click({'data-standard-add':true});d.input('label','追加');
  await d.click({'data-standard-save':true});assert.equal(calls,1);assert.equal(saved.rows[1].label,'<検証>');assert.equal(saved.rows[2].label,'追加');
  const next=make();await next.refresh();assert.equal(next.definitions()[1].label,'<検証>');assert.equal(next.definitions().length,3);
});
test('failed saves preserve drafts and restore resets the selected base text',async()=>{
  const d=dom(),ui=api().create({base,session:()=>({userId:'admin',isAdmin:true}),load:async()=>({revision:0,rows:[]}),save:async()=>{throw Error('offline');}});
  await ui.refresh();ui.bind(d.root);d.input('label','変更');await d.click({'data-standard-save':true});
  assert.match(d.node.innerHTML,/value="変更"/);assert.equal(d.node.querySelector('[data-standard-status]').textContent,'offline');
  await d.click({'data-standard-restore':true});assert.match(d.node.innerHTML,/value="ムズい"/);
});
test('a refresh while editing keeps the original revision so stale changes cannot silently overwrite',async()=>{
  let saved={revision:1,rows:rows()},sentRevision;
  const ui=api().create({base,session:()=>({userId:'admin',isAdmin:true}),load:async()=>saved,save:async(_rows,revision)=>{sentRevision=revision;throw Error('conflict');}}),d=dom();
  await ui.refresh();ui.bind(d.root);d.input('label','draft');saved={revision:2,rows:rows().reverse()};await ui.refresh({force:true});
  assert.match(d.node.innerHTML,/value="draft"/);await d.click({'data-standard-save':true});assert.equal(sentRevision,1);
  assert.match(d.node.innerHTML,/value="draft"/);
});
