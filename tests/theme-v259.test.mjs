import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const js = fs.readFileSync(new URL('../public/theme-v259.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const key = 'minkiru:color-theme:v1';
function browser({ values = new Map(), blocked = false } = {}) {
  const writes = [], events = {}, listeners = [];
  const radios = ['light', 'dark'].map(value => ({name:'colorThemeV259', value, checked:false}));
  const status = {textContent:'', classList:{toggle(name, value) { status.error = value; }, remove() { status.error = false; }}};
  const control = {dataset:{}, addEventListener(type, fn) { listeners.push(fn); }};
  const meta = {setAttribute(name, value) { this[name] = value; }};
  const document = {
    documentElement:{dataset:{}, style:{}},
    querySelector(selector) { return selector.startsWith('meta') ? meta : selector === '.theme-preference-v259' ? control : status; },
    querySelectorAll() { return radios; }
  };
  const storage = {getItem(k) { return values.get(k) ?? null; }, setItem(k, v) { writes.push(k); values.set(k, v); }};
  const window = {addEventListener(type, fn) { events[type] = fn; }};
  Object.defineProperty(window, 'localStorage', {get() { if (blocked) throw new Error('storage disabled'); return storage; }});
  vm.runInNewContext(js, {window, document});
  return {api:window.MinkiruThemeV259, document, meta, writes, values, events, storage, status, radios, listeners};
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

test('My Page switches immediately, writes only its preference and survives a new page load', () => {
  const values = new Map([['existing-study-state', 'preserve-all-answers-and-comments']]);
  const b = browser({values});
  b.api.bind(); b.api.bind();
  assert.equal(b.listeners.length, 1);
  b.radios[0].checked = true;
  b.listeners[0]({target:b.radios[0]});
  assert.equal(b.api.current(), 'light');
  assert.equal(b.document.documentElement.style.colorScheme, 'light');
  assert.equal(b.meta.content, '#f3f6f7');
  assert.match(b.status.textContent, /保存しました/);
  assert.deepEqual(b.radios.map(input => input.checked), [true, false]);
  assert.deepEqual(b.writes, [key]);
  assert.equal(values.get('existing-study-state'), 'preserve-all-answers-and-comments');
  const reloaded = browser({values});
  assert.equal(reloaded.api.current(), 'light');
  assert.equal(reloaded.document.documentElement.dataset.theme, 'light');
  assert.equal(reloaded.api.set('dark'), true);
  assert.equal(browser({values}).api.current(), 'dark');
});

test('disabled storage still switches and truthfully reports the missing persistence', () => {
  const b = browser({blocked:true});
  b.api.bind();
  b.radios[0].checked = true;
  b.listeners[0]({target:b.radios[0]});
  assert.equal(b.api.current(), 'light');
  assert.equal(b.status.error, true);
  assert.match(b.status.textContent, /保存できない/);
  assert.equal(browser({blocked:true}).api.current(), 'light');
  assert.doesNotThrow(() => b.events.storage({key, newValue:'dark'}));
});

test('other tabs synchronize controls and clearing preferences restores light without feedback writes', () => {
  const b = browser();
  b.events.storage({key, newValue:'dark', storageArea:b.storage});
  assert.equal(b.api.current(), 'dark');
  assert.deepEqual(b.radios.map(input => input.checked), [false, true]);
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

test('invalid changes cannot overwrite preferences or react to unrelated account fields', () => {
  const b = browser({values:new Map([[key,'light']])});
  b.api.bind();
  b.listeners[0]({target:{name:'displayNameInput', checked:true, value:'dark'}});
  b.listeners[0]({target:{name:'colorThemeV259', checked:false, value:'dark'}});
  assert.equal(b.api.set('automatic'), false);
  assert.equal(b.api.current(), 'light');
  assert.deepEqual(b.writes, []);
});

test('accessible My Page controls reflect current theme and early restoration precedes app markup', () => {
  const match = html.match(/^      function renderSettingsViewV67\([^\n]*\) \{[\s\S]*?^      \}/m);
  assert.ok(match);
  for (const theme of ['dark','light']) {
    const context = vm.createContext({window:{MinkiruThemeV259:{current:()=>theme}},userStateV16:{settings:{}},currentUserDisplayNameV47:()=>'',supabaseSessionV46:null,escapeHtml:s=>s,customReactionSettingsMarkupV211:()=>''});
    vm.runInContext(match[0], context);
    const result = context.renderSettingsViewV67();
    assert.match(result, /data-settings-group-v240="display"/);
    assert.match(result, /<legend>カラーモード<\/legend>/);
    assert.match(result, new RegExp(`name="colorThemeV259" value="${theme}" checked`));
    assert.equal((result.match(/name="colorThemeV259"[^>]* checked/g) || []).length, 1);
    assert.match(result, /id="themePreferenceStatusV259" role="status"/);
    assert.match(result, /id="desktopLayoutSelect"/);
  }
  assert.ok(html.indexOf('<script src="theme-v259.js?v=305"></script>') < html.indexOf('<style'));
  assert.match(html, /window\.MinkiruThemeV259\?\.bind\(\)/);
  assert.ok(html.indexOf('theme-v259.css?v=305') > html.indexOf('question-toolbar-v255.css'));
});
