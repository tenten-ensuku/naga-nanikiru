import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/menu-sections-v239.css', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../public/menu-sections-v239.js', import.meta.url), 'utf8');
function source(name) {
  const match = html.match(new RegExp(`^      (?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^      \\}`, 'm'));
  assert.ok(match, name); return match[0];
}
function fixture() {
  const events = {}, replacements = [];
  const buttons = [{hidden: true}, {hidden: true}];
  const summary = {focus() { this.focused = true; }};
  const menu = {dataset: {}, hidden: true, open: false,
    querySelectorAll: () => buttons, querySelector: () => summary, contains: target => !!target.inside};
  const panel = {querySelectorAll(selector) { const node = {}; replacements.push({selector, node}); return [node]; }};
  const document = {getElementById: id => id === 'menuPanel' ? panel : menu, addEventListener(type, handler) { events[type] = handler; }};
  const context = vm.createContext({window: {document}, escapeHtml: value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')});
  vm.runInContext(js, context);
  vm.runInContext(source('renderLearningActionButtonV194'), context);
  return {api: context.window.MinkiruMenuV239, context, events, replacements, menu, summary, buttons};
}
test('V239 is an additive menu-only layer, with no external font or backend work', () => {
  assert.match(html, /const APP_VERSION = 239;/);
  assert.match(html, /menu-polish-v238\.css\?v=239[\s\S]*menu-sections-v239\.css\?v=239/);
  assert.match(html, /menu-sections-v239\.js\?v=239/);
  assert.doesNotMatch(css, /@import|@font-face|https?:|\.scene-frame|\.hand-mask|\.riichi|learning-header-progress-track/);
  assert.doesNotMatch(js, /fetch\(|localStorage|sessionStorage|NagaSupabase|XMLHttpRequest/);
});
test('all three destinations remain together and management precedes the tab strip', () => {
  const start = html.indexOf('id="bookContextV234"');
  const end = html.indexOf('<div class="menu-heading">', start);
  const book = html.slice(start, end);
  assert.deepEqual([...book.matchAll(/data-book-view="([^"]+)"/g)].map(m => m[1]), ['today','my','analysis']);
  assert.ok(book.indexOf('data-book-manage') < book.indexOf('class="book-tabs-v234"'));
  assert.match(book, /<details class="book-more-v239" id="bookActionsMenuV239" hidden>/);
  assert.match(book, /<summary aria-label="この本の操作"/);
  assert.doesNotMatch(book.slice(book.indexOf('class="book-tabs-v234"')), /data-book-create|data-book-manage/);
  assert.match(source('renderBookNavigationV234'), /collectionManagementCanManageV197[\s\S]*syncActions\(context\)/);
});
test('management disclosure hides for viewers and revoked permissions, with Escape/outside dismissal', () => {
  const {api, menu, buttons, events, summary} = fixture();
  const context = {hidden: false, querySelector: () => menu};
  api.syncActions(context); assert.equal(menu.hidden, true);
  buttons[0].hidden = false; api.syncActions(context); assert.equal(menu.hidden, false);
  menu.open = true;
  events.keydown({key:'Escape', preventDefault() {}});
  assert.equal(menu.open, false); assert.equal(summary.focused, true);
  menu.open = true; events.click({target:{inside:false}}); assert.equal(menu.open, false);
  menu.open = true; events.click({target:{inside:true,closest:()=>null}}); assert.equal(menu.open,true);
  events.click({target:{inside:true,closest:()=>({})}}); assert.equal(menu.open,false);
  menu.open = true; buttons[0].hidden = true; api.syncActions(context); assert.equal(menu.hidden,true); assert.equal(menu.open,false);
  buttons[1].hidden = false; menu.open = true; context.hidden = true; api.syncActions(context); assert.equal(menu.open,false);
});
test('each category is one native button with its original action, number and disabled state', () => {
  const {context} = fixture();
  for (const [mode,tone,title] of [['unanswered','primary','未回答'],['weak','weak','苦手克服'],['all','all','全問']]) {
    const row = context.renderLearningActionButtonV194({mode,tone,title,count:0,description:'条件の説明',disabled:' disabled'});
    assert.equal((row.match(/<button/g)||[]).length,1);
    assert.match(row, new RegExp(`data-learning-action="${mode}"`));
    assert.match(row, /0問の学習を開始" disabled>/);
    assert.match(row, /learning-category-icon-v239/);
    assert.match(row, /learning-action-link" aria-hidden="true"><svg/);
    assert.doesNotMatch(row, /プレイ|>解く<|>復習</);
    assert.equal((row.match(/<svg/g)||[]).length,2);
  }
});
test('row content is escaped, and icons are bounded vendor assets', () => {
  const {api,context,replacements} = fixture();
  const row = context.renderLearningActionButtonV194({mode:'all',tone:'all',title:'<script>',count:'…',description:'<img>'});
  assert.doesNotMatch(row, /<script>|<img>/);
  assert.equal(api.icon('unknown'), '');
  assert.equal((api.icon('book-open').match(/aria-hidden="true"/g) || []).length, 1);
  assert.match(api.icon('book-open'), /focusable="false"/);
  assert.ok(replacements.every(({node}) => node.innerHTML.startsWith('<svg ')));
  assert.match(js, /Heroicons v2\.2\.0 \(MIT\)/);
});
test('selected tabs use a shared gold underline; settings retain normal-flow expansion', () => {
  assert.match(css, /\.book-tabs-v234 \{[^}]*gap: 0;[^}]*border-bottom: 1px solid/);
  assert.match(css, /border-bottom-color: #f4cb63;/);
  assert.match(css, /grid-template-areas: "icon main cta" "icon description cta"/);
  assert.match(css, /learning-custom-settings\[open\] \.learning-custom-settings-body \{[^}]*position: static;/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /var\(--book-tint/);
});
