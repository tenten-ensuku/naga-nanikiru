import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const soundSource = fs.readFileSync(new URL('../public/sound-v342.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const storageKey = 'minkiru:sound:v1';

class FakeElement {
  constructor(tagName, attributes = {}, parent = null) {
    this.tagName = tagName.toUpperCase();
    this.nodeType = 1;
    this.parentElement = parent;
    this.parentNode = parent;
    this.attributes = new Map(Object.entries(attributes).map(([name, value]) => [name, String(value)]));
    this.id = attributes.id || '';
    this.type = attributes.type || (tagName === 'input' ? 'text' : '');
    this.disabled = Object.hasOwn(attributes, 'disabled');
    this.inert = Object.hasOwn(attributes, 'inert');
    this.checked = Object.hasOwn(attributes, 'checked');
    this.listeners = new Map();
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  matches(selectors) {
    return selectors.split(',').some(selector => {
      selector = selector.trim();
      if (selector === ':disabled') return this.disabled;
      const id = selector.match(/^#([\w-]+)$/);
      if (id) return this.id === id[1];
      const tag = selector.match(/^[a-z]+/i)?.[0];
      if (tag && this.tagName.toLowerCase() !== tag.toLowerCase()) return false;
      const attributes = [...selector.matchAll(/\[([\w-]+)(?:\s*=\s*["']?([^\]"']+)["']?)?\]/g)];
      if (!tag && attributes.length === 0) throw new Error(`Unsupported test selector: ${selector}`);
      return attributes.every(([, name, value]) => this.hasAttribute(name) && (value === undefined || this.getAttribute(name) === value));
    });
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
    return null;
  }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
}

function audioParam() {
  return {
    value: 0,
    values: [],
    setValueAtTime(value, time) { this.values.push({value, time}); this.value = value; },
    linearRampToValueAtTime(value, time) { this.values.push({value, time}); this.value = value; },
    exponentialRampToValueAtTime(value, time) { this.values.push({value, time}); this.value = value; },
    setTargetAtTime(value, time) { this.values.push({value, time}); this.value = value; },
    cancelScheduledValues() {},
  };
}

function browser({ values = new Map(), storageBlocked = false, unavailable = false, contextState = 'running', failure, deferredResume = false } = {}) {
  const contexts = [], oscillators = [], gains = [], writes = [], documentListeners = new Map(), windowListeners = new Map();
  const elements = [];
  let finishResume;
  const storage = {
    getItem(key) { if (storageBlocked) throw new Error('blocked storage'); return values.get(key) ?? null; },
    setItem(key, value) { if (storageBlocked) throw new Error('blocked storage'); writes.push(key); values.set(key, String(value)); },
  };
  class FakeAudioContext {
    constructor() {
      if (failure === 'constructor') throw new Error('audio device unavailable');
      this.state = contextState;
      this.currentTime = 10;
      this.destination = {};
      this.resumeCalls = 0;
      contexts.push(this);
    }
    createOscillator() {
      if (failure === 'oscillator') throw new Error('oscillator unavailable');
      const oscillator = {
        frequency: audioParam(),
        connections: [],
        starts: [],
        stops: [],
        disconnected: false,
        connect(target) { this.connections.push(target); return target; },
        disconnect() { this.disconnected = true; },
        start(time) { this.starts.push(time); },
        stop(time) { this.stops.push(time); },
        addEventListener(type, handler) { if (type === 'ended') this.onended = handler; },
      };
      oscillators.push(oscillator);
      return oscillator;
    }
    createGain() {
      if (failure === 'gain') throw new Error('gain unavailable');
      const gain = {
        gain: audioParam(),
        connections: [],
        disconnected: false,
        connect(target) { this.connections.push(target); return target; },
        disconnect() { this.disconnected = true; },
      };
      gains.push(gain);
      return gain;
    }
    resume() {
      this.resumeCalls += 1;
      if (failure === 'resume') return Promise.reject(new Error('resume disallowed'));
      if (deferredResume) return new Promise(resolve => { finishResume = () => { this.state = 'running'; resolve(); }; });
      this.state = 'running';
      return Promise.resolve();
    }
  }
  const document = {
    visibilityState: 'visible', hidden: false, readyState: 'complete',
    documentElement: new FakeElement('html'),
    addEventListener(type, handler, options) {
      const handlers = documentListeners.get(type) || [];
      handlers.push({handler, options});
      documentListeners.set(type, handlers);
    },
    getElementById(id) { return elements.find(element => element.id === id) || null; },
    querySelectorAll(selector) { return elements.filter(element => element.matches(selector)); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
  };
  const window = {
    document,
    addEventListener(type, handler) { windowListeners.set(type, handler); },
    AudioContext: unavailable ? undefined : FakeAudioContext,
  };
  Object.defineProperty(window, 'localStorage', {get() { if (storageBlocked) throw new Error('blocked storage'); return storage; }});
  vm.runInNewContext(soundSource, {window, document, Element: FakeElement, AudioContext: window.AudioContext, localStorage: storage, console, setTimeout, clearTimeout, performance});
  return {
    api: window.MinkiruSoundV342, window, document, contexts, oscillators, gains, writes, values, documentListeners,
    element(tagName, attributes, parent) { const element = new FakeElement(tagName, attributes, parent); elements.push(element); return element; },
    emit(type, target = document, extra = {}) {
      const event = {type, target, isTrusted: true, defaultPrevented: false, composedPath: () => [target], ...extra};
      for (const {handler} of documentListeners.get(type) || []) handler(event);
      for (const handler of target.listeners?.get(type) || []) handler(event);
    },
    resolveResume() { assert.equal(typeof finishResume, 'function', 'a pending resume should exist'); finishResume(); },
    hide() { document.hidden = true; document.visibilityState = 'hidden'; this.emit('visibilitychange'); },
  };
}

async function settle() { for (let index = 0; index < 8; index += 1) await Promise.resolve(); }
function started(b) { return b.oscillators.filter(oscillator => oscillator.starts.length); }

test('sound is enabled by default but loading the page creates no audio context or storage writes', () => {
  const values = new Map([['study-history', 'keep-existing-answers']]);
  const b = browser({values});
  assert.equal(b.api.isEnabled(), true);
  assert.equal(b.contexts.length, 0);
  assert.deepEqual(b.writes, []);
  assert.deepEqual([...values], [['study-history', 'keep-existing-answers']]);
});

test('a short action sound, two-note correct sound, and three-note best-answer sound use one context', async () => {
  const b = browser();
  await b.api.playAction(); await settle();
  assert.equal(started(b).length, 1);
  await b.api.playResult('〇'); await settle();
  assert.equal(started(b).length, 3);
  await b.api.playResult('○'); await settle();
  assert.equal(started(b).length, 5);
  await b.api.playResult('◎'); await settle();
  assert.equal(started(b).length, 8);
  assert.equal(b.contexts.length, 1);
  const correct = started(b).slice(1, 3), best = started(b).slice(5, 8);
  assert.ok(correct[1].starts[0] > correct[0].starts[0], 'correct notes should form a sequence');
  assert.ok(best[2].starts[0] > best[1].starts[0] && best[1].starts[0] > best[0].starts[0]);
  assert.ok(new Set(best.map(note => note.frequency.values[0]?.value ?? note.frequency.value)).size > 1, 'the best-answer sound should have a melody');
  for (const oscillator of started(b)) {
    assert.ok(oscillator.stops.length >= 1, 'every oscillator must have a finite scheduled stop');
    assert.ok(oscillator.stops[0] > oscillator.starts[0]);
    assert.ok(oscillator.stops[0] - oscillator.starts[0] < 1, 'sounds should remain short');
  }
});

test('partial, wrong, absent, and unknown result marks never initialize or play sound', async () => {
  const b = browser();
  for (const mark of ['△', '×', '', undefined, null, 'correct']) await b.api.playResult(mark);
  await settle();
  assert.equal(b.contexts.length, 0);
});

test('trusted button, tile, decision, link, summary, and form-control clicks each play once in capture phase', async () => {
  const b = browser();
  const clickListeners = b.documentListeners.get('click') || [];
  assert.ok(clickListeners.some(({options}) => options === true || options?.capture === true), 'capture is needed before handlers replace clicked DOM');
  const controls = [
    b.element('button'), b.element('button', {'data-tile': 'man1'}), b.element('button', {'data-call': 'pass'}),
    b.element('a', {href: '#book'}), b.element('summary'), b.element('div', {role: 'button'}),
    ...['button', 'submit', 'reset', 'checkbox', 'radio'].map(type => b.element('input', {type})),
  ];
  for (const [index, control] of controls.entries()) {
    b.emit('click', b.element('span', {}, control));
    await settle();
    assert.equal(started(b).length, index + 1, `one action sound for ${control.tagName} ${control.type}`);
  }
});

test('synthetic clicks, plain content, disabled controls, disabled ancestors, and inert descendants stay silent', async () => {
  const b = browser();
  b.emit('click', b.element('button'), {isTrusted: false});
  for (const target of [
    b.element('div'), b.element('a'), b.element('input', {type: 'text'}),
    b.element('button', {disabled: ''}), b.element('button', {'aria-disabled': 'true'}),
    b.element('span', {}, b.element('button', {disabled: ''})),
    b.element('button', {}, b.element('div', {inert: ''})),
    b.element('button', {}, b.element('div', {'aria-disabled': 'true'})),
  ]) b.emit('click', target);
  await settle();
  assert.equal(b.contexts.length, 0);
});

test('select changes sound once while toggle clicks stay silent and enabling gives one confirmation sound', async () => {
  const b = browser();
  const select = b.element('select');
  b.emit('click', select);
  assert.equal(b.contexts.length, 0);
  b.emit('change', select); await settle();
  assert.equal(started(b).length, 1);
  b.emit('change', select, {isTrusted: false}); await settle();
  assert.equal(started(b).length, 1);
  const toggle = b.element('input', {type: 'checkbox', id: 'soundToggleV342'});
  b.emit('click', toggle); await settle();
  assert.equal(started(b).length, 1);
  toggle.checked = false;
  b.emit('change', toggle); await settle();
  assert.equal(b.api.isEnabled(), false);
  assert.equal(started(b).length, 1);
  toggle.checked = true;
  b.emit('change', toggle); await settle();
  assert.equal(b.api.isEnabled(), true);
  assert.equal(started(b).length, 2);
});

test('muting persists across reloads without modifying other local learning data', async () => {
  const values = new Map([['study-history', 'keep-existing-answers']]);
  const b = browser({values});
  b.api.setEnabled(false);
  assert.equal(b.api.isEnabled(), false);
  assert.equal(values.get(storageKey), 'off');
  for (const mark of ['〇', '◎']) await b.api.playResult(mark);
  await b.api.playAction(); await settle();
  assert.equal(b.contexts.length, 0);
  const reloaded = browser({values});
  assert.equal(reloaded.api.isEnabled(), false);
  reloaded.api.setEnabled(true);
  assert.equal(values.get(storageKey), 'on');
  assert.equal(browser({values}).api.isEnabled(), true);
  assert.equal(values.get('study-history'), 'keep-existing-answers');
  assert.deepEqual(b.writes, [storageKey]);
  assert.deepEqual(reloaded.writes, [storageKey]);
});

test('settings markup exposes an accessible checkbox reflecting the saved preference', () => {
  const b = browser();
  const enabledMarkup = b.api.settingsMarkup();
  assert.match(enabledMarkup, /id=["']soundToggleV342["']/);
  assert.match(enabledMarkup, /type=["']checkbox["']/);
  assert.match(enabledMarkup, /checked/);
  assert.match(enabledMarkup, /操作音.*正解音/);
  assert.ok(/<label[\s>]/.test(enabledMarkup) || /aria-label=/.test(enabledMarkup));
  b.api.setEnabled(false);
  assert.doesNotMatch(b.api.settingsMarkup(), /\schecked(?:\s|=|>)/);
  assert.equal(b.contexts.length, 0);
});

test('blocked storage and unavailable audio never prevent interaction or preference changes', async () => {
  const blocked = browser({storageBlocked: true});
  assert.doesNotThrow(() => blocked.api.setEnabled(false));
  assert.equal(blocked.api.isEnabled(), false);
  assert.doesNotThrow(() => blocked.api.setEnabled(true));
  await assert.doesNotReject(async () => { await blocked.api.playAction(); await blocked.api.playResult('◎'); });
  const unsupported = browser({unavailable: true});
  await assert.doesNotReject(async () => { await unsupported.api.playAction(); await unsupported.api.playResult('〇'); });
  assert.equal(unsupported.contexts.length, 0);
});

test('context creation, graph creation, and rejected resume failures are swallowed', async () => {
  for (const failure of ['constructor', 'oscillator', 'gain', 'resume']) {
    const b = browser({failure, contextState: failure === 'resume' ? 'suspended' : 'running'});
    await assert.doesNotReject(async () => { await b.api.playAction(); await b.api.playResult('◎'); await settle(); }, failure);
    assert.doesNotThrow(() => b.api.setEnabled(false));
    assert.equal(started(b).length, 0);
  }
});

test('suspended and interrupted audio wait for resume before starting notes', async () => {
  for (const contextState of ['suspended', 'interrupted']) {
    const b = browser({contextState, deferredResume: true});
    b.api.playResult('〇');
    assert.equal(b.contexts.length, 1);
    assert.equal(b.contexts[0].resumeCalls, 1);
    assert.equal(started(b).length, 0);
    b.resolveResume(); await settle();
    assert.equal(started(b).length, 2);
  }
});

test('muting invalidates pending resume sounds even if sound is enabled again before resume completes', async () => {
  const b = browser({contextState: 'suspended', deferredResume: true});
  b.api.playResult('◎');
  b.api.setEnabled(false);
  b.api.setEnabled(true);
  b.resolveResume(); await settle();
  assert.equal(started(b).length, 0, 'an old confirmation must not play after a mute cycle');
  await b.api.playAction(); await settle();
  assert.equal(started(b).length, 1, 'fresh interactions should continue to work');
});

test('hiding the page stops scheduled notes and cancels pending resume playback', async () => {
  const b = browser();
  await b.api.playResult('◎'); await settle();
  assert.equal(started(b).length, 3);
  b.hide();
  assert.ok(started(b).every(note => note.stops.length > 1 || note.disconnected), 'all scheduled notes should stop when hidden');
  const pending = browser({contextState: 'suspended', deferredResume: true});
  pending.api.playAction();
  pending.hide(); pending.resolveResume(); await settle();
  assert.equal(started(pending).length, 0);
});

test('finished sounds disconnect their audio nodes and muting stops active notes', async () => {
  const b = browser();
  await b.api.playAction(); await settle();
  const note = started(b)[0];
  assert.equal(typeof note.onended, 'function', 'finished voices should have cleanup');
  note.onended();
  assert.equal(note.disconnected, true);
  assert.ok(b.gains.some(gain => gain.disconnected), 'the finished voice gain should be disconnected');
  await b.api.playResult('〇'); await settle();
  const active = started(b).slice(1);
  b.api.setEnabled(false);
  assert.ok(active.every(oscillator => oscillator.stops.length > 1 || oscillator.disconnected));
});

test('the app plays the scored result once on valid answer confirmation, never on re-render or repeated confirmation', () => {
  assert.match(html, /<script\b[^>]*src=["']sound-v342\.js\?v=\d+["']/);
  const confirm = html.match(/^      function confirmAnswerV41\([^\n]*\) \{[\s\S]*?^      \}/m)?.[0];
  assert.ok(confirm, 'answer confirmation function exists');
  assert.match(confirm, /MinkiruSoundV342[^\n]*playResult/);
  assert.equal((html.match(/\.playResult\s*\(/g) || []).length, 1, 'result audio belongs only to confirmation, not render functions');
  for (const decisionType of ['discard', 'call']) {
    const calls = [], state = {revealed: false, selected: 'man1'};
    let loggedIn = true, selectedAction = 'pass';
    const context = vm.createContext({
      window: {MinkiruSoundV342: {playResult(mark) { calls.push(mark); }}},
      state, SCENE: {decisionType},
      requireLoginForPlayV187: () => loggedIn,
      selectedCallActionV112: () => selectedAction,
      choiceScoreV16: () => ({mark: '◎'}),
      recordAnswerV16() {}, renderHandV16() {}, renderAnswerV16() {},
    });
    vm.runInContext(confirm, context);
    loggedIn = false; context.confirmAnswerV41(); assert.deepEqual(calls, []);
    loggedIn = true; state.selected = null; selectedAction = null; context.confirmAnswerV41(); assert.deepEqual(calls, []);
    state.selected = 'man1'; selectedAction = 'pass'; context.confirmAnswerV41();
    assert.deepEqual(calls, ['◎']);
    assert.equal(state.revealed, true);
    context.confirmAnswerV41(); assert.deepEqual(calls, ['◎']);
  }
});
