import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const html=read('public/index.html'),js=read('public/question-header-v250.js'),css=read('public/question-header-v250.css');

function fixture(){
  class Element {
    constructor(){this.listeners={};this.attrs={};this.open=false;this.children=[];this.focused=false;}
    addEventListener(name,fn,capture){this.listeners[name]={fn,capture};}
    fire(name,event){this.listeners[name]?.fn(event);}
    contains(target){return this===target||this.children.includes(target);}
    setAttribute(name,value){this.attrs[name]=value;}
    focus(){this.focused=true;}
  }
  const doc=new Element(),more=new Element(),summary=new Element(),panel=new Element(),outside=new Element();
  const ids={questionMoreV250:more,questionTitleNumberV250:new Element(),questionTitleTypeV250:new Element(),questionPageTitle:new Element()};
  doc.getElementById=id=>ids[id];
  more.querySelector=selector=>selector==='summary'?summary:panel;
  more.children=[summary,panel];
  const ctx=vm.createContext({window:{}});vm.runInContext(js,ctx);
  return {api:ctx.window.MinkiruQuestionHeaderV250.create(doc),doc,more,summary,panel,outside,ids};
}

test('one native question selector lives in the title, not the secondary toolbar',()=>{
  const title=html.match(/<h1 id="questionPageTitle"[^]*?<\/h1>/)?.[0];
  const toolbar=html.match(/<div class="source-bar">[^]*?<div class="session-strip"/)?.[0];
  assert.match(title,/id="questionSelect" aria-label="問題を選ぶ"/);
  assert.equal((html.match(/id="questionSelect"/g)||[]).length,1);
  assert.doesNotMatch(html,/sceneProblemTitle|sourceTitleV16/);
  assert.doesNotMatch(toolbar,/questionSelect|問題を選ぶ/);
  assert.match(toolbar,/<details[^]*?aria-label="その他の操作"[^]*?id="nagaSourceLink"[^]*?id="importQuestionButton"[^]*?<\/details>/);
  assert.doesNotMatch(toolbar,/<details[^>]*\sopen[\s>]/);
  assert.match(html,/questionHeaderV250\.render\(question.number, questionTypeV44\(question\)\)/);
  assert.match(html,/getElementById\("questionSelect"\).addEventListener\("change", event => openQuestionV16\(Number\(event.target.value\)\)\)/);
  assert.match(html,/filter\(\(\{ question \}\) => isPlayableV16\(question\)\)/);
  assert.match(html,/select.disabled = entries.length === 0/);
  assert.match(html,/button.hidden = !Boolean\(sharedCollectionV46 && question\?\.serverQuestionId\)/);
  assert.match(html,/getElementById\("nagaSourceLink"\).href = SCENE.nagaUrl/);
  assert.match(html,/if \(!supabaseSessionV46\) \{\s*window.alert\("自分の問題集へのインポートにはDiscordログインが必要です。"\)/);
});

test('render updates text safely and closes stale secondary actions',()=>{
  const {api,more,ids}=fixture();more.open=true;
  api.render(602,'打牌判断');
  assert.equal(ids.questionTitleNumberV250.textContent,'問題602');
  assert.equal(ids.questionPageTitle.attrs['aria-label'],'問題602　打牌判断');
  assert.equal(more.open,false);
  api.render(99999,'<img onerror="bad()">');
  assert.equal(ids.questionTitleTypeV250.textContent,'<img onerror="bad()">');
  assert.doesNotMatch(js,/innerHTML|fetch\(|setInterval|localStorage/);
});

test('disclosure closes on outside click, Escape, tab-away and before invoking actions',()=>{
  const {api,doc,more,summary,panel,outside}=fixture();
  more.open=true;doc.fire('click',{target:summary});assert.equal(more.open,true);
  doc.fire('click',{target:outside});assert.equal(more.open,false);assert.equal(summary.focused,false);
  let prevented=false;more.open=true;
  doc.fire('keydown',{key:'Escape',preventDefault(){prevented=true;}});
  assert.equal(more.open,false);assert.equal(summary.focused,true);assert.equal(prevented,true);
  more.open=true;more.fire('focusout',{relatedTarget:panel});assert.equal(more.open,true);
  more.fire('focusout',{relatedTarget:outside});assert.equal(more.open,false);
  more.open=true;panel.fire('click',{target:{closest:()=>null}});assert.equal(more.open,true);
  panel.fire('click',{target:{closest:()=>({})}});assert.equal(more.open,false);
  assert.equal(panel.listeners.click.capture,true,'close before existing import modal handler');
  more.open=true;api.close();assert.equal(more.open,false);
});

test('responsive styles preserve touch targets, permission-hidden actions and readable picker options',()=>{
  assert.match(css,/min-height: 44px/);
  assert.match(css,/> summary[^{]*\{[^]*?width: 44px;[^]*?height: 44px;/);
  assert.match(css,/button\[hidden\] \{ display: none; \}/);
  assert.match(css,/#questionSelect \{[^]*?font-size: 16px;/);
  assert.match(css,/focus-within/);assert.match(css,/focus-visible/);
  assert.match(css,/max-width: calc\(100vw - 24px\)/);
  assert.match(css,/@media \(max-width: 800px\)/);
  assert.doesNotMatch(css,/\.(hand|tile|scene|answer|riichi)[-\w]*\s*\{/);
  assert.match(html,/question-header-v250\.js\?v=250/);
  assert.match(html,/question-header-v250\.css\?v=250/);
});
