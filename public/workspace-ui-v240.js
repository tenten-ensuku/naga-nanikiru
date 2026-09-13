(() => {
  "use strict";

  const keys = new Set(["account", "display", "reactions", "transfer", "teaching"]);
  // Heroicons v2.2.0, MIT. Same vendor/license as menu-sections-v239.js.
  // https://github.com/tailwindlabs/heroicons/tree/v2.2.0/optimized/24/outline
  const paths = Object.freeze({
    "face-smile": "M15.182 15.182a4.5 4.5 0 0 1-6.364 0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z",
    "user-circle": "M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
  });
  function icon(name) {
    const path = paths[name];
    return path ? `<svg class="menu-icon-v239" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true" focusable="false"><path stroke-linecap="round" stroke-linejoin="round" d="${path}"/></svg>` : window.MinkiruMenuV239?.icon(name) || "";
  }

  // Native disclosures keep every form mounted, including unsaved text and files.
  function openSettings(key, { focus = false, root = document } = {}) {
    if (!keys.has(key)) return false;
    const target = root.querySelector(`[data-settings-group-v240="${key}"]`);
    if (!target) return false;
    root.querySelectorAll("[data-settings-group-v240]").forEach(group => { group.open = group === target; });
    if (focus) target.querySelector("summary")?.focus();
    return true;
  }

  function bindSettings(root = document) {
    root.querySelectorAll("[data-settings-group-v240]").forEach(group => {
      if (group.dataset.boundV240) return;
      group.dataset.boundV240 = "true";
      group.addEventListener("toggle", () => {
        if (group.open) openSettings(group.dataset.settingsGroupV240, { root });
      });
    });
  }

  window.MinkiruWorkspaceV240 = Object.freeze({ icon, openSettings, bindSettings });
})();
