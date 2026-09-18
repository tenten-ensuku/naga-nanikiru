/* Load one format. Resizing during playback never interrupts the viewer. */
(() => {
  'use strict';
  const video = document.querySelector('.promo-video');
  if (!video) return;
  const media = window.matchMedia('(min-width: 900px)');
  const download = document.querySelector('[data-promo-download]');
  function selectFormat() {
    if (!video.paused || (video.currentTime > 0 && !video.ended)) return;
    const format = media.matches ? 'landscape' : 'portrait';
    if (video.dataset.format === format) return;
    const src = video.dataset[format + 'Src'];
    if (!src) return;
    video.dataset.format = format;
    video.src = src;
    video.poster = video.dataset[format + 'Poster'];
    if (download) {
      download.href = src;
      download.download = `minkiru-intro-${format}-v295.mp4`;
    }
  }
  media.addEventListener('change', selectFormat);
  video.addEventListener('ended', selectFormat);
  selectFormat();
})();
