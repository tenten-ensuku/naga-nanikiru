// V379: on phones the whole table is drawn in ~350px, so each hand tile is only ~15px wide.
// This tray repeats the hand (and the call buttons) under the board at a size that is easy to
// read and tap. It only mirrors the real buttons and forwards taps to them, so tile selection,
// answering and every rule stay in the board code.
(function attachHandTrayV379(host) {
  const doc = host.document;
  let tray = null, frame = null, observer = null, signature = "", scheduled = false;

  function tileSource(button) {
    return button.querySelector("img")?.getAttribute("src") || "";
  }

  function snapshot() {
    const tiles = [...frame.querySelectorAll(".hand-layer [data-tile-index]")];
    const calls = [...frame.querySelectorAll("[data-call-decision]")].filter(button => button.offsetParent !== null);
    return { tiles, calls };
  }

  function keyOf({ tiles, calls }) {
    return tiles.map(b => [b.dataset.tileIndex, tileSource(b), b.className, b.disabled, b.closest(".draw-tile") ? 1 : 0].join(":")).join("|")
      + "#" + calls.map(b => [b.dataset.callDecision, b.textContent, b.className, b.disabled].join(":")).join("|");
  }

  function render() {
    scheduled = false;
    if (!frame || !tray) return;
    const state = snapshot();
    const key = keyOf(state);
    if (key === signature) return;
    signature = key;
    const tileRow = doc.createElement("div");
    tileRow.className = "hand-tray-tiles-v379";
    for (const source of state.tiles) {
      const button = doc.createElement("button");
      button.type = "button";
      button.tabIndex = -1;
      button.className = "hand-tray-tile-v379";
      if (source.classList.contains("is-selected")) button.classList.add("is-selected");
      if (source.classList.contains("is-judge-recommendation")) button.classList.add("is-recommended");
      if (source.closest(".draw-tile")) button.classList.add("is-draw");
      button.disabled = source.disabled;
      const img = doc.createElement("img");
      img.src = tileSource(source);
      img.alt = "";
      img.draggable = false;
      button.append(img);
      button.addEventListener("click", () => source.click());
      tileRow.append(button);
    }
    const nodes = [tileRow];
    if (state.calls.length) {
      const callRow = doc.createElement("div");
      callRow.className = "hand-tray-calls-v379";
      for (const source of state.calls) {
        const button = doc.createElement("button");
        button.type = "button";
        button.tabIndex = -1;
        button.className = "hand-tray-call-v379";
        if (source.classList.contains("is-selected")) button.classList.add("is-selected");
        if (source.classList.contains("call-no")) button.classList.add("is-pass");
        button.disabled = source.disabled;
        button.textContent = source.textContent.trim();
        button.addEventListener("click", () => source.click());
        callRow.append(button);
      }
      nodes.push(callRow);
    }
    tray.replaceChildren(...nodes);
    tray.hidden = state.tiles.length === 0;
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    (host.requestAnimationFrame || (fn => host.setTimeout(fn, 16)))(render);
  }

  function attach() {
    const nextFrame = doc.querySelector(".scene-card > .scene-frame");
    if (!nextFrame) return;
    if (nextFrame !== frame) {
      frame = nextFrame;
      observer?.disconnect();
      observer = new host.MutationObserver(schedule);
      observer.observe(frame, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "disabled", "src", "hidden", "style"] });
    }
    if (!tray || !tray.isConnected) {
      tray = doc.createElement("div");
      tray.className = "hand-tray-v379";
      tray.hidden = true;
      // The real tile buttons stay the accessible, keyboard-reachable controls.
      tray.setAttribute("aria-hidden", "true");
      frame.after(tray);
      signature = "";
    }
    schedule();
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", attach, { once: true });
  else attach();
  host.addEventListener?.("resize", schedule);
  host.MinkiruHandTrayV379 = { refresh: attach };
})(window);
