import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {boardRenderer as renderer} from '../scripts/naga-board-runtime.mjs';
const source=fs.readFileSync(new URL('../public/dora-sheen-v333.js',import.meta.url),'utf8');
const fixture=number=>JSON.parse(fs.readFileSync(new URL(`fixtures/json-board-v248/${number}.json`,import.meta.url),'utf8'));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

function browser({account='alice',values=new Map(),api}={}){
  const events={},nodes={doraSheenToggleV333:{},doraSheenStatusV333:{},doraSheenRetryV333:{}};
  const document={documentElement:{dataset:{}},visibilityState:'visible',getElementById:id=>nodes[id],querySelectorAll:()=>[],addEventListener:(type,fn)=>{events[type]=fn;}};
  const window={document,localStorage:{getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)}};
  vm.runInNewContext(source,{window});
  const controller=window.MinkiruDoraSheenV333.create({api:()=>api,userId:()=>account});
  return {controller,nodes,document,events,values,account(id){account=id;return controller.accountChanged();}};
}

test('actual dora wraps each suit, winds and dragons independently and normalizes red markers',()=>{
  assert.deepEqual(renderer.doraTiles(['man9','pin4','sou9','ji4','ji7','aka1','ji5','ji6']),['man1','pin5','sou1','ji1','ji5','man6','ji6','ji7']);
  for(const tile of ['aka1','aka2','aka3'])assert.equal(renderer.isDora(tile,[]),true);
  assert.equal(renderer.isDora('pin5',['pin4','ji1']),true);
  assert.equal(renderer.isDora('man5',['pin4']),false);
  assert.equal(renderer.isDora('man5',[undefined,'bad']),false);
  assert.equal(renderer.isDora(null,[]),false);
});
test('board sheen matches only own visible tiles, preserves backs and keeps SVG IDs unique across previews',()=>{
  for(const number of [1603,47,50,16,55,38,97]){
    const {scene}=fixture(number),before=JSON.stringify(scene),svg=renderer.markup(scene);
    const visibleMelds=scene.players[0].melds.flatMap(m=>m.type==='ankan'?m.consumed.slice(1,3):[m.pai,...m.consumed,...(m.added?[m.added]:[])]);
    const expected=[...scene.hand.tiles,scene.hand.draw,...visibleMelds].filter(t=>t&&renderer.isDora(t,scene.doraIndicators));
    const actual=[...svg.matchAll(/data-dora-tile-v333="([^"]+)"/g)].map(m=>m[1]);
    assert.deepEqual(actual.sort(),expected.sort(),String(number));
    assert.equal((renderer.markup(scene,{showHand:false}).match(/data-dora-tile-v333/g)||[]).length,visibleMelds.filter(t=>renderer.isDora(t,scene.doraIndicators)).length);
    assert.equal(JSON.stringify(scene),before);
    const second=renderer.markup(scene),id=svg.match(/linearGradient id="([^"]+)"/)[1];
    assert.ok(!second.includes(`id="${id}"`));
  }
});
test('toggle immediately applies, saves once, and another client reloads the account preference',async()=>{
  let saved=true,calls=0;const write=deferred();
  const api={async getDisplayPreferences(){return {dora_sheen:saved};},async saveDisplayPreferences(value){calls++;await write.promise;saved=value;return {dora_sheen:value};}};
  const b=browser({api});await b.controller.bindSettings();assert.equal(b.nodes.doraSheenToggleV333.checked,true);
  const pending=b.controller.setEnabled(false);assert.equal(b.document.documentElement.dataset.doraSheen,'off');assert.equal(b.nodes.doraSheenToggleV333.disabled,true);
  await b.controller.setEnabled(true);assert.equal(calls,1);
  write.resolve();await pending;assert.equal(b.nodes.doraSheenToggleV333.disabled,false);assert.match(b.nodes.doraSheenStatusV333.textContent,/保存しました/);
  const second=browser({api});await second.controller.accountChanged();assert.equal(second.nodes.doraSheenToggleV333.checked,false);
  assert.equal(b.values.get('minkiru:dora-sheen:v1:alice'),'off');
});
test('a failed write rolls back without publishing an unsaved cache value',async()=>{
  const b=browser({api:{async getDisplayPreferences(){return {dora_sheen:false};},async saveDisplayPreferences(){throw Error('offline');}}});
  await b.controller.accountChanged();await b.controller.setEnabled(true);
  assert.equal(b.document.documentElement.dataset.doraSheen,'off');assert.match(b.nodes.doraSheenStatusV333.textContent,/元の設定に戻しました/);
  assert.equal(b.values.get('minkiru:dora-sheen:v1:alice'),'off');
});
test('late reads and writes cannot leak between accounts, including an account returning during a request',async()=>{
  const read=deferred(),write=deferred();let reads=0;
  const b=browser({api:{getDisplayPreferences(){return ++reads===1?read.promise:Promise.resolve({dora_sheen:true});},saveDisplayPreferences(){return write.promise;}}});
  const initial=b.controller.accountChanged();await Promise.resolve();await b.account('bob');read.resolve({dora_sheen:false});await initial;
  assert.equal(b.nodes.doraSheenToggleV333.checked,true);assert.equal(b.values.has('minkiru:dora-sheen:v1:alice'),false);
  const old=b.controller.setEnabled(false);await b.account('alice');await b.account('bob');write.resolve({dora_sheen:false});await old;
  assert.equal(b.nodes.doraSheenToggleV333.checked,true);assert.equal(b.values.get('minkiru:dora-sheen:v1:bob'),'on');
});
test('resuming reads the newest setting once, hidden tabs pause and synchronous failures remain retryable',async()=>{
  let saved=true,calls=0,fail=true;
  const b=browser({api:{getDisplayPreferences(){calls++;if(fail)throw Error('unavailable');return Promise.resolve({dora_sheen:saved});}}});
  await b.controller.accountChanged();assert.match(b.nodes.doraSheenStatusV333.textContent,/読み込めません/);assert.equal(b.nodes.doraSheenToggleV333.disabled,true);
  fail=false;await b.controller.refresh();assert.equal(b.nodes.doraSheenToggleV333.disabled,false);
  b.document.visibilityState='hidden';b.events.visibilitychange();assert.equal(b.document.documentElement.dataset.doraSheenSuspended,'true');
  saved=false;b.document.visibilityState='visible';b.events.visibilitychange();await b.controller.refresh();assert.equal(calls,3);
  assert.equal(b.nodes.doraSheenToggleV333.checked,false);assert.equal(b.document.documentElement.dataset.doraSheenSuspended,'false');
});
