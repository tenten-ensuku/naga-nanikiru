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
    document.querySelectorAll('input[name="colorThemeV259"]').forEach(input => { input.checked = input.value === value; });
  }
  function set(value) {
    if (!valid(value)) return false;
    apply(value);
    try { window.localStorage.setItem(storageKey, value); return true; }
    catch { return false; }
  }
  function bind(root = document) {
    const control = root.querySelector(".theme-preference-v259");
    if (!control || control.dataset.boundThemeV259) return;
    control.dataset.boundThemeV259 = "true";
    control.addEventListener("change", event => {
      const input = event.target;
      if (input.name !== "colorThemeV259" || !input.checked || !valid(input.value)) return;
      const saved = set(input.value);
      const status = root.querySelector("#themePreferenceStatusV259");
      if (status) {
        status.classList.toggle("is-error", !saved);
        status.textContent = saved ? "このブラウザーに保存しました。" : "表示を切り替えました。ブラウザーに保存できないため、再読み込みすると元に戻ります。";
      }
    });
  }
  window.addEventListener("storage", event => {
    let local;
    try { local = window.localStorage; } catch { return; }
    if (event.storageArea !== local || (event.key !== storageKey && event.key !== null)) return;
    apply(valid(event.newValue) ? event.newValue : "light");
    const status = document.querySelector("#themePreferenceStatusV259");
    if (status) { status.textContent = ""; status.classList.remove("is-error"); }
  });
  apply(theme);
  window.MinkiruThemeV259 = Object.freeze({ current: () => theme, set, bind });
})();
