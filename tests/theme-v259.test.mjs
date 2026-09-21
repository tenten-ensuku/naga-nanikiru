import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const js = fs.readFileSync(new URL('../public/theme-v259.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const key = 'minkiru:color-theme:v1';
function browser({ values = new Map(), blocked = false } = {}) {
  const writes = [], events = {};
  const meta = {setAttribute(name, value) { this[name] = value; }};
  const document = {
    documentElement:{dataset:{}, style:{}},
    querySelector(selector) { return selector.startsWith('meta') ? meta : null; }
  };
  const storage = {getItem(k) { return values.get(k) ?? null; }, setItem(k, v) { writes.push(k); values.set(k, v); }};
  const window = {addEventListener(type, fn) { events[type] = fn; }};
  Object.defineProperty(window, 'localStorage', {get() { if (blocked) throw new Error('storage disabled'); return storage; }});
  vm.runInNewContext(js, {window, document});
  return {api:window.MinkiruThemeV259, document, meta, writes, values, events, storage};
}

test('first visit and invalid preferences use light mode without rewriting saved study data', () => {
  for (const saved of [undefined, 'auto', '<script>', 'LIGHT']) {
    const values = new Map([['existing-study-state', '{"answerHistory":[1],"settings":{"desktopLayout":"single"}}']]);
    if (saved !== undefined) values.set(key, saved);
    const before = [...values];
    const b = browser({values});
    assert.equal(b.api.current(), 'light');
    assert.equal(b.document.documentElement.dataset.theme, 'light');
    assert.equal(b.meta.content, '#f3f6f7');
    assert.deepEqual([...values], before);
    assert.deepEqual(b.writes, []);
  }
});

test('the shared theme API switches immediately, writes only its preference and survives a new page load', () => {
  const values = new Map([['existing-study-state', 'preserve-all-answers-and-comments']]);
  const b = browser({values});
  assert.equal(b.api.set('light'), true);
  assert.equal(b.api.current(), 'light');
  assert.equal(b.document.documentElement.style.colorScheme, 'light');
  assert.equal(b.meta.content, '#f3f6f7');
  assert.deepEqual(b.writes, [key]);
  assert.equal(values.get('existing-study-state'), 'preserve-all-answers-and-comments');
  const reloaded = browser({values});
  assert.equal(reloaded.api.current(), 'light');
  assert.equal(reloaded.document.documentElement.dataset.theme, 'light');
  assert.equal(reloaded.api.set('dark'), true);
  assert.equal(browser({values}).api.current(), 'dark');
});

test('disabled storage still switches and reports the missing persistence to the header control', () => {
  const b = browser({blocked:true});
  assert.equal(b.api.set('dark'), false);
  assert.equal(b.api.current(), 'dark');
  assert.equal(browser({blocked:true}).api.current(), 'light');
  assert.doesNotThrow(() => b.events.storage({key, newValue:'dark'}));
});

test('other tabs synchronize appearance and clearing preferences restores light without feedback writes', () => {
  const b = browser();
  b.events.storage({key, newValue:'dark', storageArea:b.storage});
  assert.equal(b.api.current(), 'dark');
  assert.equal(b.document.documentElement.dataset.theme, 'dark');
  b.events.storage({key:'existing-study-state', newValue:'light', storageArea:b.storage});
  b.events.storage({key, newValue:'light', storageArea:{}});
  assert.equal(b.api.current(), 'dark');
  b.events.storage({key, newValue:null, storageArea:b.storage});
  assert.equal(b.api.current(), 'light');
  b.events.storage({key, newValue:'dark', storageArea:b.storage});
  b.events.storage({key:null, newValue:null, storageArea:b.storage});
  assert.equal(b.api.current(), 'light');
  assert.deepEqual(b.writes, []);
});

test('invalid changes cannot overwrite preferences', () => {
  const b = browser({values:new Map([[key,'light']])});
  assert.equal(b.api.set('automatic'), false);
  assert.equal(b.api.current(), 'light');
  assert.deepEqual(b.writes, []);
});

test('My Page retains PC layout settings without duplicating the header theme control', () => {
  const match = html.match(/^      function renderSettingsViewV67\([^\n]*\) \{[\s\S]*?^      \}/m);
  assert.ok(match);
  for (const desktopLayout of [undefined, 'single', 'split']) {
    const context = vm.createContext({window:{},userStateV16:{settings:{desktopLayout}},currentUserDisplayNameV47:()=>'',supabaseSessionV46:null,escapeHtml:s=>s,accountNotificationsV314:{settingsMarkup:()=>'<div>通知設定</div>'},customReactionSettingsMarkupV211:()=>''});
    vm.runInContext(match[0], context);
    const result = context.renderSettingsViewV67();
    assert.match(result, /data-settings-group-v240="display"/);
    assert.doesNotMatch(result, /colorThemeV259|themePreference|カラーモード|ライト／ダーク/);
    assert.match(result, /id="desktopLayoutSelect"/);
    assert.match(result, new RegExp(`<option value="${desktopLayout === 'single' ? 'single' : 'split'}" selected>`));
  }
  assert.ok(html.indexOf('<script src="theme-v259.js?v=322"></script>') < html.indexOf('<style'));
  assert.match(html, /id="themeQuickV295"/);
  assert.ok(html.indexOf('theme-v259.css?v=322') > html.indexOf('question-toolbar-v255.css'));
});
