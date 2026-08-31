import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const sourceCode = await readFile(new URL("../public/library-v214.js", import.meta.url), "utf8");
const book = { canView: true, tone: "walnut", fullTitle: "ピエール問題集 第7巻", spineTitle: "ピエール問題集", volume: 7 };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

function environment({ reduced = false, animationError = false, modalError = false } = {}) {
  const clock = new Map();
  let clockId = 0;
  const effects = [];
  const windowEvents = new Map();
  let doc;
  class Element {
    constructor() { this.style = {}; this.attributes = new Map(); this.listeners = new Map(); this.isConnected = true; this.textContent = ""; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    hasAttribute(name) { return this.attributes.has(name); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    fire(name) { this.listeners.get(name)?.({ preventDefault() {} }); }
    getBoundingClientRect() { return { left: 360, top: 200, width: 88, height: 420 }; }
    getClientRects() { return [this.getBoundingClientRect()]; }
    focus() { doc.activeElement = this; }
    animate() {
      if (animationError) throw new Error("Animation not available");
      const effect = { finished: Promise.resolve(), cancelled: false, cancel() { this.cancelled = true; } };
      effects.push(effect);
      return effect;
    }
  }
  class Dialog extends Element {
    constructor() {
      super();
      this.open = false;
      this.nodes = new Map([".library-flight-skip", ".library-flight-volume", ".library-flight-cover", ".library-flight-caption", '[role="status"]'].map(key => [key, new Element()]));
    }
    showModal() {
      if (modalError) throw new Error("Native modal unavailable");
      this.open = true;
      doc.activeElement = this.querySelector(".library-flight-skip");
    }
    querySelector(selector) { return this.nodes.get(selector); }
    contains(element) { return [...this.nodes.values()].includes(element); }
    close() { this.open = false; doc.activeElement = doc.body; }
    remove() { doc.body.children = doc.body.children.filter(child => child !== this); this.isConnected = false; }
  }
  const heading = new Element();
  const source = new Element();
  source.style.visibility = "visible";
  doc = {
    body: { children: [], append(element) { this.children.push(element); } },
    activeElement: source,
    createElement: () => new Dialog(),
    getElementById: id => id === "menuTitle" ? heading : null
  };
  const host = {
    document: doc, Element, HTMLDialogElement: Dialog,
    innerWidth: 1440, innerHeight: 900,
    matchMedia: () => ({ matches: reduced }),
    addEventListener(name, callback) { windowEvents.set(name, callback); },
    removeEventListener(name) { windowEvents.delete(name); },
    setTimeout(callback, delay) { const id = ++clockId; clock.set(id, { callback, delay }); return id; },
    clearTimeout(id) { clock.delete(id); }
  };
  const context = vm.createContext({ window: host, console });
  vm.runInContext(sourceCode, context);
  return {
    library: host.MinkiruLibraryV214, source, doc, heading, clock, effects,
    fireWindow: name => windowEvents.get(name)?.(),
    tick(delay) { for (const [id, timer] of [...clock]) if (timer.delay === delay) { clock.delete(id); timer.callback(); } }
  };
}

test("V214 starts navigation once, then removes the effect and restores focus after the page opens", async () => {
  const env = environment();
  const network = deferred();
  let calls = 0;
  const pending = env.library.takeBook(book, env.source, () => { calls++; return network.promise; });
  await flush();
  assert.equal(calls, 1);
  assert.equal(env.doc.body.children.length, 1);
  assert.equal(env.source.style.visibility, "hidden");
  network.resolve(true);
  env.tick(1570);
  assert.equal(await pending, true);
  assert.equal(env.doc.body.children.length, 0);
  assert.equal(env.source.style.visibility, "visible");
  assert.equal(env.clock.size, 0);
  assert.equal(env.doc.activeElement, env.heading);
  assert.ok(env.effects.every(effect => effect.cancelled));
});

for (const eventName of ["click", "cancel", "popstate"]) {
  test(`V214 ${{click: "skip", cancel: "Escape", popstate: "browser Back"}[eventName]} releases the modal without cancelling the real navigation`, async () => {
    const env = environment();
    const network = deferred();
    let calls = 0;
    const pending = env.library.takeBook(book, env.source, () => { calls++; return network.promise; });
    const dialog = env.doc.body.children[0];
    if (eventName === "click") dialog.querySelector(".library-flight-skip").fire("click");
    else if (eventName === "popstate") env.fireWindow("popstate");
    else dialog.fire("cancel");
    await flush();
    assert.equal(env.doc.body.children.length, 0);
    assert.equal(env.source.style.visibility, "visible");
    assert.equal(calls, 1);
    // Do not steal focus when the user starts another operation after skipping.
    const laterFocus = { name: "a different control" };
    env.doc.activeElement = laterFocus;
    network.resolve(true);
    assert.equal(await pending, true);
    assert.equal(env.doc.activeElement, laterFocus);
  });
}

test("V214 falls back to normal loading after six seconds instead of trapping a slow network", async () => {
  const env = environment();
  const network = deferred();
  const pending = env.library.takeBook(book, env.source, () => network.promise);
  env.tick(1900);
  assert.match(env.doc.body.children[0].querySelector('[role="status"]').textContent, /準備しています/);
  env.tick(6000);
  await flush();
  assert.equal(env.doc.body.children.length, 0);
  network.resolve(true);
  assert.equal(await pending, true);
});

test("V214 failed navigation releases the modal, returns focus and propagates the real failure", async () => {
  const env = environment();
  const failure = new Error("offline");
  await assert.rejects(env.library.takeBook(book, env.source, () => Promise.reject(failure)), failure);
  assert.equal(env.doc.body.children.length, 0);
  assert.equal(env.doc.activeElement, env.source);
  assert.equal(env.source.style.visibility, "visible");
  assert.equal(env.clock.size, 0);
});

test("V214 rejected access (false) also releases all transient animation state", async () => {
  const env = environment();
  assert.equal(await env.library.takeBook(book, env.source, () => false), false);
  assert.equal(env.doc.body.children.length, 0);
  assert.equal(env.doc.activeElement, env.source);
  assert.equal(env.clock.size, 0);
});

for (const option of [{ reduced: true }, { animationError: true }, { modalError: true }]) {
  test(`V214 ${Object.keys(option)[0]} never prevents opening the requested collection`, async () => {
    const env = environment(option);
    let calls = 0;
    assert.equal(await env.library.takeBook(book, env.source, () => { calls++; return true; }), true);
    assert.equal(calls, 1);
    assert.equal(env.doc.body.children.length, 0);
    assert.equal(env.source.style.visibility, "visible");
    assert.equal(env.clock.size, 0);
  });
}

test("V214 permission-request entries do not play the learning transition", async () => {
  const env = environment();
  assert.equal(await env.library.takeBook({ ...book, canView: false }, env.source, () => true), true);
  assert.equal(env.doc.body.children.length, 0);
  assert.equal(env.effects.length, 0);
});

test("V214 dynamic titles remain text inside the book and modal", async () => {
  const env = environment();
  const pending = env.library.takeBook({ ...book, spineTitle: '<img src=x onerror="run()">問題集', fullTitle: '<script>run()</script>' }, env.source, () => true);
  const markup = env.doc.body.children[0].innerHTML;
  assert.ok(markup.includes("&lt;script&gt;run()&lt;/script&gt;"));
  assert.ok(markup.includes("&lt;img src=x onerror=&quot;run()&quot;&gt;"));
  assert.ok(!markup.includes("<script>"));
  env.tick(1570);
  await pending;
});
