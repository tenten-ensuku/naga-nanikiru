(function (root) {
  "use strict";
  const drafts = new Map();
  const draft = id => {
    if (!drafts.has(id)) drafts.set(id, { open: false, attachments: [], pending: Promise.resolve(), customTag: "", status: "" });
    return drafts.get(id);
  };
  const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function markup(id, index, text, disabled) {
    const state = draft(id), off = disabled ? " disabled" : "";
    return `<div class="generator-comment-v273" data-comment-composer-v274="${index}">
      <label for="generatorCommentV273-${index}">コメント・解説 <small>任意</small></label>
      <details class="comment-tools-v274"${state.open && !disabled ? " open" : ""}>
        <summary>文字装飾・画像・タグ</summary>
        <fieldset${off}><div class="comment-compose-toolbar" role="toolbar" aria-label="コメントの書式設定">
          <button type="button" data-format="bold"><strong>B</strong> 太字</button>
          <button type="button" data-format="spoiler">|| 伏せ字</button>
          <select data-format-select="color" aria-label="文字色"><option value="">色</option><option value="red">赤</option><option value="yellow">黄</option><option value="blue">青</option><option value="green">緑</option><option value="purple">紫</option></select>
          <select data-format-select="size" aria-label="文字サイズ"><option value="">サイズ</option><option value="large">デカ文字</option></select>
          <button type="button" data-attach>画像を追加</button><input type="file" data-images accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
        </div><div class="comment-tags-v270" data-tags role="group" aria-label="ハッシュタグ候補"></div>
        <label class="comment-custom-tag-v274">オリジナルハッシュタグ<input data-custom-tag maxlength="64" placeholder="例：NANAリーグ検討" value="${escape(state.customTag)}"></label>
        <button type="button" data-create-tag>作成して追加</button>
        <p class="comment-tools-help-v274">文字を選んで書式を適用できます。画像は4枚まで・1枚5MB以内。</p></fieldset>
      </details>
      <textarea id="generatorCommentV273-${index}" data-generator-comment-v273="${index}" rows="3" maxlength="4000" placeholder="この局面の考え方など。問題と一緒にコメント欄へ保存されます。"${off}>${escape(text)}</textarea>
      <div class="generator-attachments-v274" data-attachments></div>
      <div class="generator-comment-preview-v274" data-preview hidden></div>
      <small data-composer-status role="status">${escape(state.status || "解かなくても記入できます。問題と一緒に保存されます。")}</small>
    </div>`;
  }
  function bind(container, id, { tags, suggestions, applyFormat, renderContent, readFile, saveText }) {
    const state = draft(id), input = container.querySelector("textarea"), details = container.querySelector("details");
    if (container.dataset.boundV274) return;
    container.dataset.boundV274 = "true";
    const status = message => { state.status = message; container.querySelector("[data-composer-status]").textContent = message; };
    const refresh = () => {
      saveText(input.value);
      const selected = tags.extractTags(input.value);
      container.querySelector("[data-tags]").innerHTML = tags.tagSuggestions([...suggestions(), ...selected]).map(tag => `<button class="comment-tag-v270" type="button" data-tag="${escape(tag)}"${selected.includes(tag) ? " disabled" : ""}>#${escape(tag)}</button>`).join("");
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
    details.addEventListener("toggle", () => { state.open = details.open; });
    input.addEventListener("input", refresh);
    container.querySelectorAll("[data-format]").forEach(button => button.addEventListener("click", () => applyFormat(button.dataset.format, "", input)));
    container.querySelectorAll("[data-format-select]").forEach(select => select.addEventListener("change", () => {
      if (select.value) applyFormat(select.dataset.formatSelect, select.value, input);
      select.value = "";
    }));
    const append = value => {
      const tag = tags.normalizeTag(value);
      if (!tag) { status("タグは30文字以内の日本語・英数字・_ で入力してください。"); return; }
      const next = tags.appendTag(input.value, tag, input.maxLength);
      if (next === null) { status("コメントが4,000文字を超えるため、タグを追加できません。"); return; }
      input.value = next; input.dispatchEvent(new Event("input", { bubbles: true })); input.focus();
      input.setSelectionRange(next.length, next.length); status(`#${tag} を追加しました。`);
    };
    container.querySelector("[data-tags]").addEventListener("click", event => { const button = event.target.closest("[data-tag]"); if (button && !button.disabled) append(button.dataset.tag); });
    const custom = container.querySelector("[data-custom-tag]");
    custom.addEventListener("input", () => { state.customTag = custom.value; });
    custom.addEventListener("keydown", event => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); append(custom.value); } });
    container.querySelector("[data-create-tag]").addEventListener("click", () => append(custom.value));
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
