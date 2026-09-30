(function(root) {
  'use strict';
  const doc = root.document;
  const storageKey = 'minkiru:sound:v1';
  let enabled = true;
  try { enabled = root.localStorage.getItem(storageKey) !== 'off'; } catch { /* Keep the session preference usable. */ }
  let context = null;
  let revision = 0;
  const voices = new Set();

  function stop() {
    revision++;
    for (const voice of voices) {
      try { voice.oscillator.stop(); } catch { /* Already ended. */ }
      voice.oscillator.disconnect();
      voice.gain.disconnect();
    }
    voices.clear();
  }

  function syncSetting() {
    const input = doc.getElementById('soundToggleV342');
    if (input) input.checked = enabled;
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    if (!enabled) stop();
    try { root.localStorage.setItem(storageKey, enabled ? 'on' : 'off'); } catch { /* Apply even when storage is unavailable. */ }
    syncSetting();
  }

  function notes(audio, frequencies, action) {
    const start = audio.currentTime + .005;
    frequencies.forEach((frequency, index) => {
      const at = start + index * .095;
      const duration = action ? .055 : .22;
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const voice = { oscillator, gain };
      voices.add(voice);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, at);
      if (action) oscillator.frequency.exponentialRampToValueAtTime(frequency * .65, at + duration);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(action ? .075 : .1, at + .006);
      gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
        voices.delete(voice);
      };
      oscillator.start(at);
      oscillator.stop(at + duration + .01);
    });
  }

  // Called only by user actions. Audio failures must never interrupt learning.
  function play(frequencies, action = false) {
    if (!enabled || doc.visibilityState === 'hidden') return;
    const requestedAt = Date.now();
    try {
      const AudioContext = root.AudioContext || root.webkitAudioContext;
      if (!AudioContext) return;
      if (!context || context.state === 'closed') context = new AudioContext();
      const audio = context;
      stop();
      const request = revision;
      const render = () => {
        if (!enabled || request !== revision || doc.visibilityState === 'hidden' || Date.now() - requestedAt > 350 || audio.state !== 'running') return;
        try { notes(audio, frequencies, action); } catch { stop(); }
      };
      if (audio.state === 'running') render();
      else Promise.resolve(audio.resume()).then(render).catch(() => {});
    } catch { /* No audio device, blocked playback, or unsupported browser. */ }
  }

  const playAction = () => play([820], true);
  function playResult(mark) {
    if (mark === '◎') play([659.25, 830.61, 1046.5]);
    else if (mark === '〇' || mark === '○') play([659.25, 880]);
  }

  const controls = 'button, a[href], summary, [role="button"], input[type="button"], input[type="submit"], input[type="reset"], input[type="checkbox"], input[type="radio"]';
  const unavailable = element => !element || element.disabled || element.closest('[disabled], [aria-disabled="true"], [inert]');
  // Capture before a control is rerendered, disabled, or stops propagation.
  // One click also covers keyboard activation and touch without pointer duplicates.
  doc.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const control = event.target?.closest?.(controls);
    if (unavailable(control) || control.id === 'soundToggleV342') return;
    playAction();
  }, true);
  doc.addEventListener('change', event => {
    if (!event.isTrusted || unavailable(event.target)) return;
    if (event.target.id === 'soundToggleV342') {
      setEnabled(event.target.checked);
      if (enabled) playAction();
    } else if (event.target.tagName === 'SELECT') playAction();
  }, true);
  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') stop(); });
  root.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    enabled = event.newValue !== 'off';
    if (!enabled) stop();
    syncSetting();
  });

  function settingsMarkup() {
    return `<div class="dora-settings-v333"><label class="dora-toggle-v333" for="soundToggleV342"><span>操作音・正解音</span><input id="soundToggleV342" type="checkbox" role="switch"${enabled ? ' checked' : ''} aria-describedby="soundHelpV342"></label><p class="settings-form-note" id="soundHelpV342">ボタンや牌・判断の選択時に音を鳴らします。〇・◎の正解時は専用の音が鳴ります。設定はこのブラウザーに保存されます。</p></div>`;
  }

  root.MinkiruSoundV342 = Object.freeze({ playAction, playResult, setEnabled, isEnabled: () => enabled, settingsMarkup });
})(typeof window === 'undefined' ? globalThis : window);
