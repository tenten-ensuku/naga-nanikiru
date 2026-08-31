/* Min-kiru V214: a data-driven library. No questions or personal state are stored here.
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

  function bookMarkup(book, selected, { secondary = false, front = false } = {}) {
    const titleLength = Array.from(book.spineTitle).length;
    const type = book.volume ? `第${book.volume}巻` : book.series ? book.volumeCount ? `全${book.volumeCount}巻` : "シリーズ" : book.questionCount === null ? "みん切る" : `${formatted(book.questionCount)}問`;
    const action = book.series && book.canView ? "巻を選ぶ" : book.canView ? "学習画面を開く" : "閲覧権限を確認する";
    return `<button class="library-book library-tone-${book.tone}${front ? " is-front" : ""}${selected ? " is-selected" : ""}${book.isCurrent ? " is-current" : ""}${secondary ? " is-secondary" : ""}${titleLength > 15 ? " has-long-title" : ""}${titleLength > 30 ? " has-very-long-title" : ""}" type="button" data-library-book="${escape(book.slug)}" aria-label="${escape(book.fullTitle)}：${action}" aria-describedby="libraryBookHintV214" ${book.isCurrent ? 'aria-current="true"' : ""}>
      <span class="library-book-surface" aria-hidden="true"><img class="library-spine-art" src="${ASSET_ROOT}${front ? "cover" : "spine"}.webp" alt="" width="${front ? 600 : 160}" height="${front ? 900 : 960}" decoding="async" draggable="false"><span class="library-leather-tint"></span><span class="library-book-title">${front ? coverTitle(book.spineTitle) : escape(book.spineTitle)}</span><span class="library-book-volume${book.volume ? " is-number" : ""}">${book.volume ? book.volume : escape(type)}</span><span class="library-book-seal">${icon("book")}</span></span>
      ${book.isCurrent ? '<span class="library-current-marker">学習中</span>' : ""}
      <span class="library-book-tooltip" aria-hidden="true">${escape(book.fullTitle)}<small>${action}</small></span>
    </button>`;
  }

  function detailMarkup(book, context) {
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
    const action = book.series && book.canView ? "巻を選ぶ" : book.canView ? "この問題集で学習する" : "閲覧権限を確認する";
    const description = book.description || (book.series ? "巻ごとに、一歩ずつ学習を進めましょう。" : "一問ずつ考えて、判断の引き出しを増やしましょう。");
    return `<div class="library-detail-copy"><span class="library-detail-eyebrow">${book.isCurrent ? "学習中の一冊" : book.series ? "シリーズ" : "この一冊から"}</span><h4 id="libraryDetailTitleV214">${escape(title)}</h4><p>${escape(description)}</p>${hasRange ? `<span class="library-detail-range">問題 ${book.volume_start}–${book.volume_end}</span>` : ""}</div>
      <dl class="library-detail-metrics"><div><dt>${icon("book")}${quantityLabel}</dt><dd>${quantityValue}<small>${quantityValue === "—" ? "" : unit}</small></dd></div><div><dt>${icon("check")}回答済み</dt><dd>${formatted(answered)}<small>${answered === null ? "" : "問"}</small></dd></div><div><dt><span class="library-progress-ring" aria-hidden="true"></span>習熟度</dt><dd>${formatted(mastery)}<small>${mastery === null ? "" : "%"}</small></dd></div></dl>
      <div class="library-detail-action"><button type="button" class="library-start" data-library-open="${escape(book.slug)}">${action}${icon("right")}</button><small>${!book.canView ? escape(book.accessLabel) : answered === null ? "進捗は問題集を開くと確認できます" : "あなたの学習記録を引き継ぎます"}</small></div>`;
  }

  function create(options = {}) {
    const state = {
      context: {}, userId: null, sessionRevision: 0, activeSeries: "", currentSlug: "", initialised: false,
      selected: "", cache: new Map(), inflight: new Map(), loading: "", error: "",
      staleSeries: new Set(),
      root: null, abort: null, observer: null, entries: [], opening: false,
      scrollLeft: 0, scrollGroup: "", focusAfterRender: "", scrollAfterRender: ""
    };
    const requestRender = () => options.onRender?.();
    const visible = () => options.isVisible?.() !== false;

    function render(context) {
      state.context = context || {};
      const userId = String(context.userId || "");
      if (state.userId !== userId) {
        state.userId = userId;
        state.sessionRevision += 1;
        state.cache.clear();
        state.inflight.clear();
        state.staleSeries.clear();
        state.initialised = false;
        state.activeSeries = "";
        state.currentSlug = "";
        state.selected = "";
        state.loading = "";
        state.error = "";
      }
      const roots = catalogueRoots(context.collections);
      const currentSlug = String(context.current?.share_slug || "");
      if (roots.length && (!state.initialised || (currentSlug && currentSlug !== state.currentSlug))) {
        state.initialised = true;
        state.currentSlug = currentSlug;
        const candidate = rootSlug(context.current);
        state.activeSeries = roots.some(row => String(row.share_slug) === candidate && isSeries(row)) ? candidate : "";
        state.selected = currentSlug;
      }
      if (state.activeSeries && !roots.some(row => String(row.share_slug) === state.activeSeries)) state.activeSeries = "";
      const activeParent = roots.find(row => String(row.share_slug) === state.activeSeries);
      if (activeParent && !normaliseBook(activeParent, currentSlug).canView) {
        state.cache.delete(state.activeSeries);
        state.selected = state.activeSeries;
        state.activeSeries = "";
      }
      if (state.root?.isConnected) {
        const rail = state.root.querySelector("[data-library-rail]");
        if (rail && state.scrollGroup === state.activeSeries) state.scrollLeft = rail.scrollLeft;
      }
      if (state.scrollGroup !== state.activeSeries) {
        state.scrollLeft = 0;
        state.scrollGroup = state.activeSeries;
      }
      const parent = roots.find(row => String(row.share_slug) === state.activeSeries);
      const cached = state.cache.get(state.activeSeries);
      const volumes = (cached?.volumes || []).map(row => normaliseBook({ ...row, series_title: parent?.series_title || parent?.display_title || parent?.title }, currentSlug,
        cached?.progress?.find(item => Number(item.volume_number) === Number(row.volume_number))));
      const normalisedRoots = roots.map(row => normaliseBook(row, currentSlug));
      state.entries = volumes.length ? [...volumes, ...normalisedRoots.filter(row => row.slug !== state.activeSeries)] : normalisedRoots;
      const selected = state.entries.find(row => row.slug === state.selected)
        || state.entries.find(row => row.isCurrent) || state.entries[0];
      state.selected = selected?.slug || "";
      const collectionError = String(context.error || "");
      const notice = state.error || collectionError;
      const collectionCount = roots.length;
      const seriesTitle = String(parent?.display_title || parent?.title || "").replace(/[\s　]*全\d+巻\s*$/, "");
      const listLabel = parent && volumes.length ? seriesTitle : "すべての問題集";
      const books = state.entries.map((book, index) => `${volumes.length && index === volumes.length ? '<span class="library-series-divider" aria-hidden="true"></span>' : ""}${bookMarkup(book, book.slug === state.selected, { secondary: volumes.length > 0 && index >= volumes.length, front: !volumes.length })}`).join("");
      return `<section class="collection-chooser library-v214${volumes.length ? " has-volumes" : " is-catalogue"}" aria-labelledby="collectionChooserHeading">
        <header class="collection-chooser-header library-header"><div><h3 id="collectionChooserHeading">学習する問題集を選択</h3><p id="libraryBookHintV214">本を選んで、今日の学習をはじめましょう。</p></div><button class="collection-chooser-create library-create" type="button" data-menu-jump="settings">${icon("plus")}新しい問題集</button></header>
        <div class="library-shelf-heading"><div class="library-breadcrumb">${parent ? `<button type="button" data-library-back>${icon("left")}すべての問題集</button><span class="library-breadcrumb-separator" aria-hidden="true">/</span>` : ""}<h4>${escape(listLabel)}</h4><span class="library-shelf-total">${parent && volumes.length ? `${volumes.length}巻` : `${collectionCount}冊`}</span></div><div class="library-rail-actions" data-library-rail-actions><button type="button" data-library-scroll="-1" aria-label="前の本を表示">${icon("left")}</button><button type="button" data-library-scroll="1" aria-label="次の本を表示">${icon("right")}</button></div></div>
        ${notice ? `<div class="library-notice" role="alert"><span>${escape(notice)}</span>${state.error && state.activeSeries ? '<button type="button" data-library-retry>もう一度読み込む</button>' : ""}</div>` : ""}
        <div class="library-stage"><img class="library-study-art" src="${ASSET_ROOT}study.webp" alt="" width="1672" height="941" decoding="async" fetchpriority="high"><div class="library-rail" data-library-rail role="group" aria-label="${escape(listLabel)}の本棚">${books || `<p class="library-empty" role="status">${context.loading ? "問題集を本棚に並べています…" : "まだ問題集がありません。新しい問題集を作るか、共有された問題集を開いてください。"}</p>`}</div><div class="library-shelf-status" role="status" aria-live="polite">${state.loading && state.loading === state.activeSeries ? "巻を本棚に並べています…" : ""}</div></div>
        <div class="library-shelf-foot"><span class="library-swipe-hint">左右に動かして本を選べます</span><span>一冊ずつ、確かな判断へ。</span></div>
        <section class="library-detail" data-library-detail aria-labelledby="libraryDetailTitleV214">${detailMarkup(selected, context)}</section>
      </section>`;
    }

    function setSelection(slug) {
      if (state.opening || slug === state.selected) return;
      const book = state.entries.find(row => row.slug === slug);
      if (!book) return;
      state.selected = slug;
      state.root?.querySelectorAll("[data-library-book]").forEach(button => {
        button.classList.toggle("is-selected", button.dataset.libraryBook === slug);
      });
      const detail = state.root?.querySelector("[data-library-detail]");
      if (detail) detail.innerHTML = detailMarkup(book, state.context);
    }

    async function browseSeries(slug, { force = false, focus = false } = {}) {
      if (!state.userId || options.canOpen?.() === false) return false;
      const parent = catalogueRoots(state.context.collections).find(row => String(row.share_slug) === slug && isSeries(row));
      if (!parent) return false;
      state.activeSeries = slug;
      state.error = "";
      if (state.cache.has(slug) && !force && !state.staleSeries.has(slug)) {
        if (focus) state.focusAfterRender = "first";
        requestRender();
        return true;
      }
      if (state.inflight.has(slug)) return state.inflight.get(slug);
      const requestedSession = state.sessionRevision;
      const hadCachedVolumes = state.cache.has(slug);
      state.loading = slug;
      requestRender();
      const task = (async () => {
        try {
          const result = await Promise.resolve().then(() => options.loadSeries?.(slug));
          if (state.sessionRevision !== requestedSession) return false;
          const currentParent = catalogueRoots(state.context.collections).find(row => String(row.share_slug) === slug);
          if (!currentParent || !normaliseBook(currentParent, String(state.context.current?.share_slug || "")).canView) return false;
          const volumes = (Array.isArray(result?.volumes) ? result.volumes : []).filter(row => row?.share_slug)
            .sort((a, b) => Number(a.volume_number) - Number(b.volume_number));
          if (!volumes.length) throw new Error("選べる巻がありません。問題集の閲覧権限をご確認ください。");
          state.cache.set(slug, { volumes, progress: Array.isArray(result?.progress) ? result.progress : [] });
          state.staleSeries.delete(slug);
          if (state.activeSeries === slug) {
            const current = String(state.context.current?.share_slug || "");
            state.selected = volumes.some(row => String(row.share_slug) === current) ? current : String(volumes[0].share_slug);
            if (focus) state.focusAfterRender = state.selected;
            if (focus || !hadCachedVolumes) state.scrollAfterRender = state.selected;
            if (result?.progressError) state.error = "巻は選択できます。進捗の取得に失敗しました。";
          }
          return true;
        } catch (error) {
          if (state.sessionRevision === requestedSession && state.activeSeries === slug) state.error = error?.message || "巻を読み込めませんでした。通信状態をご確認ください。";
          return false;
        } finally {
          if (state.sessionRevision === requestedSession) {
            state.inflight.delete(slug);
            if (state.loading === slug) state.loading = "";
            if (visible()) requestRender();
          }
        }
      })();
      state.inflight.set(slug, task);
      return task;
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

    async function openBook(slug, source) {
      if (state.opening) return false;
      const book = state.entries.find(row => row.slug === slug);
      if (!book) return false;
      if (!state.userId || options.canOpen?.() === false) return false;
      setSelection(slug);
      if (book.series && book.canView) return browseSeries(slug, { focus: true });
      state.opening = true;
      state.root?.querySelector(".library-v214")?.setAttribute("aria-busy", "true");
      try {
        return await takeBook(book, source, () => options.onOpen?.(slug));
      } catch (error) {
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
        state.coverPreload.src = `${ASSET_ROOT}cover.webp`;
      }
      state.abort = new AbortController();
      const signal = state.abort.signal;
      root.addEventListener("pointermove", event => {
        if (event.pointerType === "touch") return;
        const button = event.target.closest("[data-library-book]");
        if (button) setSelection(button.dataset.libraryBook);
      }, { signal });
      root.addEventListener("focusin", event => {
        const button = event.target.closest("[data-library-book]");
        if (button) setSelection(button.dataset.libraryBook, true);
      }, { signal });
      root.addEventListener("click", event => {
        const back = event.target.closest("[data-library-back]");
        if (back) {
          event.stopPropagation();
          state.activeSeries = "";
          state.loading = "";
          state.error = "";
          state.focusAfterRender = "first";
          requestRender();
          return;
        }
        const retry = event.target.closest("[data-library-retry]");
        if (retry) { event.stopPropagation(); void browseSeries(state.activeSeries, { force: true }); return; }
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
        const source = [...root.querySelectorAll("[data-library-book]")].find(item => item.dataset.libraryBook === slug) || button;
        void openBook(slug, source);
      }, { signal });
      root.addEventListener("keydown", event => {
        if (!event.target.matches("[data-library-book]")) return;
        const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
        if (!direction && !["Home", "End"].includes(event.key)) return;
        const buttons = [...root.querySelectorAll("[data-library-book]")];
        const position = buttons.indexOf(event.target);
        const target = event.key === "Home" ? buttons[0] : event.key === "End" ? buttons.at(-1) : buttons[position + direction];
        if (target) {
          event.preventDefault();
          target.focus({ preventScroll: true });
          target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion() ? "instant" : "smooth" });
        }
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
        const buttons = [...root.querySelectorAll("[data-library-book]")];
        const target = state.focusAfterRender === "first" ? buttons[0] : buttons.find(item => item.dataset.libraryBook === state.focusAfterRender);
        state.focusAfterRender = "";
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      }
      if (state.scrollAfterRender && rail) {
        const target = [...root.querySelectorAll("[data-library-book]")].find(item => item.dataset.libraryBook === state.scrollAfterRender);
        if (target) rail.scrollLeft = Math.max(0, target.offsetLeft - (rail.clientWidth - target.offsetWidth) / 2);
        state.scrollAfterRender = "";
        updateRailControls();
      }
      if (state.userId && state.activeSeries && (!state.cache.has(state.activeSeries) || state.staleSeries.has(state.activeSeries)) && !state.inflight.has(state.activeSeries) && !state.error) {
        queueMicrotask(() => { if (visible() && !state.loading) void browseSeries(state.activeSeries); });
      }
    }

    function unmount() {
      if (state.root && state.activeSeries) state.staleSeries.add(state.activeSeries);
      state.abort?.abort();
      state.observer?.disconnect();
      state.root = null;
    }

    function invalidate() {
      state.sessionRevision += 1;
      state.cache.clear();
      state.inflight.clear();
      state.staleSeries.clear();
      state.loading = "";
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
