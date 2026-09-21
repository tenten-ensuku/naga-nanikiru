import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as tags from '../public/comment-tags-v270.mjs';
const source=readFileSync(new URL('../public/comment-composer-v324.js',import.meta.url),'utf8');
function setup(storage=new Map()){
  const ctx=vm.createContext({MinkiruCommentTagsV270:tags,nagaCurrentUserIdV75:'alice',
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}});
  vm.runInContext(source,ctx);return{ctx,api:ctx.MinkiruCommentComposerV324,storage};
}
test('hashtags activate only at the caret, accept fullwidth input and exclude normal text and URL fragments',()=>{
  const {api}=setup();
  for(const text of ['#','＃','説明：#押','🙂 #安全','\n＃ＮＡＮＡ']) {
    const token=api.tokenAtCaret(text,text.length);assert.ok(token,text);assert.ok(token.from>=0);assert.equal(token.to,text.length);
  }
  for(const text of ['発展の発','最中','押し引き','https://example.test/#押','https://example.test/path＃','foo#押','#'+'長'.repeat(31),'##']) assert.equal(api.tokenAtCaret(text,text.length),null,text);
  assert.equal(api.tokenAtCaret('#押',0,2),null);
  assert.equal(api.tokenAtCaret('＃ＮＡＮＡ',5).query,'NANA');
});
test('tag completion replaces only the active token and preserves following content and length limits',()=>{
  const {api}=setup(),text='🙂 メモ #押し引き 続き 7z',caret=text.indexOf('し');
  const token=api.tokenAtCaret(text,caret),edit=api.completion(text,token,'押し引き',2000);
  assert.equal(edit.value,text);assert.equal(edit.caret,text.indexOf(' 続き'));
  assert.equal(api.completion('#基',api.tokenAtCaret('#基',2),'基本序列',2000).value,'#基本序列 ');
  assert.equal(api.completion('#',api.tokenAtCaret('#',1),'基本序列',4),null);
  assert.equal(api.completion('#',api.tokenAtCaret('#',1),'<img>',2000),null);
});
test('first-time suggestions show five presets, then recent custom tags take priority without duplicates',()=>{
  const {api}=setup();
  assert.deepEqual(Array.from(api.candidates([],'')),tags.TAGS);
  api.remember('メモ #自分の復習');api.remember('#押し引き');api.remember('＃自分の復習');
  assert.deepEqual(Array.from(api.candidates(api.recent(),'')).slice(0,3),['自分の復習','押し引き','基本序列']);
  assert.equal(new Set(api.candidates(api.recent(),'')).size,6);
  assert.deepEqual(Array.from(api.candidates(api.recent(),'自')),['自分の復習']);
  assert.deepEqual(Array.from(api.candidates(api.recent(),'存在しない')),[]);
});
test('recent tags persist across editor reloads, stay account-scoped and tolerate unavailable storage',()=>{
  const {ctx,api,storage}=setup();api.remember('#自分');
  assert.deepEqual(Array.from(setup(storage).api.recent()),['自分']);
  ctx.nagaCurrentUserIdV75='bob';assert.deepEqual(Array.from(api.recent()),[]);api.remember('#別人');
  ctx.nagaCurrentUserIdV75='alice';assert.deepEqual(Array.from(api.recent()),['自分']);
  ctx.localStorage.getItem=()=>{throw Error('disabled');};ctx.localStorage.setItem=()=>{throw Error('disabled');};
  api.remember('#追加');assert.deepEqual(Array.from(api.recent()),['追加','自分']);
  ctx.nagaCurrentUserIdV75='';api.remember('#ログアウト');assert.deepEqual(Array.from(api.recent()),[]);
});
test('invalid stored tags cannot become markup or unbounded suggestions',()=>{
  const {api}=setup();
  assert.deepEqual(Array.from(api.normalizeRecent(['<script>','タグ with spaces',null,'＃ＮＡＮＡ','NANA'])),['NANA']);
  assert.equal(api.normalizeRecent(Array.from({length:100},(_,i)=>'タグ'+i)).length,64);
});
