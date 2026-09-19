/* Browser display preference only; independent of accounts and study data. */
(() => {
  "use strict";
  const storageKey = "minkiru:color-theme:v1";
  const valid = value => value === "light" || value === "dark";
  let theme = "light";
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (valid(saved)) theme = saved;
  } catch { /* The default also works when storage is unavailable. */ }

  function apply(value) {
    theme = value;
    document.documentElement.dataset.theme = value;
    document.documentElement.style.colorScheme = value;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", value === "light" ? "#f3f6f7" : "#06131e");
  }
  function set(value) {
    if (!valid(value)) return false;
    apply(value);
    try { window.localStorage.setItem(storageKey, value); return true; }
    catch { return false; }
  }
  window.addEventListener("storage", event => {
    let local;
    try { local = window.localStorage; } catch { return; }
    if (event.storageArea !== local || (event.key !== storageKey && event.key !== null)) return;
    apply(valid(event.newValue) ? event.newValue : "light");
  });
  apply(theme);
  window.MinkiruThemeV259 = Object.freeze({ current: () => theme, set });
})();
