/* Navigation-only state. No network, persistent question data, or answer writes. */
(function (root) {
  "use strict";
  const bookViews = new Set(["today", "my", "archive", "analysis", "session", "book-settings", "question"]);
  const views = new Set(["collections", "generator", "settings", "students", ...bookViews]);
  const isBookView = view => bookViews.has(view);
  const globalView = view => isBookView(view) ? "today" : view === "students" ? "settings" : view;
  const localView = view => ["my", "archive", "question"].includes(view) ? "my" : view === "analysis" ? "analysis" : "today";
  function generatorDefault({ stored = "", explicit = false, rows = [], bookSlug = "", fromBook = false } = {}) {
    const valid = value => value === "local" || rows.some(row => String(row.share_slug || "") === value);
    if (explicit) return valid(stored) ? stored : "";
    if (fromBook && bookSlug && valid(bookSlug)) return bookSlug;
    return "";
  }
  function routeUrl(href, route) {
    const url = new URL(href);
    if (route.slug) url.searchParams.set("collection", route.slug);
    else url.searchParams.delete("collection");
    url.searchParams.set("view", views.has(route.view) ? route.view : "collections");
    url.searchParams.delete("existing_question");
    url.searchParams.delete("study_question");
    if (route.view === "question" && route.questionId) url.searchParams.set("existing_question", route.questionId);
    else if (route.view === "question" && route.questionKey) url.searchParams.set("study_question", route.questionKey);
    url.hash = "";
    return url.toString();
  }
  function createMemory(limit = 80) {
    let owner = "";
    const routes = new Map(), questions = new Map(), study = new Map();
    const key = (slug, view) => JSON.stringify([String(slug || ""), String(view || "")]);
    function keep(map, id, value) {
      map.delete(id); map.set(id, value);
      while (map.size > limit) map.delete(map.keys().next().value);
    }
    return {
      setOwner(value) {
        const next = String(value || "");
        if (next === owner) return false;
        owner = next; routes.clear(); questions.clear(); study.clear(); return true;
      },
      accepts(route) { return Boolean(route && route.version === 234 && route.owner === owner && views.has(route.view)); },
      remember(route) {
        if (!this.accepts(route)) return;
        keep(routes, key(isBookView(route.view) ? route.slug : "", route.view), structuredClone(route));
        if (isBookView(route.view) && route.view !== "book-settings") keep(study, String(route.slug || ""), structuredClone(route));
      },
      route(slug, view) { const value = routes.get(key(isBookView(view) ? slug : "", view)); return value ? structuredClone(value) : null; },
      lastStudy(slug) { const value = study.get(String(slug || "")); return value ? structuredClone(value) : null; },
      saveQuestion(slug, questionKey, draft) { keep(questions, key(slug, questionKey), draft); },
      question(slug, questionKey) { return questions.get(key(slug, questionKey)) || null; }
    };
  }
  root.MinkiruNavigationV234 = Object.freeze({ isBookView, globalView, localView, generatorDefault, routeUrl, createMemory });
})(typeof window === "undefined" ? globalThis : window);
