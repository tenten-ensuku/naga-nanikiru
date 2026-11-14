import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function loadApi() {
  const host = { setTimeout, clearTimeout, matchMedia: () => ({ matches: false }) };
  const sandbox = { window: host, AbortController, queueMicrotask, setTimeout, clearTimeout, console };
  vm.runInNewContext(await readFile(new URL("../public/library-order-v215.js", import.meta.url), "utf8"), sandbox);
  host.MinkiruLibraryOrderV215 = sandbox.MinkiruLibraryOrderV215;
  vm.runInNewContext(await readFile(new URL("../public/library-v214.js", import.meta.url), "utf8"), sandbox);
  return host.MinkiruLibraryV214;
}

// Minimal DOM: dataset-based selectors only, enough for the controller's event wiring.
class Node {
  constructor(dataset = {}, className = "") {
    this.dataset = { ...dataset }; this.children = []; this.parentElement = null; this.listeners = new Map();
    const classes = new Set(className.split(/\s+/).filter(Boolean));
    this.classList = { contains: c => classes.has(c), toggle: (c, f) => { (f ?? !classes.has(c)) ? classes.add(c) : classes.delete(c); } };
    this.style = {};
  }
  append(...nodes) { for (const n of nodes) { if (n.parentElement) n.parentElement.children = n.parentElement.children.filter(c => c !== n); n.parentElement = this; this.children.push(n); } }
  matches(selector) {
    return String(selector).split(",").some(raw => {
      const value = raw.trim();
      if (value.startsWith(".")) return this.classList.contains(value.slice(1));
      const m = value.match(/^\[data-library-([a-z-]+)(?:="([^"]*)")?\]$/);
      if (!m) return false;
      const key = "library" + m[1].replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase());
      return key in this.dataset && (m[2] === undefined || String(this.dataset[key]) === m[2]);
    });
  }
  closest(s) { return this.matches(s) ? this : this.parentElement?.closest(s) || null; }
  querySelector(s) { if (this.matches(s)) return this; for (const c of this.children) { const f = c.querySelector(s); if (f) return f; } return null; }
  querySelectorAll(s) { const f = this.matches(s) ? [this] : []; for (const c of this.children) f.push(...c.querySelectorAll(s)); return f; }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  dispatch(type, event) { for (const l of this.listeners.get(type) || []) l({ stopPropagation() {}, preventDefault() {}, ...event }); }
  setAttribute(n, v) { this[n] = String(v); }
  removeAttribute(n) { delete this[n]; }
  focus() {} scrollIntoView() {}
}

const pierreVolumes = [1, 2, 3].map(n => ({
  share_slug: `pierre-${n}`, title: `ピエール問題集 第${n}巻`, display_title: `ピエール問題集 第${n}巻`,
  volume_number: n, question_count: 200, can_view: true, series_parent_slug: "pierre"
}));
const pierre = { share_slug: "pierre", title: "ピエール問題集", series_title: "ピエール問題集", is_series_parent: true, series_key: "p", volume_count: 3, can_view: true, owner_id: "other" };
const progress = [{ volume_number: 1, answered_count: 200, question_count: 200 }, { volume_number: 2, answered_count: 50, question_count: 200 }, { volume_number: 3, answered_count: 0, question_count: 200 }];
const mine = { share_slug: "mine", title: "リーチ判断", can_view: true, question_count: 30, owner_id: "me", description: "" };
const kuni = { share_slug: "kuni", title: "くにたそ問題集", can_view: true, question_count: 120, owner_id: "other" };

async function shelf(current = null) {
  const api = await loadApi();
  const opened = [];
  const hidden = [];
  const controller = api.create({
    canOpen: () => true,
    loadSeries: async () => ({ volumes: pierreVolumes, progress }),
    onOpen: slug => { opened.push(slug); return true; },
    saveHiddenBooks: (_, ids) => hidden.splice(0, hidden.length, ...ids)
  });
  const ctx = { userId: "me", collections: [pierre, mine, kuni], current, currentMetrics: null, loading: false, error: "" };
  controller.render(ctx);
  await controller.browseSeries("pierre");
  return { controller, ctx, opened, hidden, html: controller.render(ctx) };
}

function mount(controller, html) {
  const root = new Node();
  const surface = new Node({}, "library-v214");
  const rail = new Node({ libraryRail: "" });
  const detail = new Node({ libraryDetail: "" });
  const buttons = [...html.matchAll(/data-library-book="([^"]+)" data-library-unit="([^"]+)"/g)]
    .map(m => new Node({ libraryBook: m[1], libraryUnit: m[2] }));
  rail.append(...buttons);
  surface.append(rail, detail);
  root.append(surface);
  controller.mount(root);
  return { root, buttons, detail };
}

test("V361 a series is one spine that stands for the first unfinished volume", async () => {
  const { html } = await shelf();
  assert.equal((html.match(/data-library-unit="pierre"/g) || []).length, 1);
  assert.match(html, /data-library-book="pierre-2" data-library-unit="pierre"/);
  assert.match(html, /全3巻/);
  assert.match(html, /class="library-shelf-total">3冊/);
});

test("V361 shelves split into the user's own books and everyone else's", async () => {
  const { html } = await shelf();
  assert.match(html, /library-tier-title-v361">自分の本<small>1冊/);
  assert.match(html, /library-tier-title-v361">みんなの本<small>2冊/);
  assert.ok(html.indexOf('data-library-tier="mine"') < html.indexOf('data-library-book="mine"'));
  assert.ok(html.indexOf('data-library-tier="shared"') < html.indexOf('data-library-book="kuni"'));
});

test("V364 other people's private books get their own shelf and a notice; the user's own books stay together", async () => {
  const api = await loadApi();
  const controller = api.create({ canOpen: () => true, loadSeries: async () => ({ volumes: pierreVolumes, progress }) });
  const ctx = { userId: "me", currentMetrics: null, loading: false, error: "", current: null, collections: [
    { ...pierre, owner_id: "other", visibility: "private" },
    { ...mine, visibility: "public" },
    { share_slug: "memo", title: "自分用メモ", can_view: true, owner_id: "me", visibility: "private" },
    { share_slug: "friend", title: "友人の公開本", can_view: true, owner_id: "other", visibility: "public" },
    { share_slug: "secret", title: "友人の非公開本", can_view: true, owner_id: "other", visibility: "private" }
  ] };
  controller.render(ctx);
  await controller.browseSeries("pierre");
  const html = controller.render(ctx);
  const tier = id => html.slice(html.indexOf(`data-library-tier="${id}"`), html.indexOf("library-plank-v361", html.indexOf(`data-library-tier="${id}"`)));
  assert.match(html, /library-tier-title-v361">プライベート（他の人の非公開）<small>2冊/);
  assert.match(tier("private"), /data-library-unit="pierre"/, "a private series inherits its parent's visibility");
  assert.match(tier("private"), /data-library-book="secret"/);
  assert.match(tier("mine"), /data-library-book="mine"/);
  assert.match(tier("mine"), /data-library-book="memo"/, "the user's own private book stays with their books");
  assert.match(tier("shared"), /data-library-book="friend"/);
  assert.ok(html.indexOf('data-library-tier="mine"') < html.indexOf('data-library-tier="shared"'));
  assert.ok(html.indexOf('data-library-tier="shared"') < html.indexOf('data-library-tier="private"'));
  const view = mount(controller, html);
  view.root.dispatch("click", { target: view.buttons.find(b => b.dataset.libraryBook === "secret"), detail: 1 });
  assert.match(view.detail.innerHTML, /library-private-note-v364[^>]*>作成者が非公開にしている本です/);
  view.root.dispatch("click", { target: view.buttons.find(b => b.dataset.libraryBook === "memo"), detail: 1 });
  assert.doesNotMatch(view.detail.innerHTML, /library-private-note-v364/);
});

test("V363 a separately created volume 0 joins its series only on an exact creator and title match", async () => {
  const api = await loadApi();
  const volumes = [1, 2].map(n => ({ share_slug: `akushu-${n}`, title: n === 1 ? "アナンタ　悪手まとめ 第1巻" : `アナンタ　悪手まとめ2 第${n}巻`, volume_number: n, question_count: 200, can_view: true, series_parent_slug: "akushu" }));
  const root = { share_slug: "akushu", title: "アナンタ　悪手まとめ2", series_title: "アナンタ　悪手まとめ2", is_series_parent: true, series_key: "s", volume_count: 2, can_view: true, owner_id: "shelby", visibility: "private" };
  const zero = { share_slug: "akushu-0", title: "アナンタ　悪手まとめ 第0巻", can_view: true, question_count: 195, owner_id: "shelby", visibility: "private" };
  const stranger = { share_slug: "copy-0", title: "アナンタ　悪手まとめ 第0巻", can_view: true, owner_id: "someone", visibility: "public" };
  const other = { share_slug: "other-0", title: "別の本 第0巻", can_view: true, owner_id: "shelby" };
  const controller = api.create({ canOpen: () => true, loadSeries: async () => ({ volumes, progress: [] }) });
  const ctx = { userId: "me", currentMetrics: null, loading: false, error: "", current: null, collections: [root, zero, stranger, other] };
  controller.render(ctx);
  await controller.browseSeries("akushu");
  const html = controller.render(ctx);
  assert.equal((html.match(/data-library-unit="akushu"/g) || []).length, 1);
  assert.match(html, /全3巻/);
  assert.doesNotMatch(html, /data-library-unit="akushu-0"/);
  assert.match(html, /data-library-unit="copy-0"/, "another creator's copy stays separate");
  assert.match(html, /data-library-unit="other-0"/, "a different title stays separate");
  const view = mount(controller, html);
  view.root.dispatch("click", { target: view.buttons.find(b => b.dataset.libraryUnit === "akushu"), detail: 1 });
  const picker = view.detail.innerHTML.match(/data-library-volume="([^"]+)"/g).map(s => s.slice(21, -1));
  assert.deepEqual(picker, ["akushu-0", "akushu-1", "akushu-2"]);
  assert.match(view.detail.innerHTML, /aria-label="第0巻/);
});

test("V361 picking a volume in the detail retargets the series spine and opens that volume", async () => {
  const { controller, html, opened } = await shelf();
  const view = mount(controller, html);
  const spine = view.buttons.find(b => b.dataset.libraryUnit === "pierre");
  view.root.dispatch("click", { target: spine, detail: 1 });
  assert.match(view.detail.innerHTML, /data-library-volume="pierre-3"/);
  assert.match(view.detail.innerHTML, /data-library-volume="pierre-1"[^>]*aria-label="第1巻（完了）"/);
  view.root.dispatch("click", { target: new Node({ libraryVolume: "pierre-3" }) });
  assert.equal(spine.dataset.libraryBook, "pierre-3");
  assert.match(view.detail.innerHTML, /ピエール問題集 第3巻/);
  view.root.dispatch("click", { target: new Node({ libraryOpen: "pierre-3" }), detail: 1 });
  await new Promise(r => setImmediate(r));
  assert.deepEqual(opened, ["pierre-3"]);
});

test("V361 no filler description and no generated copy for an empty description", async () => {
  const { controller, html } = await shelf();
  const view = mount(controller, html);
  view.root.dispatch("click", { target: view.buttons.find(b => b.dataset.libraryBook === "mine"), detail: 1 });
  assert.doesNotMatch(view.detail.innerHTML, /引き出し|一歩ずつ|しましょう|もう1回タップ|引き継ぎます/);
  assert.doesNotMatch(view.detail.innerHTML, /<p><\/p>/);
});

test("V361 hiding a series hides every volume instead of letting the spine reappear", async () => {
  const { controller, html, hidden } = await shelf();
  mount(controller, html).root.dispatch("click", { target: new Node({ libraryHide: "pierre-2" }) });
  assert.deepEqual([...hidden].sort(), ["pierre-1", "pierre-2", "pierre-3"]);
});

test("V361 resume card opens the current book directly", async () => {
  const { html } = await shelf({ share_slug: "kuni" });
  assert.match(html, /library-resume-v361[\s\S]*くにたそ問題集[\s\S]*data-library-open="kuni"[^>]*>続きを解く/);
  const none = (await shelf()).html;
  assert.doesNotMatch(none, /library-resume-v361/);
});

test("V361 shelf header drops the double-tap instruction and storage notes", async () => {
  const { html } = await shelf();
  assert.doesNotMatch(html, /もう一度で開く|このブラウザーに保存|7日以内の未確認/);
  assert.match(html, /<details class="library-menu-v361" data-library-menu>/);
});

test("V361 shelf CSS keeps readable sizes", async () => {
  const css = await readFile(new URL("../public/library-shelf-v361.css", import.meta.url), "utf8");
  const sizes = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
  assert.ok(sizes.length > 0);
  assert.ok(sizes.every(size => size >= 13), `small sizes: ${sizes.filter(s => s < 13)}`);
});
