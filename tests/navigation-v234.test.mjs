import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const moduleUrl = new URL("../public/navigation-v234.js", import.meta.url);
const source = await readFile(moduleUrl, "utf8");
const OWNER = "user-a";
const BOOK_VIEWS = ["today", "my", "archive", "analysis", "session", "book-settings", "question"];
const GLOBAL_VIEWS = ["collections", "generator", "settings", "students"];

function loadApi() {
  const context = { URL, structuredClone };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: moduleUrl.pathname });
  return context.MinkiruNavigationV234;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function route(overrides = {}) {
  return {
    version: 234, owner: OWNER, slug: "book-a", view: "my",
    filters: { search: "test", statuses: ["unanswered"] }, scroll: 120,
    ...overrides
  };
}

function ownedMemory(limit) {
  const memory = loadApi().createMemory(limit);
  memory.setOwner(OWNER);
  return memory;
}

// The caller supplies the already-authorized editable destination allowlist.
const EDITABLE_ROWS = Object.freeze([
  Object.freeze({ share_slug: "book-a", can_edit: true }),
  Object.freeze({ share_slug: "book-b", can_manage: true })
]);

test("book, global navigation, and book-local tab mappings remain distinct", () => {
  const api = loadApi();
  const expectedLocal = {
    today: "today", my: "my", archive: "my", analysis: "analysis",
    session: "today", "book-settings": "today", question: "my",
    collections: "today", generator: "today", settings: "today", students: "today"
  };
  for (const view of [...BOOK_VIEWS, ...GLOBAL_VIEWS]) {
    assert.equal(api.isBookView(view), BOOK_VIEWS.includes(view), view);
    assert.equal(api.globalView(view), BOOK_VIEWS.includes(view) ? "today" : view === "students" ? "settings" : view, view);
    assert.equal(api.localView(view), expectedLocal[view], view);
  }
  assert.equal(api.isBookView("unknown"), false);
  assert.equal(api.isBookView(undefined), false);
});

test("global generator starts unselected even with an editable current book or implicit old destination", () => {
  const { generatorDefault } = loadApi();
  assert.equal(generatorDefault(), "");
  for (const stored of ["", "book-a", "book-b", "local"]) {
    assert.equal(generatorDefault({ stored, rows: EDITABLE_ROWS, bookSlug: "book-a", fromBook: false }), "");
  }
});

test("fromBook selects only the current book in the editable allowlist, without choosing another book", () => {
  const { generatorDefault } = loadApi();
  assert.equal(generatorDefault({ rows: EDITABLE_ROWS, bookSlug: "book-a", fromBook: true }), "book-a");
  assert.equal(generatorDefault({ rows: EDITABLE_ROWS, bookSlug: "book-b", fromBook: true }), "book-b");
  for (const bookSlug of ["read-only-book", "revoked-book", ""]) {
    assert.equal(generatorDefault({ rows: EDITABLE_ROWS, bookSlug, fromBook: true }), "");
  }
  assert.equal(generatorDefault({ rows: [], bookSlug: "book-a", fromBook: true }), "");
});

test("explicit selections and restored draft destinations take priority over the entry book", () => {
  const { generatorDefault } = loadApi();
  // Draft restoration uses the same stored + explicit contract as a selection.
  for (const stored of ["book-b", "local"]) {
    for (const fromBook of [false, true]) {
      const options = Object.freeze({ stored, explicit: true, rows: EDITABLE_ROWS, bookSlug: "book-a", fromBook });
      assert.equal(generatorDefault(options), stored);
    }
  }
});

test("revoked explicit destination is unselected on global entry", () => {
  const { generatorDefault } = loadApi();
  const options = { stored: "book-b", explicit: true, rows: EDITABLE_ROWS, bookSlug: "book-a" };
  assert.equal(generatorDefault(options), "book-b");
  assert.equal(generatorDefault({ ...options, rows: [EDITABLE_ROWS[0]] }), "");
  assert.equal(generatorDefault({ ...options, rows: [] }), "");
  assert.equal(generatorDefault({ ...options, stored: "local", rows: [] }), "local");
});

test("revoked explicit or draft destination does not silently fall back to another editable entry book", () => {
  const { generatorDefault } = loadApi();
  assert.equal(generatorDefault({
    stored: "book-b", explicit: true, rows: [EDITABLE_ROWS[0]], bookSlug: "book-a", fromBook: true
  }), "", "permission loss must ask for a destination instead of substituting book-a");
});

const OLD_URL = "https://example.invalid/naga-nanikiru/?collection=old-book&existing_question=old-id&study_question=old-key&view=question&lang=ja#old-fragment";

test("question routes replace collection/deep links and prefer a server question id over a local key", () => {
  const { routeUrl } = loadApi();
  const next = Object.freeze({ slug: "book-b", view: "question", questionId: "server-id", questionKey: "book-b::local-key" });
  const result = new URL(routeUrl(OLD_URL, next));
  assert.equal(result.origin, "https://example.invalid");
  assert.equal(result.pathname, "/naga-nanikiru/");
  assert.equal(result.searchParams.get("collection"), "book-b");
  assert.equal(result.searchParams.get("view"), "question");
  assert.equal(result.searchParams.get("existing_question"), "server-id");
  assert.equal(result.searchParams.has("study_question"), false);
  assert.equal(result.searchParams.get("lang"), "ja");
  assert.equal(result.hash, "");
  assert.equal(next.questionKey, "book-b::local-key");
});

test("local question deep links are encoded as data without overriding view or collection", () => {
  const { routeUrl } = loadApi();
  const questionKey = "book-a::question&view=settings#fragment";
  const result = new URL(routeUrl(OLD_URL, { slug: "book-a", view: "question", questionKey }));
  assert.equal(result.searchParams.get("study_question"), questionKey);
  assert.equal(result.searchParams.has("existing_question"), false);
  assert.equal(result.searchParams.get("view"), "question");
  assert.equal(result.searchParams.get("collection"), "book-a");
  assert.equal(result.hash, "");
});

test("leaving a question removes both deep-link forms for every non-question view", () => {
  const { routeUrl } = loadApi();
  for (const view of [...BOOK_VIEWS, ...GLOBAL_VIEWS].filter(view => view !== "question")) {
    const result = new URL(routeUrl(OLD_URL, { view, slug: "book-a", questionId: "stale", questionKey: "stale" }));
    assert.equal(result.searchParams.get("view"), view);
    assert.equal(result.searchParams.get("collection"), "book-a");
    assert.equal(result.searchParams.has("existing_question"), false, view);
    assert.equal(result.searchParams.has("study_question"), false, view);
    assert.equal(result.hash, "");
  }
});

test("routes without a book and invalid views cannot retain stale collection or question parameters", () => {
  const { routeUrl } = loadApi();
  for (const view of ["collections", "generator", "settings", "invalid", undefined]) {
    const result = new URL(routeUrl(OLD_URL, { view, slug: "", questionId: "stale", questionKey: "stale" }));
    assert.equal(result.searchParams.has("collection"), false);
    assert.equal(result.searchParams.has("existing_question"), false);
    assert.equal(result.searchParams.has("study_question"), false);
    assert.equal(result.searchParams.get("view"), GLOBAL_VIEWS.includes(view) ? view : "collections");
  }
  const noQuestion = new URL(routeUrl(OLD_URL, { slug: "book-a", view: "question" }));
  assert.equal(noQuestion.searchParams.has("existing_question"), false);
  assert.equal(noQuestion.searchParams.has("study_question"), false);
});

test("memory accepts only the current owner, version, and recognized view", () => {
  const memory = ownedMemory();
  for (const view of [...BOOK_VIEWS, ...GLOBAL_VIEWS]) assert.equal(memory.accepts(route({ view })), true);
  for (const invalid of [
    null, undefined, {}, route({ owner: "user-b" }), route({ owner: "" }),
    route({ version: 233 }), route({ version: "234" }), route({ view: "invalid" })
  ]) {
    assert.equal(memory.accepts(invalid), false);
    memory.remember(invalid);
  }
  assert.equal(memory.route("book-a", "my"), null);
  assert.equal(memory.lastStudy("book-a"), null);
});

test("changing owner clears routes, question drafts, and lastStudy without restoring another account's state", () => {
  const memory = ownedMemory();
  const original = route();
  memory.remember(original);
  memory.saveQuestion("book-a", "same-id", { selected: "4m" });
  assert.equal(memory.setOwner(OWNER), false);
  assert.deepEqual(plain(memory.route("book-a", "my")), original);
  assert.equal(memory.question("book-a", "same-id").selected, "4m");
  assert.equal(memory.setOwner("user-b"), true);
  assert.equal(memory.route("book-a", "my"), null);
  assert.equal(memory.question("book-a", "same-id"), null);
  assert.equal(memory.lastStudy("book-a"), null);
  memory.remember(original);
  assert.equal(memory.route("book-a", "my"), null);
  memory.remember(route({ owner: "user-b", scroll: 999 }));
  memory.saveQuestion("book-a", "same-id", { selected: "5m" });
  assert.equal(memory.setOwner(OWNER), true);
  assert.equal(memory.route("book-a", "my"), null);
  assert.equal(memory.question("book-a", "same-id"), null);
  assert.equal(memory.lastStudy("book-a"), null);
  memory.remember(original);
  assert.equal(memory.setOwner(""), true, "sign-out also clears the previous account");
  assert.equal(memory.route("book-a", "my"), null);
  assert.equal(memory.accepts(original), false);
});

test("remembered routes and lastStudy are detached deep clones on write and each read", () => {
  const memory = ownedMemory();
  const original = route();
  const expected = plain(original);
  memory.remember(original);
  original.filters.statuses.push("archive");
  original.filters.search = "changed input";
  original.scroll = 999;
  assert.deepEqual(plain(memory.route("book-a", "my")), expected);
  assert.deepEqual(plain(memory.lastStudy("book-a")), expected);
  const restored = memory.route("book-a", "my");
  restored.filters.statuses.length = 0;
  restored.scroll = 888;
  const resumed = memory.lastStudy("book-a");
  resumed.filters.search = "changed output";
  assert.deepEqual(plain(memory.route("book-a", "my")), expected);
  assert.deepEqual(plain(memory.lastStudy("book-a")), expected);
});

test("books isolate view snapshots, identical question ids, and lastStudy", () => {
  const memory = ownedMemory();
  for (const [slug, selected] of [["book-a", "4m"], ["book-b", "5m"]]) {
    memory.remember(route({ slug, view: "my", scroll: selected === "4m" ? 100 : 200 }));
    memory.remember(route({ slug, view: "question", questionKey: "same-id" }));
    memory.saveQuestion(slug, "same-id", { selected });
  }
  assert.equal(memory.route("book-a", "my").scroll, 100);
  assert.equal(memory.route("book-b", "my").scroll, 200);
  assert.equal(memory.question("book-a", "same-id").selected, "4m");
  assert.equal(memory.question("book-b", "same-id").selected, "5m");
  assert.equal(memory.question("book-a", "missing"), null);
  assert.equal(memory.lastStudy("book-a").slug, "book-a");
  assert.equal(memory.lastStudy("book-b").slug, "book-b");
  assert.equal(memory.lastStudy("book-c"), null);

  // Compound keys must not collapse when slugs or question keys contain separators.
  memory.saveQuestion("book-a::x", "y", { selected: "6m" });
  memory.saveQuestion("book-a", "x::y", { selected: "7m" });
  assert.equal(memory.question("book-a::x", "y").selected, "6m");
  assert.equal(memory.question("book-a", "x::y").selected, "7m");
});

test("global route snapshots are shared across book contexts but management never overwrites lastStudy", () => {
  const memory = ownedMemory();
  const learning = route({ view: "question", questionKey: "question-a" });
  memory.remember(learning);
  for (const view of ["book-settings", ...GLOBAL_VIEWS]) {
    memory.remember(route({ view }));
    assert.deepEqual(plain(memory.lastStudy("book-a")), learning, view);
  }
  for (const view of GLOBAL_VIEWS) {
    memory.remember(route({ slug: "book-b", view, scroll: 777 }));
    assert.equal(memory.route("book-a", view).slug, "book-b");
    assert.equal(memory.route("", view).scroll, 777);
  }
  assert.equal(memory.lastStudy("book-b"), null);
  assert.equal(memory.route("book-a", "book-settings").slug, "book-a");
  assert.equal(memory.route("book-b", "book-settings"), null);
  for (const view of BOOK_VIEWS.filter(view => view !== "book-settings")) {
    memory.remember(route({ view }));
    assert.equal(memory.lastStudy("book-a").view, view);
  }
});

test("bounded maps evict oldest writes independently and refreshed entries remain recent", () => {
  const memory = ownedMemory(2);
  memory.remember(route({ slug: "a" }));
  memory.remember(route({ slug: "b" }));
  memory.remember(route({ slug: "a", scroll: 555 }));
  memory.remember(route({ slug: "c" }));
  assert.equal(memory.route("b", "my"), null);
  assert.equal(memory.lastStudy("b"), null);
  assert.equal(memory.route("a", "my").scroll, 555);
  assert.equal(memory.lastStudy("a").scroll, 555);
  assert.equal(memory.lastStudy("c").slug, "c");

  memory.saveQuestion("a", "one", { selected: "4m" });
  memory.saveQuestion("a", "two", { selected: "5m" });
  memory.saveQuestion("a", "one", { selected: "6m" });
  memory.saveQuestion("a", "three", { selected: "7m" });
  assert.equal(memory.question("a", "two"), null);
  assert.equal(memory.question("a", "one").selected, "6m");
  assert.equal(memory.question("a", "three").selected, "7m");
  assert.equal(memory.route("a", "my").scroll, 555, "question capacity is separate from route capacity");
  memory.remember(route({ view: "settings" }));
  memory.remember(route({ view: "generator" }));
  assert.equal(memory.route("a", "my"), null);
  assert.equal(memory.lastStudy("a").scroll, 555, "global route eviction must not evict lastStudy");
});

test("the default cap is 80 entries per map and a zero cap retains nothing", () => {
  const memory = ownedMemory();
  for (let index = 0; index <= 80; index += 1) {
    memory.remember(route({ slug: `book-${index}` }));
    memory.saveQuestion("book", `question-${index}`, { selected: index });
  }
  assert.equal(memory.route("book-0", "my"), null);
  assert.equal(memory.lastStudy("book-0"), null);
  assert.equal(memory.question("book", "question-0"), null);
  for (let index = 1; index <= 80; index += 1) {
    assert.equal(memory.route(`book-${index}`, "my").slug, `book-${index}`);
    assert.equal(memory.lastStudy(`book-${index}`).slug, `book-${index}`);
    assert.equal(memory.question("book", `question-${index}`).selected, index);
  }
  const empty = ownedMemory(0);
  empty.remember(route());
  empty.saveQuestion("book-a", "question", { selected: "4m" });
  assert.equal(empty.route("book-a", "my"), null);
  assert.equal(empty.lastStudy("book-a"), null);
  assert.equal(empty.question("book-a", "question"), null);
});
