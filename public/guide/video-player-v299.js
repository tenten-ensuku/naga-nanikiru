/* A visible entry point; native controls still handle seeking and playback. */
(() => {
  'use strict';
  const video = document.querySelector('.promo-video');
  const button = document.querySelector('.promo-play-button');
  const status = document.querySelector('.promo-play-status');
  if (!video || !button) return;
  const sync = () => {
    button.hidden = !video.paused || (video.currentTime > 0 && !video.ended);
  };
  button.addEventListener('click', async () => {
    if (status) { status.hidden = true; status.textContent = ''; }
    try {
      await video.play();
    } catch {
      if (status) {
        status.textContent = '再生できませんでした。動画下部の再生ボタンから、もう一度お試しください。';
        status.hidden = false;
      }
      sync();
    }
  });
  for (const event of ['play', 'pause', 'ended', 'emptied', 'seeked']) {
    video.addEventListener(event, sync);
  }
  sync();
})();
