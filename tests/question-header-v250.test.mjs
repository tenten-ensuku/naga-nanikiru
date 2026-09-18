import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const html=read('public/index.html'),js=read('public/question-header-v250.js'),css=read('public/question-toolbar-v255.css');

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

test('V255 one native question selector and all actions share the same toolbar',()=>{
  const title=html.match(/<h1 id="questionPageTitle"[^]*?<\/h1>/)?.[0];
  const toolbar=html.match(/<div class="source-bar">[^]*?<section class="scene-card"/)?.[0];
  assert.match(title,/id="questionSelect" aria-label="問題を選ぶ"/);
  assert.equal((html.match(/id="questionSelect"/g)||[]).length,1);
  assert.doesNotMatch(html,/sceneProblemTitle|sourceTitleV16/);
  assert.match(toolbar,/questionSelect/);
  assert.doesNotMatch(toolbar,/<details|questionMoreV250/);
  assert.doesNotMatch(html,/questionHeaderV250\.close/);
  const ids=['questionSelect','questionTitleTypeV250','modelSelect','nagaSourceLink','importQuestionButton','menuButton'];
  assert.deepEqual(ids.slice().sort((a,b)=>toolbar.indexOf(`id="${a}"`)-toolbar.indexOf(`id="${b}"`)),ids);
  assert.doesNotMatch(toolbar,/>正誤判定基準/);
  assert.match(html,/questionHeaderV250\.render\(question.number, questionTypeV44\(question\)\)/);
  assert.match(html,/getElementById\("questionSelect"\).addEventListener\("change", event => openQuestionV16\(Number\(event.target.value\)\)\)/);
  assert.match(html,/filter\(\(\{ question \}\) => isPlayableV16\(question\)\)/);
  assert.match(html,/select.disabled = entries.length === 0/);
  assert.match(html,/button.hidden = !Boolean\(sharedCollectionV46 && question\?\.serverQuestionId\)/);
  assert.match(html,/getElementById\("nagaSourceLink"\).href = SCENE.nagaUrl/);
  assert.match(html,/if \(!supabaseSessionV46\) \{\s*window.alert\("自分の問題集へのインポートにはDiscordログインが必要です。"\)/);
});

test('render updates the title safely without requests or additional controls',()=>{
  const {api,ids}=fixture();
  api.render(602,'打牌判断');
  assert.equal(ids.questionTitleNumberV250.textContent,'問題602');
  assert.equal(ids.questionPageTitle.attrs['aria-label'],'問題602　打牌判断');
  api.render(99999,'<img onerror="bad()">');
  assert.equal(ids.questionTitleTypeV250.textContent,'<img onerror="bad()">');
  assert.doesNotMatch(js,/innerHTML|fetch\(|setInterval|localStorage/);
});

test('V255 retains accessible return destinations while showing only the compact return label',()=>{
  assert.match(html,/back\.querySelector\("\.question-toolbar-label-short"\)\.textContent = "戻る"/);
  assert.match(html,/back\.setAttribute\("aria-label", originLabel\)/);
  assert.match(html,/rel="noopener noreferrer" aria-label="局面NAGAURLに移動"/);
});

test('responsive styles preserve touch targets, permission-hidden actions and readable picker options',()=>{
  assert.match(css,/min-height: 44px/);
  assert.match(css,/\[hidden\] \{ display: none; \}/);
  assert.match(read('public/question-header-v250.css'),/#questionSelect \{[^]*?font-size: 16px;/);
  assert.match(css,/focus-within/);assert.match(css,/focus-visible/);
  assert.match(css,/overflow-x: auto/);assert.match(css,/flex-wrap: nowrap/);
  assert.match(css,/@media \(max-width: 800px\)/);
  assert.doesNotMatch(css,/\.(hand|tile|scene|answer|riichi)[-\w]*\s*\{/);
  assert.match(html,/question-header-v250\.js\?v=291/);
  assert.match(html,/question-header-v250\.css\?v=291/);
});
