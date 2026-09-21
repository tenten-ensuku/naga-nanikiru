(function (root) {
  "use strict";
  const drafts = new Map();
  const draft = id => {
    if (!drafts.has(id)) drafts.set(id, { attachments: [], pending: Promise.resolve(), status: "" });
    return drafts.get(id);
  };
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function markup(id, index, text, disabled) {
    const state = draft(id), off = disabled ? " disabled" : "";
    return `<div class="generator-comment-v273" data-comment-composer-v274="${index}">
      <label for="generatorCommentV273-${index}">コメント・解説 <small>任意</small></label>
      <div class="comment-compose-editor">
        <div class="comment-input-v324">
          <textarea id="generatorCommentV273-${index}" data-generator-comment-v273="${index}" rows="3" maxlength="4000" aria-describedby="generatorCommentHelpV324-${index}" placeholder="この局面の考え方など。問題と一緒にコメント欄へ保存されます。"${off}>${escape(text)}</textarea>
          <button type="button" data-comment-attach-toggle aria-label="コメントに追加" aria-expanded="false" aria-controls="generatorAttachMenuV324-${index}"${off}>＋</button>
          <div id="generatorAttachMenuV324-${index}" data-comment-attach-menu hidden><button type="button" data-attach${off}>画像を追加</button></div>
          <input type="file" data-images accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden${off}>
        </div>
        <p class="comment-composer-help-v324" id="generatorCommentHelpV324-${index}">文字を選択すると装飾できます。# でタグ候補。</p>
      </div>
      <div class="generator-attachments-v274" data-attachments></div>
      <div class="generator-comment-preview-v274" data-preview hidden></div>
      <small data-composer-status role="status">${escape(state.status)}</small>
    </div>`;
  }
  function bind(container, id, { renderContent, readFile, saveText }) {
    const state = draft(id), input = container.querySelector("textarea");
    if (container.dataset.boundV274) return;
    container.dataset.boundV274 = "true";
    const status = message => { state.status = message; container.querySelector("[data-composer-status]").textContent = message; };
    const refresh = () => {
      saveText(input.value);
      const preview = container.querySelector("[data-preview]");
      preview.hidden = !input.value.trim();
      preview.innerHTML = input.value.trim() ? `<small>表示プレビュー</small><div class="comment-body">${renderContent(input.value)}</div>` : "";
      // This preview deliberately uses the normal renderer, including its safe spoiler behavior.
      preview.querySelectorAll(".comment-spoiler").forEach(el => el.addEventListener("click", () => {
        const revealed = el.classList.toggle("is-revealed");
        el.setAttribute("aria-expanded", String(revealed));
        el.setAttribute("aria-label", revealed ? "伏せ字を隠す" : "伏せ字を表示");
        el.querySelector(".comment-spoiler-content")?.setAttribute("aria-hidden", String(!revealed));
      }));
    };
    const attachments = () => {
      container.querySelector("[data-attachments]").innerHTML = state.attachments.map((a, i) => `<figure><img src="${escape(a.src)}" alt="${escape(a.alt)}"><button type="button" data-remove-image="${i}"${input.disabled ? " disabled" : ""} aria-label="添付画像${i + 1}を外す">×</button></figure>`).join("");
    };
    input.addEventListener("input", refresh);
    const files = container.querySelector("[data-images]");
    function addFiles(list) {
      if (input.disabled) return;
      const chosen = Array.from(list || []);
      // Serialize file reads so selecting/removing several files cannot bypass the four-image limit.
      state.pending = state.pending.then(async () => {
        for (const file of chosen) {
          if (!/^(image\/png|image\/jpeg|image\/webp|image\/gif)$/.test(file.type) || file.size < 1 || file.size > 5 * 1024 * 1024) { status("PNG・JPEG・WebP・GIFの画像を1枚5MB以内で選んでください。"); continue; }
          if (state.attachments.length >= 4) { status("画像は4枚まで追加できます。"); break; }
          try { state.attachments.push({ file, src: await readFile(file), alt: file.name.slice(0, 180) }); status(`${state.attachments.length}枚の画像を添付しました。`); }
          catch { status("画像を読み込めませんでした。もう一度選んでください。"); }
        }
        // Selection can rerender the candidate while a FileReader is pending.
        root.document.querySelectorAll("[data-comment-composer-v274]").forEach(el => { if (el.dataset.draftIdV274 === id) el.dispatchEvent(new Event("attachments-ready-v274")); });
      });
    }
    container.dataset.draftIdV274 = id;
    container.addEventListener("attachments-ready-v274", () => { attachments(); status(state.status); });
    container.querySelector("[data-attach]").addEventListener("click", () => files.click());
    files.addEventListener("change", () => { addFiles(files.files); files.value = ""; });
    input.addEventListener("paste", event => { if (event.clipboardData?.files?.length) { event.preventDefault(); addFiles(event.clipboardData.files); } });
    input.addEventListener("dragover", event => event.preventDefault());
    input.addEventListener("drop", event => { event.preventDefault(); addFiles(event.dataTransfer?.files); });
    container.querySelector("[data-attachments]").addEventListener("click", event => {
      const button = event.target.closest("[data-remove-image]");
      if (!button || input.disabled) return;
      state.attachments.splice(Number(button.dataset.removeImage), 1); attachments(); status(`${state.attachments.length}枚の画像を添付しています。`);
    });
    root.MinkiruCommentSelectionV321?.bind(input);
    root.MinkiruCommentComposerV324?.bind(input);
    refresh(); attachments();
  }
  async function getAttachments(id) { const state = draft(id); await state.pending; return state.attachments.slice(); }
  // One UI operation at a time, including confirmation. Both bulk buttons share this guard.
  let saving = false;
  async function saveOnce(action) {
    if (saving) return false;
    saving = true;
    try { return await action(); } finally { saving = false; }
  }
  root.MinkiruCommentToolsV274 = { markup, bind, getAttachments, saveOnce };
})(globalThis);
