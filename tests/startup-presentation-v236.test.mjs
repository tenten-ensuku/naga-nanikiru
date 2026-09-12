import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const normalizedHtml = html.replace(/\r\n/g, "\n");
const startupController = normalizedHtml.match(/<script>\s*(\/\/ V236 startup presentation only[\s\S]*?)\s*<\/script>/i)?.[1];

assert.ok(startupController, "V236 startup controller must be extractable from the head");

function createControllerHarness({ gateHidden = true, loginDisabled = true } = {}) {
  const classNames = new Set(["app-pending-v236"]);
  const windowListeners = new Map();
  const documentListeners = new Map();
  const timers = new Map();
  const animationFrames = [];
  const focusLog = [];
  let nextTimerId = 1;

  const status = { textContent: "" };
  const retry = { hidden: true };
  const screen = { hidden: false };
  const card = {
    focus(options) {
      focusLog.push({ target: "card", options });
    }
  };
  const loginButton = {
    disabled: loginDisabled,
    focus(options) {
      focusLog.push({ target: "login", options });
    }
  };
  const gate = {
    hidden: gateHidden,
    querySelector(selector) {
      return selector === ".auth-gate-card" ? card : null;
    }
  };
  const page = { inert: true, ariaHidden: "true" };
  const nodes = {
    startupStatusV236: status,
    startupRetryV236: retry,
    startupScreenV236: screen,
    authGate: gate,
    authGateLoginButton: loginButton,
    page
  };

  function addListener(registry, type, listener, options) {
    const records = registry.get(type) || [];
    records.push({ listener, once: Boolean(options?.once) });
    registry.set(type, records);
  }

  function emit(registry, type, event = {}) {
    const records = [...(registry.get(type) || [])];
    for (const record of records) {
      record.listener(event);
      if (record.once) {
        const current = registry.get(type) || [];
        registry.set(type, current.filter(candidate => candidate !== record));
      }
    }
  }

  const document = {
    documentElement: {
      classList: {
        remove(name) {
          classNames.delete(name);
        },
        contains(name) {
          return classNames.has(name);
        }
      }
    },
    getElementById(id) {
      return nodes[id] || null;
    },
    addEventListener(type, listener, options) {
      addListener(documentListeners, type, listener, options);
    }
  };

  const window = {
    addEventListener(type, listener, options) {
      addListener(windowListeners, type, listener, options);
    },
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay, cancelled: false });
      return id;
    },
    clearTimeout(id) {
      const timer = timers.get(id);
      if (timer) timer.cancelled = true;
    },
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
    }
  };

  vm.runInNewContext(startupController, { window, document }, { filename: "public/index.html#startup-v236" });

  return {
    api: window.MinkiruStartupV236,
    classNames,
    document,
    focusLog,
    gate,
    loginButton,
    page,
    retry,
    screen,
    status,
    timers,
    animationFrames,
    emitDocument(type, event) {
      emit(documentListeners, type, event);
    },
    emitWindow(type, event) {
      emit(windowListeners, type, event);
    },
    flushAnimationFrame() {
      const callbacks = animationFrames.splice(0);
      callbacks.forEach(callback => callback());
    },
    runTimer(id = [...timers.keys()][0]) {
      const timer = timers.get(id);
      if (timer && !timer.cancelled) timer.callback();
    }
  };
}

function finish(harness) {
  harness.flushAnimationFrame();
  harness.flushAnimationFrame();
}

test("V236 keeps the critical presentation shell ahead of app CSS and app content", () => {
  const criticalStyle = normalizedHtml.indexOf('<style id="startupCriticalV236">');
  const rootStyle = normalizedHtml.indexOf("<style>\n    :root");
  const body = normalizedHtml.indexOf('<body class="auth-gate-open">');
  const loader = normalizedHtml.indexOf('<section class="startup-screen-v236" id="startupScreenV236"');
  const main = normalizedHtml.indexOf('<main class="page" inert aria-hidden="true">');

  assert.ok(criticalStyle >= 0);
  assert.ok(rootStyle > criticalStyle, "critical startup CSS must precede the large app stylesheet");
  assert.ok(body >= 0 && body < loader && loader < main, "startup loader must be outside and before the app main");
  assert.match(normalizedHtml, /<html lang="ja" class="app-pending-v236">/);
  assert.match(normalizedHtml, /html\.app-pending-v236 \.page, html\.app-pending-v236 \.page \*,[\s\S]*?html\.app-pending-v236 \.auth-gate, html\.app-pending-v236 \.auth-gate \*,[\s\S]*?visibility:hidden !important; pointer-events:none !important;/);
  assert.match(normalizedHtml, /\.startup-screen-v236 \{ position:fixed; inset:0; z-index:2000;/);
  assert.match(normalizedHtml, /<section class="auth-gate" id="authGate"[^>]* hidden>/);
  assert.match(normalizedHtml, /initImportedQuestionsV16\(\)\.then\(\(\) => window\.MinkiruStartupV236\.ready\(\)\)\.catch\(\(\) => window\.MinkiruStartupV236\.fail\(\)\);/);
  assert.match(normalizedHtml, /if \(window\.MinkiruStartupV236\?\.pending\) return;/);
  assert.match(normalizedHtml, /if \(!window\.MinkiruStartupV236\?\.pending && !authenticated && focusTarget/);
});

test("controller completes only after two animation frames and never changes auth access", () => {
  const harness = createControllerHarness({ gateHidden: false, loginDisabled: true });
  harness.emitDocument("DOMContentLoaded");

  assert.equal(harness.api.pending, true);
  assert.equal(harness.status.textContent, "準備しています…");
  assert.equal(harness.timers.get(1).delay, 12000);
  assert.equal(harness.focusLog.length, 0);

  harness.api.ready();
  assert.equal(harness.animationFrames.length, 1);
  assert.equal(harness.api.pending, true);
  assert.equal(harness.screen.hidden, false);
  assert.equal(harness.classNames.has("app-pending-v236"), true);
  assert.equal(harness.focusLog.length, 0);

  harness.flushAnimationFrame();
  assert.equal(harness.animationFrames.length, 1, "the first frame only schedules the commit frame");
  assert.equal(harness.api.pending, true);
  assert.equal(harness.focusLog.length, 0);

  harness.flushAnimationFrame();
  assert.equal(harness.api.pending, false);
  assert.equal(harness.classNames.has("app-pending-v236"), false);
  assert.equal(harness.screen.hidden, true);
  assert.equal(harness.page.inert, true, "startup presentation must not lift the app inert state");
  assert.equal(harness.page.ariaHidden, "true", "startup presentation must not grant authenticated visibility");
  assert.equal(harness.gate.hidden, false);
  assert.equal(harness.focusLog.length, 1, "focus starts only after the startup commit");
  assert.equal(harness.focusLog[0].target, "card");
  assert.equal(harness.focusLog[0].options.preventScroll, true);
});

test("runtime, script, and stylesheet failures keep a retry screen and reject late completion", () => {
  const errorEvents = [
    { error: { message: "runtime" } },
    { target: { tagName: "SCRIPT" } },
    { target: { tagName: "LINK", rel: "stylesheet" } }
  ];

  for (const event of errorEvents) {
    const harness = createControllerHarness();
    harness.emitDocument("DOMContentLoaded");
    harness.emitWindow("error", event);

    assert.equal(harness.api.pending, true);
    assert.equal(harness.retry.hidden, false);
    assert.equal(harness.status.textContent, "画面を読み込めませんでした。再読み込みをお試しください。");
    assert.equal(harness.classNames.has("app-pending-v236"), true);
    harness.runTimer();
    assert.equal(harness.status.textContent, "画面を読み込めませんでした。再読み込みをお試しください。");

    harness.api.ready();
    assert.equal(harness.animationFrames.length, 0, "fatal state must reject a late ready callback");
    assert.equal(harness.screen.hidden, false);
    assert.equal(harness.api.pending, true);
  }
});

test("a fatal error between the two frames cancels the pending presentation commit", () => {
  const harness = createControllerHarness();
  harness.api.ready();
  harness.flushAnimationFrame();
  assert.equal(harness.animationFrames.length, 1);

  harness.emitWindow("error", { error: { message: "late runtime" } });
  harness.flushAnimationFrame();

  assert.equal(harness.api.pending, true);
  assert.equal(harness.classNames.has("app-pending-v236"), true);
  assert.equal(harness.screen.hidden, false);
  assert.equal(harness.retry.hidden, false);
});

test("the slow message is non-releasing and a later successful completion still commits", () => {
  const harness = createControllerHarness();
  harness.emitDocument("DOMContentLoaded");
  harness.runTimer();

  assert.equal(harness.api.pending, true);
  assert.equal(harness.status.textContent, "接続に時間がかかっています。もう少しお待ちください。");
  assert.equal(harness.retry.hidden, false);
  assert.equal(harness.classNames.has("app-pending-v236"), true);
  assert.equal(harness.screen.hidden, false);
  assert.equal(harness.focusLog.length, 0);

  harness.api.ready();
  finish(harness);
  assert.equal(harness.api.pending, false);
  assert.equal(harness.screen.hidden, true);
  assert.equal(harness.classNames.has("app-pending-v236"), false);
});

test("the presentation controller has no auth or data-loading bypass surface", () => {
  assert.doesNotMatch(startupController, /NagaSupabase|currentSession|authchange|signInWithDiscord|fetch\s*\(/);
  assert.match(startupController, /Never grants access or fetches user data/);
});
