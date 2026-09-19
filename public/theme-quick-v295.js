/* Shared appearance control; reuses the existing browser-only preference. */
(() => {
  'use strict';
  function init() {
    const button = document.getElementById('themeQuickV295');
    const theme = window.MinkiruThemeV259;
    if (!button || !theme) return;
    const sync = () => {
      const label = theme.current() === 'light' ? 'ダークモードに切り替える' : 'ライトモードに切り替える';
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
    };
    button.addEventListener('click', () => {
      const saved = theme.set(theme.current() === 'light' ? 'dark' : 'light');
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
