// V368: keep "次の問題へ" within thumb reach on phones. When the answer panel's own
// button scrolls out of view (for example while reading comments), a floating copy
// appears at the bottom of the screen. It only forwards clicks to the real button,
// so the next-question logic stays in one place.
(function attachAnswerFlowV368(host) {
  const doc = host.document;
  function create() {
    const source = doc.getElementById("nextQuestionBottomButton");
    if (!source || doc.querySelector(".next-float-v368")) return null;
    const floating = doc.createElement("button");
    floating.type = "button";
    floating.className = "next-float-v368";
    floating.hidden = true;
    floating.addEventListener("click", () => source.click());
    doc.body.append(floating);
    let sourceInView = true;
    const composerOpen = () => doc.getElementById("commentForm")?.hidden === false;
    const typing = () => ["INPUT", "TEXTAREA", "SELECT"].includes(doc.activeElement?.tagName);
    const sync = () => {
      const show = !source.hidden
        && !sourceInView
        && !doc.querySelector(".page.menu-active")
        && !composerOpen()
        && !typing();
      floating.hidden = !show;
      if (floating.textContent !== source.textContent) floating.textContent = source.textContent;
    };
    if (typeof host.IntersectionObserver === "function") {
      new host.IntersectionObserver(entries => {
        sourceInView = entries.some(entry => entry.isIntersecting);
        sync();
      }).observe(source);
    }
    const watch = new host.MutationObserver(sync);
    watch.observe(source, { attributes: true, childList: true, characterData: true, subtree: true });
    const page = doc.querySelector(".page");
    if (page) watch.observe(page, { attributes: true, attributeFilter: ["class"] });
    const form = doc.getElementById("commentForm");
    if (form) watch.observe(form, { attributes: true, attributeFilter: ["hidden"] });
    // Keyboard hint: before answering, and not for call questions (those use their own buttons).
    const hint = doc.getElementById("keyHintV368");
    const strip = doc.getElementById("answerStrip");
    const syncHint = () => {
      if (!hint) return;
      const callQuestion = [...doc.querySelectorAll(".call-choice-button")].some(button => button.offsetParent !== null);
      hint.hidden = Boolean(strip && !strip.hidden) || callQuestion || !doc.querySelector("[data-tile-index]");
    };
    const hintWatch = new host.MutationObserver(syncHint);
    if (strip) hintWatch.observe(strip, { attributes: true, attributeFilter: ["hidden"] });
    const hand = doc.querySelector(".scene-card") || doc.body;
    hintWatch.observe(hand, { childList: true, subtree: true });
    syncHint();
    doc.addEventListener("focusin", sync);
    doc.addEventListener("focusout", () => host.setTimeout(sync, 0));
    sync();
    return { sync, syncHint, element: floating };
  }
  host.MinkiruAnswerFlowV368 = Object.freeze({ create });
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", create, { once: true });
  else create();
})(window);
