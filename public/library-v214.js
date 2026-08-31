/* Min-kiru library, updated in V215. Only device-local bookshelf order is stored.
 * UI icons: Heroicons (MIT), Copyright (c) Tailwind Labs, Inc.
 * See assets/library-v214/heroicons-LICENSE.txt.
 */
(function (host) {
  "use strict";

  const ASSET_ROOT = "assets/library-v214/";
  const ICON_PATHS = Object.freeze({
    book: "M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25",
    left: "M15.75 19.5 8.25 12l7.5-7.5",
    right: "m8.25 4.5 7.5 7.5-7.5 7.5",
    check: "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    plus: "M12 4.5v15m7.5-7.5h-15"
  });
  const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  const icon = name => `<svg class="library-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="${ICON_PATHS[name] || ICON_PATHS.book}"/></svg>`;
  const count = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
    ? Math.max(0, Math.floor(Number(value))) : null;
  const formatted = value => value === null ? "—" : Number(value).toLocaleString("ja-JP");
  const isSeries = row => Boolean(row?.is_series_parent) || Boolean(row?.series_key && !row?.series_parent_id && Number(row?.volume_count) > 0);
  const rootSlug = row => String(row?.series_parent_slug || (isSeries(row) ? row?.share_slug : "") || "");
  const coverTitle = title => /.+問題集$/.test(title)
    ? `<span>${escape(title.slice(0, -3))}</span><small>問題集</small>` : escape(title);

  function bookTone(row) {
    const title = String(row?.series_title || row?.display_title || row?.title || "");
    if (/基本序列/.test(title)) return "ivory";
    if (/ピエール/.test(title)) return "walnut";
    if (/くにたそ|クニタソ/.test(title)) return "navy";
    if (/垣崎|にま/.test(title)) return "forest";
    const hash = Array.from(title).reduce((total, character) => total + character.codePointAt(0), 0);
    return ["burgundy", "forest", "navy", "walnut"][hash % 4];
  }

  function normaliseBook(row, currentSlug = "", progress = null) {
    const slug = String(row?.share_slug || "");
    const volume = count(row?.volume_number);
    const series = isSeries(row);
    const fullTitle = String(row?.display_title || row?.title || "問題集").trim();
    const spineTitle = String(row?.series_title || fullTitle)
      .replace(/[\s　]*全\d+巻\s*$/, "")
      .replace(volume ? new RegExp(`[\\s　]*第${volume}巻\\s*$`) : /$^/, "");
    const total = count(row?.question_count ?? progress?.question_count);
    const answeredRaw = count(progress?.answered_count);
    const masteredRaw = count(progress?.mastered_count);
    const answered = answeredRaw === null ? null : Math.min(total ?? answeredRaw, answeredRaw);
    // Archives are mastered too, so mastery is not bounded by answered count.
    const mastered = masteredRaw === null ? null : Math.min(total ?? masteredRaw, masteredRaw);
    const canView = row?.can_view === true || row?.can_edit === true || row?.can_manage === true
      || (slug === currentSlug && row?.can_view !== false);
    return {
      ...row, slug, fullTitle, spineTitle, volume, series, canView,
      seriesParentSlug: String(row?.series_parent_slug || ""),
      volumeCount: count(row?.volume_count), tone: bookTone(row),
      questionCount: total, answeredCount: answered,
      mastery: mastered === null || total === null ? null : total ? Math.round(mastered / total * 100) : 0,
      isCurrent: slug === currentSlug,
      description: String(row?.description || "").trim(),
      accessLabel: String(row?.status_label || (canView ? "学習できます" : row?.request_status === "pending" ? "閲覧申請中" : "閲覧権限を確認"))
    };
  }

  function catalogueRoots(rows) {
    const valid = (Array.isArray(rows) ? rows : []).filter(row => row?.share_slug && row?.title);
    const knownRoots = new Set(valid.filter(isSeries).map(row => String(row.share_slug)));
    const seen = new Set();
    return valid.filter(row => {
      const slug = String(row.share_slug);
      if (seen.has(slug)) return false;
      seen.add(slug);
      return !(row?.series_parent_id && knownRoots.has(rootSlug(row)));
    });
  }

  function bookMarkup(book, selected, { picked = false } = {}) {
    const titleLength = Array.from(book.spineTitle).length;
    const placeholder = book.series && book.canView;
    const tag = placeholder ? "div" : "button";
    const action = placeholder ? "巻を準備しています" : book.canView ? "確認して選ぶ" : "閲覧権限を確認する";
    const attributes = placeholder ? `role="status" data-library-placeholder="${escape(book.slug)}"` : `type="button" data-library-book="${escape(book.slug)}" aria-pressed="${picked}"`;
    return `<${tag} class="library-book library-tone-${book.tone}${placeholder ? " is-placeholder" : ""}${selected ? " is-selected" : ""}${picked ? " is-picked" : ""}${book.isCurrent ? " is-current" : ""}${titleLength > 15 ? " has-long-title" : ""}${titleLength > 30 ? " has-very-long-title" : ""}" ${attributes} aria-label="${escape(book.fullTitle)}：${action}" aria-describedby="libraryBookHintV214" ${book.isCurrent ? 'aria-current="true"' : ""}>
      <span class="library-book-surface" aria-hidden="true"><img class="library-spine-art" src="${ASSET_ROOT}spine.webp" alt="" width="160" height="960" decoding="async" draggable="false"><span class="library-leather-tint"></span><span class="library-book-title">${escape(book.spineTitle)}</span>${book.volume ? `<span class="library-book-volume is-number">${book.volume}</span>` : ""}<span class="library-book-seal">${icon("book")}</span></span>
      ${book.isCurrent ? '<span class="library-current-marker">学習中</span>' : ""}
      <span class="library-book-tooltip" aria-hidden="true">${escape(book.fullTitle)}<small>${action}</small></span>
    </${tag}>`;
  }

  function detailMarkup(book, context, picked = false) {
    if (!book) return `<div class="library-detail-empty">本棚から問題集を選んでください。</div>`;
    let total = book.questionCount;
    let answered = book.answeredCount;
    let mastery = book.mastery;
    if (book.slug === String(context.current?.share_slug || "") && context.currentMetrics) {
      total = count(context.currentMetrics.questionCount) ?? total;
      answered = count(context.currentMetrics.answeredCount) ?? answered;
      mastery = count(context.currentMetrics.mastery) ?? mastery;
    }
    const hasRange = book.volume && count(book.volume_start) !== null && count(book.volume_end) !== null;
    const title = book.volume && !new RegExp(`第${book.volume}巻`).test(book.fullTitle) ? `${book.fullTitle} 第${book.volume}巻` : book.fullTitle;
    const quantityLabel = total === null && book.series ? "収録巻数" : "収録問題数";
    const quantityValue = total === null && book.series ? (book.volumeCount === null ? "—" : `全${book.volumeCount}`) : formatted(total);
    const unit = total === null && book.series ? "巻" : "問";
    const action = book.series && book.canView ? "巻を読み込む" : book.canView ? "この本で学ぶ" : "閲覧権限を確認する";
    const description = book.description || (book.series ? "巻ごとに、一歩ずつ学習を進めましょう。" : "一問ずつ考えて、判断の引き出しを増やしましょう。");
    return `<div class="library-detail-copy"><span class="library-detail-eyebrow">${picked ? "この本で学びますか？" : book.isCurrent ? "学習中の一冊" : "本をタップして選択"}</span><h4 id="libraryDetailTitleV214">${escape(title)}</h4><p>${escape(description)}</p>${hasRange ? `<span class="library-detail-range">問題 ${book.volume_start}–${book.volume_end}</span>` : ""}</div>
      <dl class="library-detail-metrics"><div><dt>${icon("book")}${quantityLabel}</dt><dd>${quantityValue}<small>${quantityValue === "—" ? "" : unit}</small></dd></div><div><dt>${icon("check")}回答済み</dt><dd>${formatted(answered)}<small>${answered === null ? "" : "問"}</small></dd></div><div><dt title="直近の正解、またはアーカイブ済みの問題の割合"><span class="library-progress-ring" aria-hidden="true"></span>やりこみ度</dt><dd>${formatted(mastery)}<small>${mastery === null ? "" : "%"}</small></dd></div></dl>
      <div class="library-detail-action"><button type="button" class="library-start" data-library-open="${escape(book.slug)}">${action}${icon("right")}</button><small>${!book.canView ? escape(book.accessLabel) : picked ? "本をもう1回タップしても開けます" : "回答記録はそのまま引き継ぎます"}</small></div>`;
  }

  function create(options = {}) {
    const order = host.MinkiruLibraryOrderV215;
    const cleanOrder = ids => order?.normaliseOrder(ids) || [...new Set((Array.isArray(ids) ? ids : []).filter(id => typeof id === "string" && id))];
    const defaultOrder = entries => order?.defaultOrder(entries) || entries.map(book => book.slug);
    const state = {
      context: {}, userId: null, sessionRevision: 0, currentSlug: "", selected: "", picked: "", userSelected: false,
      cache: new Map(), summaries: new Map(), inflight: new Map(), failures: new Map(),
      staleSeries: new Set(), staleSummaries: new Set(), savedOrder: [],
      root: null, abort: null, observer: null, entries: [], opening: false,
      scrollLeft: 0, focusAfterRender: "", error: "", drag: null, needsRender: false,
      suppressClick: { slug: "", until: 0 }
    };
    const visible = () => options.isVisible?.() !== false;
    function requestRender() {
      if (state.drag) { state.needsRender = true; return; }
      const focused = host.document?.activeElement?.closest?.("[data-library-book]");
      if (focused && state.root?.contains?.(focused)) state.focusAfterRender = focused.dataset.libraryBook;
      options.onRender?.();
    }
    const rootsNow = () => catalogueRoots(state.context.collections);
    const currentSlugNow = () => String(state.context.current?.share_slug || "");
    const reorderReady = () => state.entries.every(book => !book.series || !book.canView);
    const permittedRoot = slug => {
      const row = rootsNow().find(item => String(item.share_slug) === slug);
      return row && normaliseBook(row, currentSlugNow()).canView ? row : null;
    };
    const permittedSummary = slug => {
      if (permittedRoot(slug)) return true;
      return [...state.cache].some(([parentSlug, cached]) => permittedRoot(parentSlug)
        && cached.volumes.some(row => String(row.share_slug) === slug && normaliseBook(row, currentSlugNow()).canView));
    };
    function orderedEntries(entries) {
      const ids = order?.applySavedOrder(entries, state.savedOrder) || cleanOrder([...state.savedOrder, ...defaultOrder(entries)]);
      const byId = new Map(entries.map(book => [book.slug, book]));
      return ids.map(id => byId.get(id)).filter(Boolean);
    }
    function detail() {
      const book = state.entries.find(item => item.slug === state.selected);
      const position = state.entries.findIndex(item => item.slug === state.selected);
      const picked = Boolean(book && book.slug === state.picked);
      return detailMarkup(book, state.context, picked) + (picked ? `
        <div class="library-arrange" role="group" aria-label="選んだ本の並べ替え">
          <span>${reorderReady() ? "つかんで移動" : "巻の準備が終わると並べ替えできます"} <small>ドラッグ / Shift＋← →</small></span>
          <div><button type="button" data-library-move="-1" aria-label="選んだ本を左へ移動" ${!reorderReady() || position <= 0 ? "disabled" : ""}>${icon("left")}左へ</button>
          <span data-library-position>${position + 1} / ${state.entries.length}冊</span>
          <button type="button" data-library-move="1" aria-label="選んだ本を右へ移動" ${!reorderReady() || position >= state.entries.length - 1 ? "disabled" : ""}>右へ${icon("right")}</button></div>
        </div>` : "");
    }
    function updateDetail() {
      const panel = state.root?.querySelector("[data-library-detail]");
      if (panel) panel.innerHTML = detail();
    }
    function announce(message) {
      const node = state.root?.querySelector("[data-library-status]");
      if (node) node.textContent = message;
    }
    function render(context = {}) {
      // A parent render can replace the rail. Cancel a pointer gesture before that happens.
      if (state.drag) finishDrag(true, true);
      state.context = context;
      const userId = String(context.userId || "");
      if (state.userId !== userId) {
        state.userId = userId;
        state.sessionRevision += 1;
        state.cache.clear();
        state.summaries.clear();
        state.inflight.clear();
        state.failures.clear();
        state.staleSeries.clear();
        state.staleSummaries.clear();
        state.selected = "";
        state.picked = "";
        state.userSelected = false;
        state.currentSlug = "";
        state.scrollLeft = 0;
        state.error = "";
        try { state.savedOrder = cleanOrder(options.loadOrder?.(userId)); }
        catch { state.savedOrder = []; }
      }
      const roots = rootsNow();
      const currentSlug = currentSlugNow();
      if (currentSlug !== state.currentSlug) {
        state.currentSlug = currentSlug;
        state.selected = currentSlug;
        state.picked = "";
        state.userSelected = false;
      }
      if (state.root?.isConnected) state.scrollLeft = state.root.querySelector("[data-library-rail]")?.scrollLeft || 0;
      const entries = [];
      for (const row of roots) {
        const slug = String(row.share_slug);
        const parent = normaliseBook(row, currentSlug);
        if (!parent.canView) { state.cache.delete(slug); state.summaries.delete(slug); }
        const cached = parent.canView ? state.cache.get(slug) : null;
        if (parent.series && cached?.volumes?.length) {
          for (const volume of cached.volumes) {
            const progress = state.summaries.get(String(volume.share_slug)) || cached.progress.find(item => Number(item.volume_number) === Number(volume.volume_number));
            entries.push(normaliseBook({ ...volume, question_count: progress?.question_count ?? volume.question_count, series_title: row.series_title || row.display_title || row.title,
              series_parent_slug: slug, series_key: row.series_key }, currentSlug, progress));
          }
        } else {
          const summary = parent.canView ? state.summaries.get(slug) : null;
          entries.push(normaliseBook({ ...row, ...(summary ? { question_count: summary.question_count, last_activity_at: summary.last_activity_at } : {}) }, currentSlug, summary));
        }
      }
      state.entries = orderedEntries(entries);
      const selected = (!state.userSelected && state.entries.find(row => row.isCurrent)) || state.entries.find(row => row.slug === state.selected)
        || state.entries.find(row => row.isCurrent) || state.entries[0];
      state.selected = selected?.slug || "";
      if (!state.entries.some(row => row.slug === state.picked)) state.picked = "";
      const notice = state.error || String(context.error || "") || (state.failures.size ? "一部の件数・進捗を読み込めませんでした。表示できる本はそのまま選べます。" : "");
      return `<section class="collection-chooser library-v214 has-volumes${reorderReady() ? " is-reorder-ready" : ""}" aria-labelledby="collectionChooserHeading">
        <header class="collection-chooser-header library-header"><div><h3 id="collectionChooserHeading">学習する問題集を選択</h3><p id="libraryBookHintV214">1タップで確認、もう一度で開く。</p></div><button class="collection-chooser-create library-create" type="button" data-menu-jump="settings">${icon("plus")}新しい問題集</button></header>
        <div class="library-shelf-heading"><div class="library-breadcrumb"><h4>あなたの本棚</h4><span class="library-shelf-total">${state.entries.length}冊</span></div><button type="button" class="library-reset" data-library-reset>標準順に戻す</button><div class="library-rail-actions" data-library-rail-actions><button type="button" data-library-scroll="-1" aria-label="前の本を表示">${icon("left")}</button><button type="button" data-library-scroll="1" aria-label="次の本を表示">${icon("right")}</button></div></div>
        ${notice ? `<div class="library-notice" role="alert"><span>${escape(notice)}</span>${state.failures.size ? '<button type="button" data-library-retry>もう一度読み込む</button>' : ""}</div>` : ""}
        <div class="library-stage"><img class="library-study-art" src="${ASSET_ROOT}study.webp" alt="" width="1672" height="941" decoding="async" fetchpriority="high"><div class="library-rail" data-library-rail role="group" aria-label="すべての問題集の本棚">${state.entries.map(book => bookMarkup(book, book.slug === state.selected, { picked: book.slug === state.picked })).join("") || `<p class="library-empty" role="status">${context.loading ? "問題集を本棚に並べています…" : "まだ問題集がありません。新しい問題集を作るか、共有された問題集を開いてください。"}</p>`}</div></div>
        <div class="library-shelf-foot"><span>本をそのままドラッグして並べ替え</span><span>並び順はこのブラウザーに保存</span></div>
        <section class="library-detail" data-library-detail aria-labelledby="libraryDetailTitleV214">${detail()}</section>
        <p class="library-order-status" data-library-status role="status" aria-live="polite"></p>
      </section>`;
    }
    function setSelection(slug, picked = true) {
      if (state.opening) return;
      const book = state.entries.find(row => row.slug === slug);
      if (!book || (book.series && book.canView)) return;
      state.selected = slug;
      if (picked) { state.picked = slug; state.userSelected = true; }
      state.root?.querySelectorAll("[data-library-book]").forEach(button => {
        const isPicked = button.dataset.libraryBook === state.picked;
        button.classList.toggle("is-selected", button.dataset.libraryBook === slug);
        button.classList.toggle("is-picked", isPicked);
        button.setAttribute("aria-pressed", String(isPicked));
      });
      updateDetail();
      if (picked) announce(book.fullTitle + "を選びました。もう一度押すと開きます。ドラッグ、または左右ボタンで並べ替えできます。");
      if (picked) queueMicrotask(hydrate);
    }
    async function browseSeries(slug, { force = false, focus = false } = {}) {
      if (!state.userId || options.canOpen?.() === false) return false;
      const parent = permittedRoot(slug);
      if (!parent || !isSeries(parent)) return false;
      const key = "series:" + slug;
      if (state.inflight.has(key)) return state.inflight.get(key);
      if (state.cache.has(slug) && !force && !state.staleSeries.has(slug)) return true;
      const revision = state.sessionRevision;
      const task = (async () => {
        try {
          const result = await Promise.resolve().then(() => options.loadSeries?.(slug));
          if (state.sessionRevision !== revision || !permittedRoot(slug)) return false;
          const volumes = (Array.isArray(result?.volumes) ? result.volumes : []).filter(row => row?.share_slug)
            .sort((a, b) => Number(a.volume_number) - Number(b.volume_number));
          if (!volumes.length) throw new Error("選べる巻がありません。問題集の閲覧権限をご確認ください。");
          state.cache.set(slug, { volumes, progress: Array.isArray(result?.progress) ? result.progress : [] });
          state.staleSeries.delete(slug);
          state.failures.delete(key);
          if (result?.progressError) state.failures.set(key, "進捗の取得に失敗しました。");
          if (state.selected === slug && !state.userSelected) {
            state.selected = String(volumes[0].share_slug);
            state.picked = "";
            if (focus) state.focusAfterRender = state.selected;
          }
          return true;
        } catch (error) {
          if (state.sessionRevision === revision) state.failures.set(key, error?.message || "巻を読み込めませんでした。");
          return false;
        } finally {
          if (state.sessionRevision === revision) {
            state.inflight.delete(key);
            if (visible()) requestRender();
          }
        }
      })();
      state.inflight.set(key, task);
      return task;
    }
    async function loadSummary(slug) {
      if (!state.userId || !permittedSummary(slug) || !options.loadSummary) return false;
      const key = "summary:" + slug;
      if (state.inflight.has(key)) return state.inflight.get(key);
      const revision = state.sessionRevision;
      const task = (async () => {
        try {
          const parentSlug = state.entries.find(book => book.slug === slug)?.seriesParentSlug || "";
          const summary = await Promise.resolve().then(() => options.loadSummary(slug, parentSlug));
          if (state.sessionRevision !== revision || !permittedSummary(slug)) return false;
          if (!summary || count(summary.question_count) === null) throw new Error("件数・進捗を読み込めませんでした。");
          state.summaries.set(slug, summary);
          state.staleSummaries.delete(slug);
          state.failures.delete(key);
          return true;
        } catch (error) {
          if (state.sessionRevision === revision) state.failures.set(key, error?.message || "進捗を読み込めませんでした。");
          return false;
        } finally {
          if (state.sessionRevision === revision) {
            state.inflight.delete(key);
            if (visible()) requestRender();
          }
        }
      })();
      state.inflight.set(key, task);
      return task;
    }
    function hydrate() {
      if (!visible() || !state.userId || state.opening) return;
      const selected = state.entries.find(book => book.slug === state.selected && !book.series && book.canView);
      if (selected && options.loadSummary && state.inflight.size < 2 && !state.inflight.has("summary:" + selected.slug)
          && !state.failures.has("summary:" + selected.slug) && (!state.summaries.has(selected.slug) || state.staleSummaries.has(selected.slug))) void loadSummary(selected.slug);
      // Metadata only, at most two collection requests in flight. Never load question payloads.
      for (const row of rootsNow()) {
        if (state.inflight.size >= 2) break;
        const slug = String(row.share_slug);
        if (!permittedRoot(slug)) continue;
        if (isSeries(row)) {
          const key = "series:" + slug;
          if (!state.inflight.has(key) && !state.failures.has(key) && (!state.cache.has(slug) || state.staleSeries.has(slug))) void browseSeries(slug);
        } else if (options.loadSummary) {
          const key = "summary:" + slug;
          if (!state.inflight.has(key) && !state.failures.has(key) && (!state.summaries.has(slug) || state.staleSummaries.has(slug))) void loadSummary(slug);
        }
      }
    }
    function updateRailControls() {
      const rail = state.root?.querySelector("[data-library-rail]");
      if (!rail) return;
      const overflowing = rail.scrollWidth > rail.clientWidth + 2;
      state.root.querySelector(".library-v214")?.classList.toggle("is-scrollable", overflowing);
      const previous = state.root.querySelector('[data-library-scroll="-1"]');
      const next = state.root.querySelector('[data-library-scroll="1"]');
      if (previous) previous.disabled = !overflowing || rail.scrollLeft < 2;
      if (next) next.disabled = !overflowing || rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 2;
    }
    function applyOrder(ids) {
      const byId = new Map(state.entries.map(book => [book.slug, book]));
      state.entries = cleanOrder(ids).map(id => byId.get(id)).filter(Boolean);
      const rail = state.root?.querySelector("[data-library-rail]");
      if (rail) {
        const buttons = new Map([...rail.querySelectorAll("[data-library-book], [data-library-placeholder]")].map(button => [button.dataset.libraryBook || button.dataset.libraryPlaceholder, button]));
        for (const book of state.entries) { const button = buttons.get(book.slug); if (button) rail.append(button); }
      }
      updateDetail();
      updateRailControls();
    }
    function saveOrder(ids) {
      // Keep temporarily unavailable IDs in the preference, but never render them.
      const visibleIds = cleanOrder(ids);
      state.savedOrder = cleanOrder([...visibleIds, ...state.savedOrder.filter(id => !visibleIds.includes(id))]);
      try {
        options.saveOrder?.(state.userId, state.savedOrder.slice());
        announce("本の並び順をこのブラウザーに保存しました。");
        return true;
      } catch {
        announce("並び替えましたが、ブラウザーに保存できませんでした。この画面を開いている間だけ維持します。");
        return false;
      }
    }
    function moveSelected(direction) {
      if (!reorderReady()) return;
      const ids = state.entries.map(book => book.slug);
      const index = ids.indexOf(state.selected);
      const target = ids[index + direction];
      if (!target || !order) return;
      setSelection(state.selected);
      const changed = order.moveBook(ids, state.selected, target, { after: direction > 0 });
      applyOrder(changed);
      if (saveOrder(changed)) announce(state.entries[index + direction].fullTitle + "を" + (index + direction + 1) + "番目に移動しました。");
      [...(state.root?.querySelectorAll("[data-library-book]") || [])].find(button => button.dataset.libraryBook === state.selected)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    }
    function dragOrderAtPointer() {
      const drag = state.drag;
      if (!drag?.started || !order) return;
      const others = [...drag.rail.querySelectorAll("[data-library-book]")].filter(button => button !== drag.source);
      const next = others.find(button => { const rect = button.getBoundingClientRect(); return drag.x < rect.left + rect.width / 2; });
      const target = next || others.at(-1);
      if (!target) return;
      const ids = order.moveBook(state.entries.map(book => book.slug), drag.slug, target.dataset.libraryBook, { after: !next });
      if (ids.join("\n") !== state.entries.map(book => book.slug).join("\n")) applyOrder(ids);
    }
    function dragFrame() {
      const drag = state.drag;
      if (!drag?.started) return;
      const rect = drag.rail.getBoundingClientRect();
      const edge = Math.min(45, rect.width / 5);
      const delta = drag.x < rect.left + edge ? -Math.min(12, (rect.left + edge - drag.x) / 3)
        : drag.x > rect.right - edge ? Math.min(12, (drag.x - rect.right + edge) / 3) : 0;
      if (delta) { drag.rail.scrollLeft += delta; dragOrderAtPointer(); }
      drag.frame = host.requestAnimationFrame?.(dragFrame);
    }
    function startDrag(event) {
      const drag = state.drag;
      if (!drag || drag.started) return;
      const doc = host.document;
      if (!doc?.createElement || !drag.source.cloneNode) return;
      // The first press may become either a normal preview tap or a drag.
      // Once movement crosses the threshold, select that book in place and
      // continue directly into reordering without requiring a prior tap.
      if (state.picked !== drag.slug) setSelection(drag.slug);
      // Capture on the stable parent: moving the book node would otherwise release capture.
      drag.captureTarget = state.root;
      try { drag.captureTarget.setPointerCapture?.(drag.pointerId); }
      catch { finishDrag(true); announce("左右ボタンで本を移動できます。"); return; }
      drag.started = true;
      const rect = drag.source.getBoundingClientRect();
      drag.width = rect.width;
      drag.height = rect.height;
      drag.offsetX = drag.startX - rect.left;
      drag.offsetY = drag.startY - rect.top;
      const layer = doc.createElement("div");
      layer.className = "library-v214 library-drag-layer";
      layer.setAttribute("aria-hidden", "true");
      layer.inert = true;
      const ghost = drag.source.cloneNode(true);
      ghost.removeAttribute("data-library-book");
      ghost.removeAttribute("aria-describedby");
      ghost.tabIndex = -1;
      layer.append(ghost);
      doc.body.append(layer);
      drag.ghost = layer;
      drag.source.classList.toggle("is-drag-source", true);
      state.root?.querySelector(".library-v214")?.classList.toggle("is-reordering", true);
      announce("本を移動中です。離すと保存、Escapeで元に戻します。");
      dragFrame();
      event.preventDefault();
    }
    function pointerMove(event) {
      const drag = state.drag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (!drag.started && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 7) startDrag(event);
      if (!drag.started) return;
      event.preventDefault();
      drag.ghost.style.cssText = "left:" + (drag.x - drag.offsetX) + "px;top:" + (drag.y - drag.offsetY) + "px;width:" + drag.width + "px;height:" + drag.height + "px";
      dragOrderAtPointer();
    }
    function finishDrag(cancelled = false, quiet = false) {
      const drag = state.drag;
      if (!drag) return;
      state.drag = null;
      if (drag.frame !== undefined) host.cancelAnimationFrame?.(drag.frame);
      for (const target of new Set([drag.captureTarget, drag.source])) {
        try { target?.releasePointerCapture?.(drag.pointerId); } catch {}
      }
      drag.ghost?.remove();
      drag.source.classList.toggle("is-drag-source", false);
      state.root?.querySelector(".library-v214")?.classList.toggle("is-reordering", false);
      if (drag.started) {
        state.suppressClick = { slug: drag.slug, until: Date.now() + 450 };
        if (cancelled) {
          applyOrder(drag.before);
          if (!quiet) announce("移動を取り消しました。");
        } else {
          saveOrder(state.entries.map(book => book.slug));
        }
      }
      if (state.needsRender) {
        state.needsRender = false;
        if (!quiet) host.setTimeout(() => { if (visible()) requestRender(); }, 0);
      }
    }
    async function openBook(slug, source) {
      if (state.opening || state.drag?.started) return false;
      const book = state.entries.find(row => row.slug === slug);
      if (!book || !state.userId || options.canOpen?.() === false) return false;
      setSelection(slug);
      if (book.series && book.canView) return browseSeries(slug, { focus: true, force: state.failures.has("series:" + slug) });
      state.opening = true;
      state.root?.querySelector(".library-v214")?.setAttribute("aria-busy", "true");
      try { return await takeBook(book, source, () => options.onOpen?.(slug)); }
      catch (error) {
        state.error = error?.message || "問題集を開けませんでした。もう一度お試しください。";
        if (visible()) requestRender();
        return false;
      } finally {
        state.opening = false;
        state.root?.querySelector(".library-v214")?.removeAttribute("aria-busy");
      }
    }
    function mount(root) {
      state.abort?.abort();
      state.observer?.disconnect();
      state.root = root;
      if (!root?.querySelector(".library-v214")) return;
      if (!state.coverPreload && host.Image) {
        state.coverPreload = new host.Image();
        state.coverPreload.src = ASSET_ROOT + "cover.webp";
      }
      state.abort = new AbortController();
      const signal = state.abort.signal;
      root.addEventListener("pointerdown", event => {
        if (state.drag) return;
        // A fresh physical tap is intentional, even immediately after a cancelled drag.
        state.suppressClick = { slug: "", until: 0 };
        const source = event.target.closest("[data-library-book]");
        if (!source || !reorderReady() || state.opening || (event.button !== undefined && event.button !== 0)) return;
        state.drag = { source, slug: source.dataset.libraryBook, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
          x: event.clientX, y: event.clientY, rail: root.querySelector("[data-library-rail]"), before: state.entries.map(book => book.slug), started: false, captureTarget: source };
        try { source.setPointerCapture?.(event.pointerId); }
        catch { state.drag = null; announce("左右ボタンで本を移動できます。"); }
      }, { signal });
      root.addEventListener("pointermove", pointerMove, { signal, passive: false });
      root.addEventListener("pointerup", event => {
        if (state.drag?.pointerId !== event.pointerId) return;
        if (state.drag.started) event.preventDefault();
        finishDrag(false);
      }, { signal });
      root.addEventListener("pointercancel", event => { if (event.pointerId === state.drag?.pointerId) finishDrag(true); }, { signal });
      root.addEventListener("lostpointercapture", event => { if (event.target === state.drag?.captureTarget && event.pointerId === state.drag?.pointerId) finishDrag(true); }, { signal });
      host.addEventListener?.("blur", () => finishDrag(true), { signal });
      host.document?.addEventListener?.("visibilitychange", () => { if (host.document.hidden) finishDrag(true); }, { signal });
      root.addEventListener("click", event => {
        const retry = event.target.closest("[data-library-retry]");
        if (retry) {
          event.stopPropagation();
          for (const key of state.failures.keys()) {
            if (key.startsWith("series:")) state.staleSeries.add(key.slice(7));
            if (key.startsWith("summary:")) state.staleSummaries.add(key.slice(8));
          }
          state.failures.clear(); state.error = ""; hydrate(); requestRender(); return;
        }
        const reset = event.target.closest("[data-library-reset]");
        if (reset) {
          event.stopPropagation();
          state.savedOrder = [];
          applyOrder(defaultOrder(state.entries));
          try { options.saveOrder?.(state.userId, []); announce("標準の並び順に戻しました。"); }
          catch { announce("標準順に戻しましたが、ブラウザーに保存できませんでした。"); }
          return;
        }
        const move = event.target.closest("[data-library-move]");
        if (move) {
          event.stopPropagation();
          const direction = Number(move.dataset.libraryMove);
          moveSelected(direction);
          const replacement = root.querySelector('[data-library-move="' + direction + '"]');
          if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
          return;
        }
        const scroll = event.target.closest("[data-library-scroll]");
        if (scroll) {
          event.stopPropagation();
          const rail = root.querySelector("[data-library-rail]");
          rail?.scrollBy({ left: Number(scroll.dataset.libraryScroll) * rail.clientWidth * .72, behavior: reducedMotion() ? "instant" : "smooth" });
          return;
        }
        const button = event.target.closest("[data-library-book], [data-library-open]");
        if (!button) return;
        event.stopPropagation();
        const slug = button.dataset.libraryBook || button.dataset.libraryOpen;
        if (event.detail !== 0 && slug === state.suppressClick.slug && Date.now() < state.suppressClick.until) return;
        if (button.dataset.libraryBook && state.picked !== slug) { setSelection(slug); return; }
        const source = [...root.querySelectorAll("[data-library-book]")].find(item => item.dataset.libraryBook === slug) || button;
        void openBook(slug, source);
      }, { signal });
      root.addEventListener("keydown", event => {
        if (event.key === "Escape") {
          if (state.drag) { event.preventDefault(); finishDrag(true); }
          else { state.picked = ""; setSelection(state.selected, false); announce("本の選択を解除しました。"); }
          return;
        }
        if (!event.target.matches("[data-library-book]")) return;
        const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (event.shiftKey && direction) {
          event.preventDefault();
          setSelection(event.target.dataset.libraryBook);
          moveSelected(direction);
          event.target.focus({ preventScroll: true });
          return;
        }
        if (!direction && !["Home", "End"].includes(event.key)) return;
        const buttons = [...root.querySelectorAll("[data-library-book]")];
        const position = buttons.indexOf(event.target);
        const target = event.key === "Home" ? buttons[0] : event.key === "End" ? buttons.at(-1) : buttons[position + direction];
        if (target) { event.preventDefault(); target.focus({ preventScroll: true }); target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" }); }
      }, { signal });
      const rail = root.querySelector("[data-library-rail]");
      if (rail) {
        rail.scrollLeft = state.scrollLeft;
        rail.addEventListener("scroll", updateRailControls, { signal, passive: true });
        if (typeof ResizeObserver === "function") {
          state.observer = new ResizeObserver(updateRailControls);
          state.observer.observe(rail);
        }
      }
      updateRailControls();
      if (state.focusAfterRender) {
        const target = [...root.querySelectorAll("[data-library-book]")].find(item => item.dataset.libraryBook === state.focusAfterRender);
        state.focusAfterRender = "";
        target?.focus({ preventScroll: true });
      }
      queueMicrotask(hydrate);
    }
    function unmount() {
      finishDrag(true, true);
      state.sessionRevision += 1;
      state.inflight.clear();
      state.failures.clear();
      for (const slug of state.cache.keys()) state.staleSeries.add(slug);
      // Local archives or answers may change while learning. Never prefer an old
      // summary over refreshed volume progress on the next visit.
      state.summaries.clear();
      state.staleSummaries.clear();
      state.picked = "";
      state.abort?.abort();
      state.observer?.disconnect();
      state.root = null;
    }
    function invalidate() {
      finishDrag(true, true);
      state.sessionRevision += 1;
      state.cache.clear();
      state.summaries.clear();
      state.inflight.clear();
      state.staleSeries.clear();
      state.staleSummaries.clear();
      state.failures.clear();
      state.error = "";
    }
    return { render, mount, unmount, browseSeries, openBook, invalidate };
  }

  function reducedMotion() {
    return host.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  }

  // The transition is transient. It never owns auth, routing, or answer history.
  async function takeBook(book, source, open) {
    const doc = host.document;
    if (!doc || reducedMotion() || !book.canView || !source?.getBoundingClientRect
        || !host.HTMLDialogElement?.prototype.showModal || !host.Element?.prototype.animate) return await open();

    const from = source.getBoundingClientRect();
    if (!from.width || !from.height) return await open();
    const previousFocus = doc.activeElement;
    const previousVisibility = source.style.visibility;
    const width = Math.min(325, host.innerWidth * .42, host.innerHeight * .42);
    const height = width * 1.5;
    const centerX = host.innerWidth / 2 + width * .16;
    const centerY = host.innerHeight * .47;
    const deltaX = from.left + from.width / 2 - centerX;
    const deltaY = from.top + from.height / 2 - centerY;
    const scale = Math.min(1.35, from.height / height);
    const dialog = doc.createElement("dialog");
    dialog.className = `library-flight-v214 library-tone-${book.tone}`;
    dialog.setAttribute("aria-labelledby", "libraryFlightTitleV214");
    dialog.innerHTML = `<button type="button" class="library-flight-skip" autofocus>演出をスキップ</button>
      <div class="library-flight-scene" aria-hidden="true" style="width:${width}px;height:${height}px;left:${centerX - width / 2}px;top:${centerY - height / 2}px">
        <div class="library-flight-volume">
          <div class="library-flight-paper"><span>みん切る</span><div class="library-flight-paper-title">${coverTitle(book.spineTitle)}${book.volume ? `<span class="library-flight-paper-number">第${book.volume}巻</span>` : ""}</div><small>一問ずつ、あなたの力に。</small>${icon("book")}</div>
          <div class="library-flight-cover"><img src="${ASSET_ROOT}cover.webp" alt="" width="600" height="900"><span class="library-leather-tint"></span><span class="library-flight-cover-title">${coverTitle(book.spineTitle)}</span><span class="library-flight-cover-volume">${book.volume ? `第${book.volume}巻` : "みんなの何切る問題集"}</span>${icon("book")}</div>
          <div class="library-flight-spine"><img src="${ASSET_ROOT}spine.webp" alt="" width="160" height="960"><span class="library-leather-tint"></span><span>${escape(book.spineTitle)}</span></div>
        </div>
      </div>
      <div class="library-flight-caption"><h2 id="libraryFlightTitleV214">${escape(book.fullTitle)}</h2><p role="status" aria-live="polite">本を開いています…</p></div>`;
    const animations = [];
    const timers = new Set();
    const later = (callback, delay) => { const id = host.setTimeout(callback, delay); timers.add(id); return id; };
    const wait = delay => new Promise(resolve => later(resolve, delay));
    let skip;
    const skipped = new Promise(resolve => { skip = resolve; });
    const skipButton = dialog.querySelector(".library-flight-skip");
    skipButton.addEventListener("click", skip, { once: true });
    dialog.addEventListener("cancel", event => { event.preventDefault(); skip(); });
    host.addEventListener?.("popstate", skip, { once: true });
    const animate = (element, frames, timing) => {
      const animation = element.animate(frames, { fill: "both", ...timing });
      animations.push(animation);
      return animation;
    };
    let outcome;
    let opening;
    let mayRestoreFocus = true;
    try {
      doc.body.append(dialog);
      dialog.showModal();
      source.style.visibility = "hidden";

      // Start fetching at once; the visual transition never adds a network round trip.
      opening = Promise.resolve().then(open).then(value => ({ value }), error => ({ error }));
      opening.then(result => { if (result.error || result.value === false) skip(); });
      animate(dialog, [{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
      const volume = dialog.querySelector(".library-flight-volume");
      const cover = dialog.querySelector(".library-flight-cover");
      animate(volume, [
        { transform: `translate3d(${deltaX}px,${deltaY}px,0) rotateY(78deg) scale(${scale})` },
        { transform: `translate3d(${deltaX * .55}px,${deltaY * .5 - 25}px,100px) rotateY(42deg) rotateZ(-3deg) scale(${Math.min(1.1, scale)})`, offset: .46 },
        { transform: "translate3d(0,0,0) rotateY(-9deg) rotateZ(-2deg) scale(1)" }
      ], { duration: 820, easing: "cubic-bezier(.22,.7,.15,1)" });
      animate(cover, [{ transform: "rotateY(0deg)" }, { transform: "rotateY(-143deg)" }], {
        delay: 780, duration: 720, easing: "cubic-bezier(.3,.05,.25,1)"
      });
      animate(dialog.querySelector(".library-flight-caption"), [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }], { delay: 360, duration: 380 });
      later(() => {
        const status = dialog.querySelector('[role="status"]');
        if (status) status.textContent = "問題集を準備しています…";
      }, 1900);

      // Escape/skip releases the modal immediately. Slow networks fall back to the app's
      // normal loading UI after six seconds instead of trapping the user in the animation.
      await Promise.race([Promise.all([wait(1570), opening]), skipped, wait(6000)]);
      const fade = animate(dialog, [{ opacity: 1 }, { opacity: 0 }], { duration: 170 });
      await Promise.race([fade.finished.catch(() => {}), wait(240)]);
    } catch {
      // Visual effects are best-effort. A browser animation error must not cancel routing.
      opening ||= Promise.resolve().then(open).then(value => ({ value }), error => ({ error }));
    } finally {
      mayRestoreFocus = doc.activeElement === skipButton || dialog.contains(doc.activeElement) || doc.activeElement === doc.body;
      timers.forEach(id => host.clearTimeout(id));
      host.removeEventListener?.("popstate", skip);
      animations.forEach(animation => animation.cancel());
      if (dialog.open) dialog.close();
      dialog.remove();
      source.style.visibility = previousVisibility;
    }
    outcome = await opening;
    if (mayRestoreFocus && (doc.activeElement === doc.body || doc.activeElement === previousFocus)) {
      const destination = outcome.error || outcome.value === false ? previousFocus : doc.getElementById("menuTitle");
      if (destination?.isConnected && destination.getClientRects().length) {
        if (!destination.hasAttribute("tabindex")) destination.setAttribute("tabindex", "-1");
        destination.focus({ preventScroll: true });
      }
    }
    if (outcome.error) throw outcome.error;
    return outcome.value;
  }

  host.MinkiruLibraryV214 = Object.freeze({ create, normaliseBook, catalogueRoots, bookTone, takeBook });
})(typeof window === "undefined" ? globalThis : window);
