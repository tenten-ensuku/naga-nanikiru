import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../public/guide/theme-song-v344.js', import.meta.url), 'utf8');
function fixture(hash = '') {
  const eventTarget = fields => ({...fields, events: {}, addEventListener(type, listener) { this.events[type] = listener; }});
  const player = () => eventTarget({paused: true, play() { this.paused = false; }, pause() { this.paused = true; }});
  const song = player(), intro = player();
  const summary = {focus() { this.focused = true; }};
  const panel = eventTarget({open: false, querySelector: selector => selector === 'video' ? song : summary, scrollIntoView() { this.scrolled = true; }});
  const window = eventTarget({location: {hash}});
  vm.runInNewContext(code, {window, document: {getElementById: () => panel, querySelectorAll: () => [intro, song]}});
  return {panel, song, intro, summary, window};
}

test('ordinary guide entry keeps the extra collapsed and silent; its deep link opens without playing', () => {
  const normal = fixture();
  assert.equal(normal.panel.open, false);
  assert.equal(normal.song.paused, true);
  const linked = fixture('#theme-song');
  assert.equal(linked.panel.open, true);
  assert.equal(linked.panel.scrolled, true);
  assert.equal(linked.summary.focused, true);
  assert.equal(linked.song.paused, true);
  normal.window.location.hash = '#theme-song';
  normal.window.events.hashchange();
  assert.equal(normal.panel.open, true);
  assert.equal(normal.song.paused, true);
});

test('closing or leaving the guide pauses the song, and reopening remains silent', () => {
  const f = fixture('#theme-song');
  f.song.play(); f.panel.open = false; f.panel.events.toggle();
  assert.equal(f.song.paused, true);
  f.panel.open = true; f.panel.events.toggle();
  assert.equal(f.song.paused, true);
  f.song.play(); f.window.events.pagehide();
  assert.equal(f.song.paused, true);
});

test('starting either video pauses the other', () => {
  const f = fixture('#theme-song');
  f.intro.play(); f.song.play(); f.song.events.play();
  assert.equal(f.intro.paused, true); assert.equal(f.song.paused, false);
  f.intro.play(); f.intro.events.play();
  assert.equal(f.song.paused, true); assert.equal(f.intro.paused, false);
});
