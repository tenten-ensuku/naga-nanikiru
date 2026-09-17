import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/workspace-ui-v240.css', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../public/workspace-ui-v240.js', import.meta.url), 'utf8');
function source(name) {
  const match = html.match(new RegExp(`^      (?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^      \\}`, 'm'));
  assert.ok(match, name); return match[0];
}
function generator(unavailable, mode = 'scene') {
  const context = vm.createContext({window:{NAGA_RUNTIME_CONFIG:{backend:'cloudflare',heavyOperationsEnabled:!unavailable}},generatorModeV46:mode,generatorBusyV159:false,
    generatorEntryV234:'global',generatorProgressMarkupV159:()=>'<ol></ol>',renderGeneratorDestinationV130:()=>'<select id="generatorDestinationSelect"></select>',
    generatorSeatOptionsV46:()=>'<option value="auto">URLのtwを使用</option>',generatorModelFilterMarkupV46:()=>'<div id="generatorModelFilter"></div>',renderGeneratorCandidatesV44:()=>''});
  vm.runInContext(source('renderGeneratorViewV44'),context); return context.renderGeneratorViewV44();
}
test('V240 adds only a local presentation layer and preserves approved assets',()=>{
  assert.match(html,/const APP_VERSION = 275;/);
  assert.match(html,/workspace-ui-v240\.css\?v=275/); assert.match(html,/workspace-ui-v240\.js\?v=275/);
  assert.doesNotMatch(js,/fetch\(|XMLHttpRequest|localStorage|sessionStorage|innerHTML|NagaSupabase/);
  assert.doesNotMatch(css,/@import|@font-face|https?:|\.scene-frame|\.hand-mask|\.riichi|learning-header-progress-track/);
  assert.match(css,/var\(--menu-serif-v238\)/); assert.match(css,/var\(--menu-sans-v238\)/);
  assert.match(css,/min-height: 44px/); assert.match(css,/:focus-visible/);
  assert.match(html,/assets\/min-kiru-header\.png/);
});
test('blocked NAGA form is folded and disabled; the existing import route remains available',()=>{
  const result=generator(true);
  assert.match(result,/<details class="generator-unavailable-v240">/);
  assert.match(result,/<fieldset class="generator-locked-v240" disabled/);
  assert.match(result,/type="submit" disabled/);
  assert.match(result,/data-menu-jump="collections"/);
  assert.match(result,/自分の問題集にインポート/);
  assert.ok(result.indexOf('id="generatorDestinationSelect"') < result.indexOf('class="generator-locked-v240"'), 'capacity selection stays available outside the locked form');
  assert.doesNotMatch(result,/QUESTION BUILDER|class="generator-destination-note"/);
});
test('available form follows destination URL player options submit without guessing URL intent',()=>{
  for(const mode of ['scene','match']) {
    const result=generator(false,mode);
    assert.doesNotMatch(result,/generator-locked-v240|generator-unavailable-v240/);
    const ids=['id="generatorDestinationSelect"','id="generatorUrl"','id="generatorSeat"','name="generatorMode"','type="submit"'];
    for(let i=1;i<ids.length;i++) assert.ok(result.indexOf(ids[i-1])<result.indexOf(ids[i]));
    assert.match(result,new RegExp(`value="${mode}" checked`));
    assert.match(result,mode==='scene'?/id="generatorCustomSettings" hidden/:/id="generatorCustomSettings">/);
  }
});
test('manual scene or match intent is restored after reload, including older drafts without a mode',()=>{
  const radios=[{value:'scene',checked:true},{value:'match',checked:false}];
  const doc={getElementById:()=>null,querySelectorAll:s=>s==='input[name="generatorMode"]'?radios:[]};
  let syncs=0;
  const context=vm.createContext({document:doc,generatorFormDraftV157:null,generatorReportV44:null,generatorReportedModelNamesV46:()=>[],syncGeneratorModeV46:()=>{syncs++}});
  vm.runInContext(source('restoreGeneratorFormDraftV157'),context);
  context.restoreGeneratorFormDraftV157({mode:'match'});assert.deepEqual(radios.map(r=>r.checked),[false,true]);
  context.restoreGeneratorFormDraftV157({url:'older draft'});assert.deepEqual(radios.map(r=>r.checked),[false,true]);
  context.restoreGeneratorFormDraftV157({mode:'scene'});assert.deepEqual(radios.map(r=>r.checked),[true,false]);
  assert.equal(syncs,2);
  assert.match(source('captureGeneratorFormDraftV157'),/mode: document\.querySelector\('input\[name="generatorMode"\]:checked'\)/);
});
test('settings disclosures retain mounted draft/file state and open the reaction category directly',()=>{
  const groups=['account','display','reactions','transfer'].map(key=>({dataset:{settingsGroupV240:key},open:false,form:{value:'入力途中',file:'pending.png'},listeners:[],querySelector(){return {focus:()=>{this.focused=true}}},addEventListener(type,fn){this.listeners.push(fn)}}));
  const doc={querySelector:s=>groups.find(g=>s.includes(`"${g.dataset.settingsGroupV240}"`)),querySelectorAll:()=>groups};
  const context=vm.createContext({window:{},document:doc});vm.runInContext(js,context);const api=context.window.MinkiruWorkspaceV240;
  api.bindSettings();api.bindSettings();assert.ok(groups.every(g=>g.listeners.length===1));
  assert.equal(api.openSettings('reactions',{focus:true}),true);assert.equal(groups[2].focused,true);
  api.openSettings('account');assert.deepEqual(groups.map(g=>g.open),[true,false,false,false]);
  assert.ok(groups.every(g=>g.form.value==='入力途中'&&g.form.file==='pending.png'));
  assert.equal(api.openSettings('unknown'),false);assert.equal(api.openSettings('teaching'),false);
  assert.match(html,/openSettings\("reactions", \{ focus: true \}\)/);
});
test('settings keep authority gates, named categories and escaped profile text without obsolete transfer',()=>{
  const context=vm.createContext({window:{},userStateV16:{settings:{displayName:'<img>'}},currentUserDisplayNameV47:()=>'<img>',supabaseSessionV46:{user:{id:'fixture'}},escapeHtml:s=>s.replaceAll('<','&lt;'),customReactionSettingsMarkupV211:()=>'<form id="reactions"></form>'});
  vm.runInContext(source('renderSettingsViewV67'),context);const result=context.renderSettingsViewV67();
  for(const key of ['account','display','reactions']) assert.match(result,new RegExp(`data-settings-group-v240="${key}"`));
  assert.doesNotMatch(result,/<img>|data-settings-group-v240="teaching"/);
  assert.doesNotMatch(result,/data-settings-transfer-v240|以前のデータを引き継ぐ/);assert.match(result,/accountAuthButtonV240/);
  assert.match(source('renderMenuCardsV16'),/if \(canViewStudentDashboardV84\(\)\) \{[\s\S]*data-settings-group-v240="teaching"/);
  assert.match(source('refreshAccountBodyV153'),/authButton\.hidden = Boolean\(session\?\.user\?\.id\)/);
  assert.match(source('bindSettingsViewV67'),/accountAuthButtonV240.*handleDiscordAuthV187/);
});
test('image disclosure keeps sharing and size warnings and does not enable disabled uploads',()=>{
  const context=vm.createContext({window:{NAGA_RUNTIME_CONFIG:{backend:'cloudflare',heavyOperationsEnabled:false}},customReactionSettingsListMarkupV213:()=>''});
  vm.runInContext(source('customReactionSettingsMarkupV213'),context);const result=context.customReactionSettingsMarkupV213();
  assert.match(result,/他のログイン利用者も使えます/);assert.match(result,/1MB以内/);
  assert.match(result,/<details class="reaction-image-options-v240" id="reactionImageOptionsV240">/);
  assert.match(result,/<fieldset disabled>/);assert.match(result,/絵文字は利用できます/);
});
test('account logout invokes the existing service and rejects a concurrent second request',async()=>{
  let calls=0,resolve;const completed=new Promise(r=>{resolve=r});
  const nodes={};for(const key of ['discordAuthButton','accountAuthButtonV240','accountActionStatusV240'])nodes[key]={classList:{add(){}}};
  const context=vm.createContext({document:{getElementById:id=>nodes[id]},window:{NagaSupabase:{configured:true,signOut:async()=>{calls++;await completed}}},supabaseSessionV46:{user:{id:'fixture'}},authPendingV46:false,setAuthGateStateV187(){},async refreshAccountV46(){}});
  vm.runInContext(source('handleDiscordAuthV187'),context);
  const first=context.handleDiscordAuthV187();await context.handleDiscordAuthV187();assert.equal(calls,1);assert.equal(nodes.accountAuthButtonV240.disabled,true);
  resolve();await first;assert.equal(nodes.accountAuthButtonV240.disabled,false);
});
