import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as tags from '../public/comment-tags-v270.mjs';
const source=readFileSync(new URL('../public/comment-composer-v324.js',import.meta.url),'utf8');
function setup(storage=new Map()){
  const ctx=vm.createContext({Event,innerWidth:1280,innerHeight:900,addEventListener(){},MinkiruCommentTagsV270:tags,nagaCurrentUserIdV75:'alice',
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

test('completed draft hashtags are reusable without posting, but partial names are not learned',()=>{
  const {api,storage}=setup();
  for (const text of ['＃','＃ピ','＃ピエール']) api.rememberDraft(text,text.length);
  assert.deepEqual(Array.from(api.recent()),[]);
  api.rememberDraft('＃ピエール　',6);
  assert.deepEqual(Array.from(api.recent()),['ピエール']);
  api.rememberDraft('＃ピエール　＃復習',9);
  assert.deepEqual(Array.from(api.recent()),['ピエール']);
  api.rememberDraft('＃ピエール　＃復習\n',10);
  const reloaded=setup(storage).api;
  assert.deepEqual(Array.from(reloaded.candidates(reloaded.recent(),'ピ')),['ピエール']);
  assert.deepEqual(Array.from(reloaded.recent()),['復習','ピエール']);
  api.rememberDraft('https://example.test/#未登録 ',26);
  assert.equal(api.recent().includes('未登録'),false);
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

function bindEditor(api) {
  class Node extends EventTarget {
    children=[];dataset={};attrs=new Map();style={};scrollHeight=264;
    setAttribute(key,value){this.attrs.set(key,value);}
    removeAttribute(key){this.attrs.delete(key);}
    contains(node){return node===this || this.children.includes(node);}
    replaceChildren(){this.children=[];}
    append(node){this.children.push(node);}
    querySelector(){return null;}
    scrollIntoView(){}
    getBoundingClientRect(){return {left:100,top:400,bottom:548,width:300};}
  }
  const document=new EventTarget(),input=new Node(),field=new Node();let panel;
  document.createElement=()=>new Node();document.activeElement=input;
  Object.assign(input,{ownerDocument:document,isConnected:true,value:'',selectionStart:0,selectionEnd:0});
  input.closest=()=>field;field.after=node=>{panel=node;};
  input.focus=()=>{document.activeElement=input;};
  input.setRangeText=(text,start,end)=>{input.value=input.value.slice(0,start)+text+input.value.slice(end);};
  input.setSelectionRange=(start,end)=>{input.selectionStart=start;input.selectionEnd=end;};
  api.bind(input);
  const event=(type,props={})=>{const e=new Event(type,{cancelable:true});Object.assign(e,props);input.dispatchEvent(e);return e;};
  const type=(value,start=value.length,end=start)=>{
    Object.assign(input,{value,selectionStart:start,selectionEnd:end});event('input');
  };
  return {input,panel,event,type};
}

test('IME preedit shows candidates immediately, keeps IME keys untouched, and resumes after repeated composition',()=>{
  for(const selected of [false,true]){
    const {api}=setup();const {input,panel,event,type}=bindEditor(api);
    type('');event('compositionstart');type('＃',selected?0:1,1);
    assert.equal(panel.hidden,false,'candidates must open before compositionend');
    assert.equal(panel.children.length,5);
    for(const key of ['Enter','ArrowDown','ArrowUp','Escape']){
      assert.equal(event('keydown',{key,isComposing:true,keyCode:229}).defaultPrevented,false);
    }
    assert.equal(input.value,'＃');
    type('＃ピエール');assert.deepEqual(Array.from(api.recent()),[]);
    event('compositionend');type('＃ピエール　');
    type('＃');assert.equal(panel.children[0].attrs.get('aria-label'),'#ピエール');
    event('compositionstart');type('＃',0,1);
    assert.equal(panel.hidden,false);assert.equal(panel.children[0].attrs.get('aria-label'),'#ピエール');
    event('compositionend');
    type('https://example.test/#押');assert.equal(panel.hidden,true);
    type('#');event('keydown',{key:'Escape'});assert.equal(panel.hidden,true);
    type('＃');assert.equal(panel.hidden,false);
  }
});

test('the suggestion popup sits above the editor and stays inside the visible viewport',()=>{
  const {api}=setup();
  const wide=api.popupPosition({left:100,top:600,bottom:750,width:600},{left:0,top:0,width:1280,height:900},280);
  assert.equal(wide.placement,'above');assert.equal(wide.width,380);assert.equal(wide.top+wide.height,594);
  const mobile=api.popupPosition({left:300,top:300,bottom:448,width:260},{left:12,top:50,width:320,height:400},600);
  assert.equal(mobile.placement,'above');assert.ok(mobile.left>=20);assert.ok(mobile.left+mobile.width<=324);
  assert.ok(mobile.top>=58);assert.ok(mobile.top+mobile.height<300);
  const nearTop=api.popupPosition({left:10,top:30,bottom:170,width:300},{left:0,top:0,width:320,height:600},260);
  assert.equal(nearTop.placement,'below');assert.equal(nearTop.top,176);assert.ok(nearTop.top+nearTop.height<=592);
});

test('the first candidate is active immediately, with Enter and Tab completion and arrow navigation',()=>{
  for(const key of ['Enter','Tab']){
    const {api}=setup();api.remember('＃ピエール');
    const {input,panel,event,type}=bindEditor(api);type('＃');
    assert.equal(panel.children[0].attrs.get('aria-selected'),'true');
    assert.equal(panel.dataset.placement,'above');
    assert.equal(event('keydown',{key}).defaultPrevented,true);assert.equal(input.value,'#ピエール ');
    assert.equal(panel.hidden,true);
    type('#');event('keydown',{key:'ArrowDown'});assert.equal(panel.children[1].attrs.get('aria-selected'),'true');
    event('keydown',{key:'ArrowUp'});assert.equal(panel.children[0].attrs.get('aria-selected'),'true');
    assert.equal(event('keydown',{key:'Tab',shiftKey:true}).defaultPrevented,false);
  }
});
