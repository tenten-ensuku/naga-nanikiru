import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(testDir, "..");
const read = relativePath => fs.readFileSync(path.join(repoDir, relativePath), "utf8");
const html = read("public/index.html");

const addedReactions = [
  ["アリ！", "⭕"],
  ["好みで", "🎨"],
  ["ふむふむ", "🤓"],
  ["なるほど！", "🙌"],
  ["基礎講義", "📚"],
  ["オリ", "🛡️"],
  ["押し", "💪"],
  ["お好み焼き", "🥞"]
];

test("V221 adds the requested curated reactions in the requested order", () => {
  assert.match(html, /const APP_VERSION = 329;/);
  let previousIndex = html.indexOf('id: "question"');
  assert.ok(previousIndex >= 0);
  for (const [label, icon] of addedReactions) {
    const labelIndex = html.indexOf(`label: "${label}"`);
    assert.ok(labelIndex > previousIndex, `定番リアクションの順番が不正: ${label}`);
    assert.match(html, new RegExp(`label: "${label}", icon: "${icon}"`));
    previousIndex = labelIndex;
  }
});

const sourceBetween = (from, to) => html.slice(html.indexOf(from), html.indexOf(to));
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

test("reaction candidates keep complete labels, one action, and accessible tile names", () => {
  const context = vm.createContext({escapeHtml, reactionIconMarkupV213: () => '<span>icon</span>', reactionAccessibleLabelV211: item => item.label});
  vm.runInContext(sourceBetween('    function reactionPickerOptionMarkupV211(', '    function setReactionPickerTabV213('), context);
  for (const definition of [
    {id:'agree',label:'なるほど！'},
    {id:'custom',label:'長い名前 <カスタム>',iconType:'image'},
    {id:'tile',label:'中',iconType:'mahjong-tile'}
  ]) {
    const rendered = context.reactionPickerOptionMarkupV211(definition, {[definition.id]:{reactedByMe:true}});
    assert.equal((rendered.match(/<button /g)||[]).length,1);
    assert.ok(rendered.includes(`aria-label="${escapeHtml(definition.label)}"`));
    assert.match(rendered,/aria-pressed="true"/);
    assert.doesNotMatch(rendered,/favorite|[★☆]/);
    if(definition.iconType !== 'mahjong-tile') assert.ok(rendered.includes(`>${escapeHtml(definition.label)}</span>`));
  }
  const tabs = [...html.matchAll(/data-reaction-tab="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(tabs,['history','standard','tiles','custom']);
  for(const tab of tabs) assert.equal(context.normalizeReactionPickerTabV213(tab),tab);
  assert.equal(context.normalizeReactionPickerTabV213('favorites'),'standard');
  assert.equal(context.normalizeReactionPickerTabV213(null),'standard');
});

test("existing recent reactions survive removal of favorites and remain scoped per account", () => {
  let account='one';
  const saved=new Map([['reaction-preferences-v1:one',JSON.stringify({favoriteKeys:['old'],historyKeys:['first','missing','first','second']})]]);
  const context=vm.createContext({storageKey:String,reactionCurrentUserIdV208:()=>account,
    reactionDefinitionByKeyV211:key=>key==='missing'?null:{id:key},
    window:{localStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)}}});
  vm.runInContext(sourceBetween('    const REACTION_PREFERENCES_STORAGE_KEY_V221 =', '    function reactionParticipantInitialV208('),context);
  assert.deepEqual(Array.from(context.reactionPreferenceDefinitionsV221(),item=>item.id),['first','second']);
  for(let i=0;i<30;i++)context.rememberReactionHistoryV221(`r${i}`);
  context.rememberReactionHistoryV221('r28');
  let history=JSON.parse(saved.get('reaction-preferences-v1:one')).historyKeys;
  assert.equal(history.length,24);assert.equal(new Set(history).size,24);
  assert.deepEqual(history.slice(0,2),['r28','r29']);
  account='two';assert.equal(context.reactionPreferenceDefinitionsV221().length,0);
  context.rememberReactionHistoryV221('second');
  assert.deepEqual(JSON.parse(saved.get('reaction-preferences-v1:one')).historyKeys,history);
  account='one';assert.equal(context.reactionPreferenceDefinitionsV221()[0].id,'r28');
});

test("all remaining picker panels render without a favorites panel", () => {
  const elements=Object.fromEntries(['reactionPickerOptionsV208','reactionPickerHistoryOptionsV221','reactionTilePickerOptionsV213','reactionCustomPickerOptionsV211','reactionPickerCustomCountV211'].map(id=>[id,{}]));
  const context=vm.createContext({standardReactionCatalogV329:null,document:{getElementById:id=>elements[id]},reactionPickerTargetV208:{scope:'comment',targetId:'comment1'},
    reactionBucketV208:()=>({}), REACTION_TOP_KEYS_V211:['top'], REACTION_DEFINITION_MAP_V209:new Map([['top',{id:'top'}]]),
    REACTION_DEFINITIONS_V209:[{id:'rest'},{id:'top'}],MAHJONG_TILE_REACTION_DEFINITIONS_V213:[{id:'tile'}],
    state:{customReactions:[{id:'custom'}]},reactionPreferenceDefinitionsV221:()=>[{id:'recent'}],
    reactionPickerOptionMarkupV211:item=>`[${item.id}]`,setReactionPickerTabV211(){},reactionPickerTabV211:'standard'});
  vm.runInContext(sourceBetween('    function renderReactionPickerOptionsV208(', '    function openReactionPickerV208('),context);
  context.renderReactionPickerOptionsV208();
  assert.equal(elements.reactionPickerOptionsV208.innerHTML,'[top][rest]');
  assert.equal(elements.reactionPickerHistoryOptionsV221.innerHTML,'[recent]');
  assert.equal(elements.reactionTilePickerOptionsV213.innerHTML,'[tile]');
  assert.equal(elements.reactionCustomPickerOptionsV211.innerHTML,'[custom]');
  assert.equal(elements.reactionPickerCustomCountV211.textContent,'1');
});

test("switching from a short history panel to tall candidates repositions inside the viewport", () => {
  const panels=Object.fromEntries(['HistoryPanelV221','StandardPanelV211','TilePanelV213','CustomPanelV211'].map(suffix=>[`reactionPicker${suffix}`,{hidden:true}]));
  const picker={hidden:false,offsetWidth:366,style:{},querySelectorAll:()=>[],get offsetHeight(){return panels.reactionPickerStandardPanelV211.hidden?220:820;}};
  const context=vm.createContext({window:{innerWidth:390,innerHeight:844},reactionPickerTabV211:'history',
    reactionPickerTargetV208:{opener:{getBoundingClientRect:()=>({left:80,top:520,bottom:560})}},
    document:{getElementById:id=>id==='reactionPickerV208'?picker:panels[id]}});
  vm.runInContext(sourceBetween('    function reactionPopoverPositionV208(', '    let reactionPickerTargetV208 =') + sourceBetween('    function normalizeReactionPickerTabV213(', '    function renderReactionPickerOptionsV208('),context);
  context.setReactionPickerTabV213('history');assert.equal(picker.style.top,'568px');
  context.setReactionPickerTabV213('standard');assert.equal(picker.style.top,'12px');assert.equal(picker.style.left,'12px');
  assert.equal(panels.reactionPickerHistoryPanelV221.hidden,true);
  assert.equal(panels.reactionPickerStandardPanelV211.hidden,false);
});
