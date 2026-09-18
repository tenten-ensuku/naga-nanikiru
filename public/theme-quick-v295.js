/* Shared appearance control; reuses the existing browser-only preference. */
(() => {
  'use strict';
  function init() {
    const group = document.getElementById('themeQuickV295');
    const theme = window.MinkiruThemeV259;
    if (!group || !theme) return;
    const sync = () => group.querySelectorAll('[data-theme-choice]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme.current()));
    });
    group.addEventListener('click', event => {
      const button = event.target.closest('[data-theme-choice]');
      if (!button || !group.contains(button)) return;
      const saved = theme.set(button.dataset.themeChoice);
      sync();
      const status = document.getElementById('themeQuickStatusV295');
      if (status) status.textContent = saved ? '' : '表示を切り替えました。このブラウザーには保存できません。';
    });
    new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
