import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const LIBRARY_PATH = new URL("../public/library-v214.js", import.meta.url);
const INDEX_PATH = new URL("../public/index.html", import.meta.url);

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

async function loadLibraryApi() {
  const source = await readFile(LIBRARY_PATH, "utf8");
  const host = {
    document: { createElement: () => new FakeNode(), body: new FakeNode() },
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout
  };
  const sandbox = {
    window: host,
    AbortController,
    ResizeObserver: FakeResizeObserver,
    queueMicrotask,
    setTimeout,
    clearTimeout,
    console
  };
  const orderSource = await readFile(new URL("../public/library-order-v215.js", import.meta.url), "utf8");
  vm.runInNewContext(orderSource, sandbox);
  host.MinkiruLibraryOrderV215 = sandbox.MinkiruLibraryOrderV215;
  vm.runInNewContext(source, sandbox, { filename: String(LIBRARY_PATH) });
  return sandbox.window.MinkiruLibraryV214;
}

let libraryApiPromise;
const libraryApi = () => libraryApiPromise ||= loadLibraryApi();

class FakeNode {
  constructor({ className = "", dataset = {} } = {}) {
    this.className = className;
    this.dataset = { ...dataset };
    this.children = [];
    this.parentElement = null;
    this.isConnected = true;
    this.hidden = false;
    this.disabled = false;
    this.style = {};
    this.scrollLeft = 0;
    this.scrollWidth = 100;
    this.clientWidth = 100;
    this.listeners = new Map();
    const classes = new Set(className.split(/\s+/).filter(Boolean));
    this.classList = {
      contains: name => classes.has(name),
      toggle: (name, force) => {
        if (force === undefined ? !classes.has(name) : force) classes.add(name);
        else classes.delete(name);
      }
    };
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node.parentElement) node.parentElement.children = node.parentElement.children.filter(child => child !== node);
      node.parentElement = this;
      this.children.push(node);
    }
  }

  matches(selector) {
    return String(selector).split(",").some(raw => {
      const value = raw.trim();
      if (value.startsWith(".")) return this.classList.contains(value.slice(1));
      const match = value.match(/^\[data-library-([a-z-]+)(?:="([^"]*)")?\]$/);
      if (!match) return false;
      const key = `library${match[1].replace(/-([a-z])/g, (_, character) => character.toUpperCase()).replace(/^([a-z])/, (_, character) => character.toUpperCase())}`;
      return Object.prototype.hasOwnProperty.call(this.dataset, key)
        && (match[2] === undefined || String(this.dataset[key]) === match[2]);
    });
  }

  closest(selector) {
    return this.matches(selector) ? this : this.parentElement?.closest(selector) || null;
  }

  querySelector(selector) {
    if (this.matches(selector)) return this;
    for (const child of this.children) {
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector) {
    const found = this.matches(selector) ? [this] : [];
    for (const child of this.children) found.push(...child.querySelectorAll(selector));
    return found;
  }

  addEventListener(type, listener, options = {}) {
    if (options.signal?.aborted) return;
    const entries = this.listeners.get(type) || [];
    entries.push({ listener, options });
    this.listeners.set(type, entries);
    options.signal?.addEventListener("abort", () => this.removeEventListener(type, listener), { once: true });
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(entry => entry.listener !== listener));
  }

  dispatch(type, event = {}) {
    const dispatched = {
      ...event,
      target: event.target || this,
      currentTarget: this,
      stopPropagation() { this.stopped = true; },
      preventDefault() { this.defaultPrevented = true; }
    };
    for (const { listener } of [...(this.listeners.get(type) || [])]) listener(dispatched);
    return dispatched;
  }

  setAttribute(name, value) { this[name] = String(value); }
  removeAttribute(name) { delete this[name]; }
  focus() { this.focused = true; }
  scrollIntoView() {}
  scrollBy({ left = 0 } = {}) { this.scrollLeft += left; }
  setPointerCapture(id) { this.capturedPointer = id; }
  releasePointerCapture() { this.capturedPointer = null; }
  getBoundingClientRect() {
    const index = this.parentElement ? this.parentElement.children.indexOf(this) : 0;
    const left = 10 + index * 40;
    return { left, right: left + 36, top: 100, bottom: 340, width: 36, height: 240 };
  }
  cloneNode() { return new FakeNode({ className: this.className, dataset: this.dataset }); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
}

function mountedRoot({ bookSlug = "", retry = false } = {}) {
  const surface = new FakeNode({ className: "library-v214 is-catalogue" });
  const rail = new FakeNode({ dataset: { libraryRail: "" } });
  const detail = new FakeNode({ dataset: { libraryDetail: "" } });
  surface.append(rail, detail);
  const book = bookSlug ? new FakeNode({ dataset: { libraryBook: bookSlug } }) : null;
  const retryButton = retry ? new FakeNode({ dataset: { libraryRetry: "" } }) : null;
  if (book) surface.append(book);
  if (retryButton) surface.append(retryButton);
  const root = new FakeNode();
  root.append(surface);
  return { root, book, retryButton };
}

function deferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function nextTurn() {
  return new Promise(resolvePromise => setImmediate(resolvePromise));
}

function series(slug, title = slug) {
  return {
    share_slug: slug,
    title,
    display_title: title,
    series_title: title,
    is_series_parent: true,
    series_key: slug,
    volume_count: 2,
    can_view: true
  };
}

function volume(slug, number, title = slug) {
  return {
    share_slug: slug,
    title,
    display_title: title,
    volume_number: number,
    question_count: 100,
    can_view: true
  };
}

function context(userId, collections, current = null) {
  return { userId, collections, current, currentMetrics: null, loading: false, error: "" };
}

async function loadAdapterOptions() {
  const source = await readFile(INDEX_PATH, "utf8");
  const start = source.indexOf("      function getCollectionLibraryV214() {");
  const end = source.indexOf("      function collectionLibraryMetricsV214() {", start);
  assert.ok(start >= 0 && end > start, "index.html adapter markers must remain extractable");
  const snippet = source.slice(start, end);
  const sandbox = {
    __navigate: () => Promise.resolve(true),
    __window: {
      NagaSupabase: {},
      MinkiruLibraryV214: {
        create(options) {
          sandbox.__capturedOptions = options;
          return { render() { return ""; }, mount() {}, unmount() {} };
        }
      }
    },
    __capturedOptions: null,
    document: { querySelector: () => ({}) },
    console
  };
  const harness = `
    let collectionLibraryControllerV214 = null;
    let menuViewV16 = "collections";
    let sharedCollectionV46 = null;
    let collectionVolumesV180 = [];
    let collectionVolumeProgressV180 = [];
    let collectionVolumesErrorV180 = "";
    let supabaseSessionV46 = { user: { id: "test-user" } };
    const window = globalThis.__window;
    function requireLoginForPlayV187() { return Boolean(supabaseSessionV46?.user?.id); }
    function isSeriesParentCollectionV180() { return false; }
    function renderMenuCardsV16() {}
    function showMenuV16() {}
    function navigateToCollectionV106(slug) { return globalThis.__navigate(slug); }
    ${snippet}
    globalThis.getCollectionLibraryV214 = getCollectionLibraryV214;
    globalThis.getLibraryOptions = () => globalThis.__capturedOptions;
    globalThis.setTestSession = session => { supabaseSessionV46 = session; };
  `;
  vm.runInNewContext(harness, sandbox, { filename: String(INDEX_PATH) });
  sandbox.getCollectionLibraryV214();
  return { options: sandbox.getLibraryOptions(), sandbox };
}

test("V214 adapter batches only the selected series metadata, never the full question payload", async () => {
  const { options, sandbox } = await loadAdapterOptions();
  const calls = [];
  sandbox.__window.NagaSupabase = {
    loadCollectionVolumes: async slug => {
      calls.push(["volumes", slug]);
      return [volume("series-a-1", 1, "A 1")];
    },
    loadCollectionVolumeProgress: async slug => {
      calls.push(["progress", slug]);
      return [{ volume_number: 1, answered_count: "4.9" }];
    }
  };
  const loaded = await options.loadSeries("series-a");
  assert.deepEqual(calls.sort((left, right) => left[0].localeCompare(right[0])), [["progress", "series-a"], ["volumes", "series-a"]]);
  assert.equal(loaded.volumes[0].share_slug, "series-a-1");
  assert.equal(loaded.progress[0].answered_count, "4.9");
  assert.equal(loaded.progressError, false);
  sandbox.__navigate = async slug => `navigated:${slug}`;
  assert.equal(await options.onOpen("series-a-1"), "navigated:series-a-1");
});

test("render escapes untrusted book metadata", async () => {
  const api = await libraryApi();
  const controller = api.create({ canOpen: () => true });
  const dangerous = `<img src=x onerror="boom">&"'`;
  const html = controller.render({
    userId: "",
    collections: [{ share_slug: "safe", title: dangerous, display_title: dangerous, can_view: true }],
    current: null
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=&quot;boom&quot;&gt;&amp;&quot;&#39;/);
});

test("normalises real count values and keeps volume children out of catalogue roots", async () => {
  const api = await libraryApi();
  const book = api.normaliseBook(
    { share_slug: "v1", title: "Volume", volume_number: "2.9", question_count: "12.9" },
    "",
    { answered_count: "99.9", mastered_count: "42.9" }
  );
  assert.equal(book.volume, 2);
  assert.equal(book.questionCount, 12);
  assert.equal(book.answeredCount, 12);
  assert.equal(book.mastery, 100);
  const invalid = api.normaliseBook({ share_slug: "bad", title: "Bad", question_count: "NaN" }, "", { answered_count: "4.8" });
  assert.equal(invalid.questionCount, null);
  assert.equal(invalid.answeredCount, 4);
  const roots = api.catalogueRoots([
    series("series-a", "Series A"),
    { ...volume("series-a-1", 1), series_parent_id: "series-a", series_parent_slug: "series-a" }
  ]);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].share_slug, "series-a");
});

test("V215 late series results remain together on one flat bookshelf", async () => {
  const api = await libraryApi();
  const pending = new Map();
  const controller = api.create({
    canOpen: () => true,
    loadSeries: slug => {
      const request = deferred();
      pending.set(slug, request);
      return request.promise;
    }
  });
  const seriesA = series("series-a", "Series A");
  const seriesB = series("series-b", "Series B");
  const contextA = context("user-1", [seriesA, seriesB]);
  const contextB = context("user-1", [seriesA, seriesB]);
  controller.render(contextA);
  const requestA = controller.browseSeries("series-a");
  controller.render(contextB);
  const requestB = controller.browseSeries("series-b");
  await nextTurn();
  pending.get("series-b").resolve({ volumes: [volume("series-b-1", 1, "B 1")], progress: [] });
  assert.equal(await requestB, true);
  pending.get("series-a").resolve({ volumes: [volume("series-a-1", 1, "A late")], progress: [] });
  assert.equal(await requestA, true);
  const html = controller.render(contextB);
  assert.match(html, /series-b-1/);
  assert.match(html, /series-a-1/);
  assert.doesNotMatch(html, /is-front/);
});

test("failed series load can be retried through the mounted retry hook", async () => {
  const api = await libraryApi();
  const current = context("user-1", [series("series-a", "Series A")]);
  let attempts = 0;
  let controller;
  controller = api.create({
    canOpen: () => true,
    isVisible: () => true,
    onRender: () => controller.render(current),
    loadSeries: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary metadata failure");
      return { volumes: [volume("series-a-1", 1, "Recovered")], progress: [] };
    }
  });
  controller.render(current);
  assert.equal(await controller.browseSeries("series-a"), false);
  assert.match(controller.render(current), /一部の件数・進捗を読み込めませんでした/);
  assert.match(controller.render(current), /data-library-retry/);
  const mounted = mountedRoot({ retry: true });
  controller.mount(mounted.root);
  mounted.root.dispatch("click", { target: mounted.retryButton });
  await nextTurn();
  assert.equal(attempts, 2);
  assert.match(controller.render(current), /series-a-1/);
});

test("two clicks while navigation is pending call onOpen once", async () => {
  const api = await libraryApi();
  const navigation = deferred();
  let navigationCalls = 0;
  const controller = api.create({
    canOpen: () => true,
    onOpen: async slug => {
      navigationCalls += 1;
      assert.equal(slug, "book-1");
      await navigation.promise;
      return true;
    }
  });
  const current = context("user-1", [{ share_slug: "book-1", title: "Book 1", can_view: true }]);
  controller.render(current);
  const mounted = mountedRoot({ bookSlug: "book-1" });
  controller.mount(mounted.root);
  mounted.root.dispatch("click", { target: mounted.book });
  mounted.root.dispatch("click", { target: mounted.book });
  assert.equal(navigationCalls, 1);
  navigation.resolve(true);
  await nextTurn();
});

test("switching users invalidates old in-flight/cache data", async () => {
  const api = await libraryApi();
  const requests = [];
  const controller = api.create({ canOpen: () => true, loadSeries: slug => {
    const request = deferred();
    requests.push({ slug, request });
    return request.promise;
  }});
  const parent = series("series-a", "Series A");
  const userA = context("user-a", [parent]);
  const userB = context("user-b", [parent]);
  controller.render(userA);
  const oldRequest = controller.browseSeries("series-a");
  controller.render(userB);
  await nextTurn();
  requests[0].request.resolve({ volumes: [volume("user-a-volume", 1, "A private")], progress: [] });
  assert.equal(await oldRequest, false);
  assert.doesNotMatch(controller.render(userB), /user-a-volume/);
  const newRequest = controller.browseSeries("series-a");
  await nextTurn();
  requests[1].request.resolve({ volumes: [volume("user-b-volume", 1, "B private")], progress: [] });
  assert.equal(await newRequest, true);
  const html = controller.render(userB);
  assert.match(html, /user-b-volume/);
  assert.doesNotMatch(html, /user-a-volume/);
});

test("adapter keeps legacy fallback, controller mount/unmount hooks, and navigation reset contract", async () => {
  const [index, library] = await Promise.all([readFile(INDEX_PATH, "utf8"), readFile(LIBRARY_PATH, "utf8")]);
  assert.match(index, /library-v214\.js\?v=217/);
  const renderStart = index.indexOf("function renderCollectionChooserV165");
  const renderEnd = index.indexOf("function renderCollectionSpacePanelV100", renderStart);
  const renderer = index.slice(renderStart, renderEnd);
  assert.match(renderer, /if \(!library\) return renderCollectionChooserLegacyV165\(\);/);
  assert.match(index, /getCollectionLibraryV214\(\)\?\.mount\(grid\)/);
  assert.match(library, /return \{ render, mount, unmount, browseSeries, openBook, invalidate \}/);

  const navigationStart = index.indexOf("function navigateToCollectionV106");
  const navigationEnd = index.indexOf("function captureCollectionCreateDraftV114", navigationStart);
  const navigation = index.slice(navigationStart, navigationEnd);
  assert.match(navigation, /return switchCollectionInPlaceV177/);
  assert.match(navigation, /\.finally\(async \(\) => \{[\s\S]*collectionNavigationPendingV165 = false/);

  const switchStart = index.indexOf("async function switchCollectionInPlaceV177");
  const switchEnd = index.indexOf("function navigateToCollectionV106", switchStart);
  const switching = index.slice(switchStart, switchEnd);
  assert.match(switching, /catch \(error\) \{[\s\S]*sharedCollectionV46 = previousCollection/);
  assert.match(switching, /window\.history\.replaceState\(\{\}, "", previousUrl\)/);
});

test("V214 anonymous visitors neither preload volume metadata nor open books", async () => {
  const api = await libraryApi();
  let reads = 0;
  let opens = 0;
  const parent = series("series-a");
  const controller = api.create({ canOpen: () => true, loadSeries: () => { reads++; return {}; }, onOpen: () => { opens++; } });
  controller.render(context("", [parent], parent));
  controller.mount(mountedRoot().root);
  await nextTurn();
  assert.equal(await controller.browseSeries("series-a"), false);
  assert.equal(await controller.openBook("series-a"), false);
  assert.equal(reads, 0);
  assert.equal(opens, 0);
});

test("V214 a session revoked after rendering blocks both series browsing and opening", async () => {
  const api = await libraryApi();
  let reads = 0;
  let opens = 0;
  const controller = api.create({ canOpen: () => false, loadSeries: () => { reads++; }, onOpen: () => { opens++; } });
  controller.render(context("previous-user", [series("series-a"), { share_slug: "book", title: "Book", can_view: true }]));
  assert.equal(await controller.openBook("series-a"), false);
  assert.equal(await controller.openBook("book"), false);
  assert.equal(await controller.browseSeries("series-a"), false);
  assert.equal(reads + opens, 0);
});

test("V214 the real adapter also checks authentication before invoking its existing APIs", async () => {
  const { options, sandbox } = await loadAdapterOptions();
  let calls = 0;
  sandbox.__window.NagaSupabase = { loadCollectionVolumes() { calls++; }, loadCollectionVolumeProgress() { calls++; } };
  sandbox.__navigate = () => { calls++; };
  sandbox.setTestSession(null);
  await assert.rejects(options.loadSeries("series-a"), /Discordログインが必要/);
  assert.equal(await options.onOpen("book"), false);
  assert.equal(calls, 0);
});

test("V214 synchronous metadata errors do not leave a stuck in-flight entry", async () => {
  const api = await libraryApi();
  let calls = 0;
  const controller = api.create({ loadSeries() {
    calls++;
    if (calls === 1) throw new Error("sync failure");
    return { volumes: [volume("volume-1", 1)], progress: [] };
  }});
  const current = context("user", [series("series-a")]);
  controller.render(current);
  assert.equal(await controller.browseSeries("series-a"), false);
  assert.equal(await controller.browseSeries("series-a", { force: true }), true);
  assert.equal(calls, 2);
  assert.match(controller.render(current), /volume-1/);
});

test("V214 a late response from before logout is ignored even when the same user logs back in", async () => {
  const api = await libraryApi();
  const response = deferred();
  const parent = series("series-a");
  const user = context("same-user", [parent]);
  const controller = api.create({ loadSeries: () => response.promise });
  controller.render(user);
  const pending = controller.browseSeries("series-a");
  controller.render(context("", [parent]));
  controller.render(user);
  response.resolve({ volumes: [volume("stale-private-volume", 1)], progress: [] });
  assert.equal(await pending, false);
  assert.doesNotMatch(controller.render(user), /stale-private-volume/);
});

test("V215 leaving study refreshes cached progress and keeps metadata-only series loading", async () => {
  const api = await libraryApi();
  const current = context("user", [series("series-a"), series("series-b")]);
  const calls = [];
  const controller = api.create({ loadSeries: slug => {
    calls.push(slug);
    return { volumes: [volume(slug + "-1", 1)], progress: [{ volume_number: 1, answered_count: calls.filter(item => item === slug).length, mastered_count: 1 }] };
  }});
  controller.render(current);
  await controller.browseSeries("series-a");
  controller.render(current);
  controller.mount(mountedRoot().root);
  await controller.browseSeries("series-a");
  assert.equal(calls.filter(slug => slug === "series-a").length, 1);
  controller.unmount();
  controller.render(current);
  await controller.browseSeries("series-a");
  assert.equal(calls.filter(slug => slug === "series-a").length, 2);
  assert.match(controller.render(current), /2<small>問/);
});

test("V214 unavailable progress never hides otherwise accessible volumes or invents a zero", async () => {
  const api = await libraryApi();
  const current = context("user", [series("series-a")]);
  const controller = api.create({ loadSeries: () => ({ volumes: [volume("volume-1", 1)], progressError: true }) });
  controller.render(current);
  assert.equal(await controller.browseSeries("series-a"), true);
  const html = controller.render(current);
  assert.match(html, /data-library-book="volume-1"/);
  assert.match(html, /一部の件数・進捗を読み込めませんでした/);
  assert.match(html, /回答済み<\/dt><dd>—/);
});

test("V214 navigation can be retried after an exception", async () => {
  const api = await libraryApi();
  let opens = 0;
  const controller = api.create({ onOpen: () => { if (++opens === 1) throw new Error("try again"); return true; } });
  controller.render(context("user", [{ share_slug: "book", title: "Book", can_view: true }]));
  assert.equal(await controller.openBook("book"), false);
  assert.equal(await controller.openBook("book"), true);
  assert.equal(opens, 2);
});

test("V214 reopening the library follows the newly active collection instead of an old series", async () => {
  const api = await libraryApi();
  const parent = series("series-a");
  const other = { share_slug: "other", title: "Other book", can_view: true };
  const controller = api.create({ loadSeries: () => ({ volumes: [volume("volume-a", 1)], progress: [] }) });
  controller.render(context("user", [parent, other], parent));
  await controller.browseSeries("series-a");
  assert.match(controller.render(context("user", [parent, other], parent)), /data-library-book="volume-a"/);
  controller.unmount();
  const html = controller.render(context("user", [parent, other], other));
  assert.match(html, /has-volumes/);
  assert.match(html, /libraryDetailTitleV214">Other book/);
  assert.match(html, /data-library-book="volume-a"/);
});

test("V214 permission refresh drops cached volumes and ignores older responses", async () => {
  const api = await libraryApi();
  const response = deferred();
  const parent = series("series-a");
  const controller = api.create({ loadSeries: () => response.promise });
  controller.render(context("user", [parent]));
  const pending = controller.browseSeries("series-a");
  controller.invalidate();
  const denied = context("user", [{ ...parent, can_view: false }]);
  controller.render(denied);
  response.resolve({ volumes: [volume("revoked-volume", 1)], progress: [] });
  assert.equal(await pending, false);
  const html = controller.render(denied);
  assert.match(html, /閲覧権限を確認する/);
  assert.doesNotMatch(html, /data-library-book="revoked-volume"/);
});

test("V214 even a cached series disappears immediately when its parent loses access", async () => {
  const api = await libraryApi();
  const parent = series("series-a");
  const controller = api.create({ loadSeries: () => ({ volumes: [volume("private-volume", 1)], progress: [] }) });
  controller.render(context("user", [parent]));
  await controller.browseSeries("series-a");
  const html = controller.render(context("user", [{ ...parent, can_view: false }]));
  assert.match(html, /has-volumes/);
  assert.doesNotMatch(html, /data-library-book="private-volume"/);
});

async function navigationHarness() {
  const html = await readFile(INDEX_PATH, "utf8");
  const start = html.indexOf("      function navigateToCollectionV106(");
  const end = html.indexOf("      function captureCollectionCreateDraftV114(", start);
  const window = { location: { href: "https://example.test/?collection=a" }, history: {} };
  const historyWrites = [];
  for (const kind of ["pushState", "replaceState"]) window.history[kind] = (_state, _title, url) => { historyWrites.push({ kind, url }); window.location.href = url; };
  const loads = [];
  const sandbox = {
    window, URL, console,
    document: { querySelector: () => ({ classList: { add() {}, remove() {} } }), querySelectorAll: () => [] },
    __load(slug) { const request = deferred(); loads.push({ slug, ...request }); return request.promise; },
  };
  vm.runInNewContext(`
    let collectionNavigationPendingV165 = false;
    let sharedCollectionV46 = {share_slug:"a"};
    let menuViewV16 = "collections";
    let questionsV16=[], sharedQuestionRowsV66=[], sharedQuestionPagingV177={}, sharedQuestionDetailsDeferredV170=false;
    let collectionVolumesV180=[], collectionVolumeProgressV180=[], collectionVolumesLoadingV180=false, collectionVolumesErrorV180="", importedQuestionsReadyV81=true;
    function rememberCollectionSlugV165() {}
    function requireLoginForPlayV187() { return true; }
    function isSeriesParentCollectionV180() { return false; }
    function showMenuV16(view) { menuViewV16=view; }
    function collectionSlugFromUrlV165() { return new URL(window.location.href).searchParams.get("collection")||""; }
    async function switchCollectionInPlaceV177(slug) { await __load(slug); sharedCollectionV46={share_slug:slug}; menuViewV16="today"; return true; }
    ${html.slice(start, end)}
    globalThis.navigate = navigateToCollectionV106;
    globalThis.popstate = handleCollectionHistoryV214;
    globalThis.inspect = () => ({slug:sharedCollectionV46.share_slug,view:menuViewV16,pending:collectionNavigationPendingV165,queued:collectionHistoryPendingV214});
  `, sandbox);
  return { sandbox, window, loads, historyWrites };
}

test("V214 browser Back during a load restores the requested collection after the in-flight load", async () => {
  const { sandbox, window, loads, historyWrites } = await navigationHarness();
  const navigating = sandbox.navigate("b");
  assert.equal(loads[0].slug, "b");
  window.location.href = "https://example.test/?collection=a";
  assert.equal(await sandbox.popstate(), false);
  loads[0].resolve();
  await nextTurn();
  assert.equal(loads[1].slug, "a");
  loads[1].resolve();
  await navigating;
  assert.equal(sandbox.inspect().slug, "a");
  assert.equal(sandbox.inspect().pending, false);
  assert.equal(sandbox.inspect().queued, null);
  assert.equal(new URL(window.location.href).searchParams.get("collection"), "a");
  assert.equal(historyWrites.filter(item => item.kind === "pushState").length, 1);
});

test("V214 multiple Back actions use the final destination, including the root chooser URL", async () => {
  const { sandbox, window, loads } = await navigationHarness();
  const navigating = sandbox.navigate("b");
  window.location.href = "https://example.test/?collection=c";
  await sandbox.popstate();
  window.location.href = "https://example.test/";
  await sandbox.popstate();
  loads[0].resolve();
  await navigating;
  assert.equal(loads.length, 1);
  assert.equal(sandbox.inspect().view, "collections");
  assert.equal(sandbox.inspect().pending, false);
  assert.equal(window.location.href, "https://example.test/");
});

function v215Books() {
  return [
    { share_slug: "basic", title: "基本序列問題集", can_view: true, question_count: 228 },
    { share_slug: "kunitaso", title: "くにたそ問題集", can_view: true, question_count: 400 },
    { share_slug: "pierre", title: "ピエール問題集", can_view: true, question_count: 1754 }
  ];
}
function mountShelfV215(controller, ctx) {
  const html = controller.render(ctx);
  const root = new FakeNode();
  const surface = new FakeNode({ className: "library-v214" });
  const rail = new FakeNode({ dataset: { libraryRail: "" } });
  const detail = new FakeNode({ dataset: { libraryDetail: "" } });
  const status = new FakeNode({ dataset: { libraryStatus: "" } });
  rail.clientWidth = 400;
  const buttons = [...html.matchAll(/data-library-book="([^"]+)"/g)].map(match => new FakeNode({ dataset: { libraryBook: match[1] } }));
  rail.append(...buttons);
  surface.append(rail, detail, status);
  root.append(surface);
  controller.mount(root);
  return { root, rail, detail, status, buttons };
}
const v215Ids = root => root.querySelectorAll("[data-library-book]").map(button => button.dataset.libraryBook);

test("V215 leaving during a series request ignores the old response and permits a fresh request", async () => {
  const api = await libraryApi();
  const requests = [];
  const controller = api.create({ loadSeries: () => { const d = deferred(); requests.push(d); return d.promise; } });
  const ctx = context("u", [series("s")]);
  controller.render(ctx);
  const old = controller.browseSeries("s");
  controller.unmount();
  controller.render(ctx);
  const fresh = controller.browseSeries("s");
  await nextTurn();
  assert.equal(requests.length, 2);
  requests[1].resolve({ volumes: [volume("fresh", 1)], progress: [] });
  assert.equal(await fresh, true);
  requests[0].resolve({ volumes: [volume("stale", 1)], progress: [] });
  assert.equal(await old, false);
  const html = controller.render(ctx);
  assert.match(html, /data-library-book="fresh"/);
  assert.doesNotMatch(html, /data-library-book="stale"/);
});

test("V215 retry refetches progress even when the series volumes are already cached", async () => {
  const api = await libraryApi();
  let calls = 0;
  const controller = api.create({ loadSeries: () => ({ volumes: [volume("v", 1)], progressError: ++calls === 1,
    progress: calls === 1 ? [] : [{ volume_number: 1, answered_count: 20, mastered_count: 10 }] }) });
  const ctx = context("u", [series("s")]);
  controller.render(ctx);
  await controller.browseSeries("s");
  const shelf = mountShelfV215(controller, ctx);
  shelf.root.dispatch("click", { target: new FakeNode({ dataset: { libraryRetry: "" } }) });
  await nextTurn();
  assert.equal(calls, 2);
  const html = controller.render(ctx);
  assert.match(html, /20<small>問/);
  assert.doesNotMatch(html, /一部の件数・進捗/);
});

test("V215 pending series are non-interactive spines and cannot steal a confirmed book or reorder", async () => {
  const api = await libraryApi();
  const response = deferred();
  let saves = 0;
  const controller = api.create({ loadSeries: () => response.promise, saveOrder: () => { saves++; } });
  const ctx = context("u", [v215Books()[0], series("s")]);
  const shelf = mountShelfV215(controller, ctx);
  assert.match(controller.render(ctx), /data-library-placeholder="s"/);
  assert.doesNotMatch(controller.render(ctx), /data-library-book="s"/);
  const basic = shelf.buttons[0];
  shelf.root.dispatch("click", { target: basic });
  shelf.root.dispatch("click", { target: new FakeNode({ dataset: { libraryBook: "s" } }) });
  shelf.root.dispatch("keydown", { target: basic, key: "ArrowRight", shiftKey: true });
  shelf.root.dispatch("pointerdown", { target: basic, pointerId: 2, clientX: 28, clientY: 210 });
  assert.equal(basic.capturedPointer, undefined);
  assert.equal(saves, 0);
  await nextTurn();
  response.resolve({ volumes: [volume("v", 1)], progress: [] });
  await nextTurn();
  const html = controller.render(ctx);
  assert.match(html, /libraryDetailTitleV214">基本序列問題集/);
  assert.match(html, /この本で学びますか/);
  assert.match(html, /is-reorder-ready/);
});

test("V215 an intentional new tap immediately after cancelling a drag is accepted", async () => {
  const api = await libraryApi();
  let opens = 0;
  const controller = api.create({ onOpen: () => { opens++; return true; } });
  const shelf = mountShelfV215(controller, context("u", v215Books()));
  const source = shelf.buttons[0];
  shelf.root.dispatch("click", { target: source });
  shelf.root.dispatch("pointerdown", { target: source, pointerId: 1, clientX: 28, clientY: 210 });
  shelf.root.dispatch("pointermove", { target: source, pointerId: 1, clientX: 130, clientY: 210 });
  shelf.root.dispatch("keydown", { target: source, key: "Escape" });
  shelf.root.dispatch("pointerdown", { target: source, pointerId: 2, clientX: 28, clientY: 210 });
  shelf.root.dispatch("pointerup", { target: source, pointerId: 2 });
  shelf.root.dispatch("click", { target: source, detail: 1 });
  await nextTurn();
  assert.equal(opens, 1);
});

test("V215 a second pointer cannot cancel or replace the active drag", async () => {
  const api = await libraryApi();
  let saves = 0;
  const controller = api.create({ saveOrder: () => { saves++; } });
  const shelf = mountShelfV215(controller, context("u", v215Books()));
  const source = shelf.buttons[0];
  shelf.root.dispatch("click", { target: source });
  shelf.root.dispatch("pointerdown", { target: source, pointerId: 1, clientX: 28, clientY: 210 });
  shelf.root.dispatch("pointermove", { target: source, pointerId: 1, clientX: 130, clientY: 210 });
  shelf.root.dispatch("pointerdown", { target: source, pointerId: 2, clientX: 28, clientY: 210 });
  shelf.root.dispatch("pointercancel", { target: source, pointerId: 2 });
  assert.equal(source.classList.contains("is-drag-source"), true);
  shelf.root.dispatch("pointerup", { target: shelf.root, pointerId: 1 });
  assert.equal(saves, 1);
});

test("V215 a late summary from a previous visit never replaces refreshed progress", async () => {
  const api = await libraryApi();
  const requests = [];
  const controller = api.create({ loadSummary: () => { const d = deferred(); requests.push(d); return d.promise; } });
  const ctx = context("u", [v215Books()[0]]);
  mountShelfV215(controller, ctx);
  await nextTurn();
  controller.unmount();
  mountShelfV215(controller, ctx);
  await nextTurn();
  assert.equal(requests.length, 2);
  requests[1].resolve({ question_count: 200, answered_count: 100, mastered_count: 50 });
  await nextTurn();
  requests[0].resolve({ question_count: 99, answered_count: 99, mastered_count: 99 });
  await nextTurn();
  const html = controller.render(ctx);
  assert.match(html, /200<small>問/);
  assert.doesNotMatch(html, /99<small>/);
});

test("V215 first tap previews, a different book previews, and the second tap opens only that book", async () => {
  const api = await libraryApi();
  const opened = [];
  const controller = api.create({ onOpen: slug => { opened.push(slug); return true; } });
  const shelf = mountShelfV215(controller, context("u", v215Books()));
  shelf.root.dispatch("click", { target: shelf.buttons[1] });
  assert.deepEqual(opened, []);
  assert.match(shelf.detail.innerHTML, /この本で学びますか？/);
  assert.match(shelf.detail.innerHTML, /400<small>問/);
  assert.equal(shelf.buttons[1]["aria-pressed"], "true");
  shelf.root.dispatch("click", { target: shelf.buttons[2] });
  assert.deepEqual(opened, []);
  assert.equal(shelf.buttons[1]["aria-pressed"], "false");
  shelf.root.dispatch("click", { target: shelf.buttons[2] });
  await nextTurn();
  assert.deepEqual(opened, ["pierre"]);
});

test("V215 an initially current book still requires a first confirmation tap", async () => {
  const api = await libraryApi();
  let opened = 0;
  const books = v215Books();
  const controller = api.create({ onOpen: () => { opened++; return true; } });
  const shelf = mountShelfV215(controller, context("u", books, books[0]));
  shelf.root.dispatch("click", { target: shelf.buttons[0] });
  assert.equal(opened, 0);
  assert.match(shelf.detail.innerHTML, /この本で学びますか？/);
});

test("V215 hover and keyboard focus never count as the first confirmation tap", async () => {
  const api = await libraryApi();
  let opened = 0;
  const controller = api.create({ onOpen: () => { opened++; return true; } });
  const shelf = mountShelfV215(controller, context("u", v215Books()));
  shelf.root.dispatch("pointermove", { target: shelf.buttons[1], pointerType: "mouse" });
  shelf.root.dispatch("focusin", { target: shelf.buttons[1] });
  shelf.root.dispatch("click", { target: shelf.buttons[1] });
  assert.equal(opened, 0);
});

test("V215 Shift+arrow reorders, saves once, and reloads the personal order", async () => {
  const api = await libraryApi();
  const saved = new Map();
  let writes = 0;
  const options = { loadOrder: user => saved.get(user), saveOrder: (user, ids) => { saved.set(user, ids); writes++; } };
  const controller = api.create(options);
  const ctx = context("u", v215Books());
  const shelf = mountShelfV215(controller, ctx);
  shelf.root.dispatch("keydown", { target: shelf.buttons[2], key: "ArrowLeft", shiftKey: true });
  assert.deepEqual(v215Ids(shelf.root), ["basic", "pierre", "kunitaso"]);
  assert.equal(writes, 1);
  const restored = mountShelfV215(api.create(options), ctx);
  assert.deepEqual(v215Ids(restored.root), ["basic", "pierre", "kunitaso"]);
  const reset = new FakeNode({ dataset: { libraryReset: "" } });
  restored.root.dispatch("click", { target: reset });
  assert.deepEqual(v215Ids(restored.root), ["basic", "kunitaso", "pierre"]);
  assert.equal(saved.get("u").length, 0);
});

test("V215 one account cannot inherit another account's custom order", async () => {
  const api = await libraryApi();
  const controller = api.create({ loadOrder: user => user === "a" ? ["pierre", "kunitaso", "basic"] : [] });
  let shelf = mountShelfV215(controller, context("a", v215Books()));
  assert.deepEqual(v215Ids(shelf.root), ["pierre", "kunitaso", "basic"]);
  shelf = mountShelfV215(controller, context("b", v215Books()));
  assert.deepEqual(v215Ids(shelf.root), ["basic", "kunitaso", "pierre"]);
  assert.doesNotMatch(controller.render(context("b", v215Books())), /is-picked/);
});

test("V215 malformed browser preferences never hide the available books", async () => {
  const api = await libraryApi();
  for (const invalid of [{ __proto__: ["no"] }, "not an array", [null, {}, "pierre", "pierre", "missing"]]) {
    const shelf = mountShelfV215(api.create({ loadOrder: () => invalid }), context("u", v215Books()));
    assert.equal(v215Ids(shelf.root).length, 3);
    assert.equal(new Set(v215Ids(shelf.root)).size, 3);
  }
});

test("V215 drag uses a stable capture parent, drop saves, and its synthetic click never opens", async () => {
  const api = await libraryApi();
  let saves = 0, opens = 0;
  const controller = api.create({ saveOrder: () => { saves++; }, onOpen: () => { opens++; return true; } });
  const shelf = mountShelfV215(controller, context("u", v215Books()));
  const source = shelf.buttons[0];
  shelf.root.dispatch("click", { target: source });
  shelf.root.dispatch("pointerdown", { target: source, pointerId: 7, clientX: 28, clientY: 210, button: 0 });
  shelf.root.dispatch("pointermove", { target: source, pointerId: 7, clientX: 130, clientY: 210 });
  assert.equal(shelf.root.capturedPointer, 7);
  shelf.root.dispatch("lostpointercapture", { target: source, pointerId: 7 });
  assert.deepEqual(v215Ids(shelf.root), ["kunitaso", "pierre", "basic"]);
  shelf.root.dispatch("pointerup", { target: shelf.root, pointerId: 7 });
  shelf.root.dispatch("click", { target: source });
  assert.equal(saves, 1);
  assert.equal(opens, 0);
  assert.equal(shelf.root.capturedPointer, null);
  assert.equal(source.classList.contains("is-drag-source"), false);
});

test("V216 the first press can drag an unselected book without opening it", async () => {
  const api = await libraryApi();
  let saves = 0, opens = 0;
  const controller = api.create({ saveOrder: () => { saves++; }, onOpen: () => { opens++; return true; } });
  const shelf = mountShelfV215(controller, context("u", v215Books()));
  const source = shelf.buttons[1];

  shelf.root.dispatch("pointerdown", { target: source, pointerId: 16, clientX: 68, clientY: 210, button: 0 });
  shelf.root.dispatch("pointermove", { target: source, pointerId: 16, clientX: 170, clientY: 210 });

  assert.equal(source.classList.contains("is-picked"), true);
  assert.equal(source.classList.contains("is-drag-source"), true);
  assert.match(shelf.detail.innerHTML, /この本で学びますか？/);

  shelf.root.dispatch("pointerup", { target: shelf.root, pointerId: 16 });
  shelf.root.dispatch("click", { target: source, detail: 1 });

  assert.deepEqual(v215Ids(shelf.root), ["basic", "pierre", "kunitaso"]);
  assert.equal(saves, 1);
  assert.equal(opens, 0);
});

test("V216 a short first press still previews instead of opening or reordering", async () => {
  const api = await libraryApi();
  let saves = 0, opens = 0;
  const controller = api.create({ saveOrder: () => { saves++; }, onOpen: () => { opens++; return true; } });
  const shelf = mountShelfV215(controller, context("u", v215Books()));
  const source = shelf.buttons[1];

  shelf.root.dispatch("pointerdown", { target: source, pointerId: 17, clientX: 68, clientY: 210, button: 0 });
  shelf.root.dispatch("pointerup", { target: source, pointerId: 17 });
  shelf.root.dispatch("click", { target: source, detail: 1 });

  assert.equal(source.classList.contains("is-picked"), true);
  assert.match(shelf.detail.innerHTML, /この本で学びますか？/);
  assert.deepEqual(v215Ids(shelf.root), ["basic", "kunitaso", "pierre"]);
  assert.equal(saves, 0);
  assert.equal(opens, 0);
});

test("V215 Escape and pointercancel roll a drag back without persisting", async () => {
  const api = await libraryApi();
  for (const mode of ["escape", "cancel"]) {
    let saves = 0;
    const controller = api.create({ saveOrder: () => { saves++; } });
    const shelf = mountShelfV215(controller, context("u", v215Books()));
    const source = shelf.buttons[0];
    shelf.root.dispatch("click", { target: source });
    shelf.root.dispatch("pointerdown", { target: source, pointerId: 9, clientX: 28, clientY: 210 });
    shelf.root.dispatch("pointermove", { target: source, pointerId: 9, clientX: 130, clientY: 210 });
    if (mode === "escape") shelf.root.dispatch("keydown", { target: source, key: "Escape" });
    else shelf.root.dispatch("pointercancel", { target: source, pointerId: 9 });
    assert.deepEqual(v215Ids(shelf.root), ["basic", "kunitaso", "pierre"]);
    assert.equal(saves, 0);
  }
});

test("V215 disabled storage keeps the in-memory arrangement with an honest warning", async () => {
  const api = await libraryApi();
  const controller = api.create({ loadOrder: () => { throw new Error("denied"); }, saveOrder: () => { throw new Error("quota"); } });
  const shelf = mountShelfV215(controller, context("u", v215Books()));
  shelf.root.dispatch("keydown", { target: shelf.buttons[2], key: "ArrowLeft", shiftKey: true });
  assert.deepEqual(v215Ids(shelf.root), ["basic", "pierre", "kunitaso"]);
  assert.match(shelf.status.textContent, /保存できません/);
});

test("V215 asynchronous current-volume metadata chooses the current book, but never steals an explicit choice", async () => {
  const api = await libraryApi();
  const parent = series("series-a");
  const active = { ...volume("volume-a", 1), series_parent_slug: "series-a" };
  const response = deferred();
  const controller = api.create({ loadSeries: () => response.promise });
  const ctx = context("u", [v215Books()[0], parent], active);
  controller.render(ctx);
  const load = controller.browseSeries("series-a");
  response.resolve({ volumes: [active], progress: [] });
  await load;
  assert.match(controller.render(ctx), /libraryDetailTitleV214">volume-a/);
  const shelf = mountShelfV215(controller, ctx);
  shelf.root.dispatch("click", { target: shelf.buttons.find(b => b.dataset.libraryBook === "basic") });
  assert.match(controller.render(ctx), /libraryDetailTitleV214">基本序列問題集/);
});
