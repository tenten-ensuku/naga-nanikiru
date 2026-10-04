/* An optional extra: opening the panel never starts playback. */
(() => {
  'use strict';
  const panel = document.getElementById('theme-song');
  const video = panel?.querySelector('video');
  if (!video) return;

  const openFromLink = () => {
    if (window.location.hash !== '#theme-song') return;
    panel.open = true;
    panel.scrollIntoView({ block: 'start', behavior: 'instant' });
    panel.querySelector('summary').focus({ preventScroll: true });
  };
  panel.addEventListener('toggle', () => {
    if (!panel.open) video.pause();
  });
  window.addEventListener('pagehide', () => video.pause());
  window.addEventListener('hashchange', openFromLink);
  window.addEventListener('load', () => {
    if (panel.open && window.location.hash === '#theme-song') {
      panel.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }, { once: true });
  // The introduction and the song should never talk over each other.
  for (const player of document.querySelectorAll('video')) {
    player.addEventListener('play', () => {
      for (const other of document.querySelectorAll('video')) {
        if (other !== player) other.pause();
      }
    });
  }
  openFromLink();
})();
