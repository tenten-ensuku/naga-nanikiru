(() => {
  "use strict";

  const APP_ID = "naga-nanikiru";
  const USER_STATE_KEY = `${APP_ID}:user-state-v1`;
  const CLOUDFLARE_USER_STATE_PREFIX = `${APP_ID}:user-state-v1:cloudflare:`;
  const LIBRARY_ORDER_PREFIX = `${APP_ID}:library-order-v215:`;
  const TRANSFER_FORMAT = "naga-nanikiru-legacy-transfer";
  const BUNDLE_FORMAT = "naga-nanikiru-legacy-bundle";
  const TRANSFER_VERSION = 232;
  const MAX_FILE_BYTES = 512 * 1024;
  const MAX_SCOPES = 1024;
  const MAX_MARKERS = 10000;
  const MAX_ORDER = 4096;
  const MAX_MARKER_LENGTH = 512;
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const JSON_TYPES = new Set(["", "application/json", "text/json"]);
  const EXCLUDED_FIELDS = Object.freeze([
    "legacy unscoped favorites/archive markers",
    "answerHistory",
    "localComments",
    "customQuestions",
    "pendingGenerated",
    "sessions",
    "questionOverrides",
    "deletionProposals",
    "authentication state and tokens"
  ]);

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function uniqueStrings(value, field, { coerce = false, max = MAX_MARKERS } = {}) {
    if (!Array.isArray(value)) throw new Error(`${field} は配列で指定してください。`);
    if (value.length > max) throw new Error(`${field} の件数が上限を超えています。`);
    const result = [];
    const seen = new Set();
    for (const item of value) {
      if (typeof item !== "string" && !(coerce && (typeof item === "number" || typeof item === "boolean"))) {
        throw new Error(`${field} に不正な値があります。`);
      }
      const text = String(item).trim();
      if (!text || text.length > MAX_MARKER_LENGTH) throw new Error(`${field} に不正な値があります。`);
      if (!seen.has(text)) {
        seen.add(text);
        result.push(text);
      }
    }
    return result;
  }

  function exportStrings(value) {
    if (!Array.isArray(value)) return [];
    return uniqueStrings(value.filter(item => typeof item === "string" || typeof item === "number"), "保存マーカー", { coerce: true });
  }

  function isUserScope(scope, userId) {
    const prefix = `${userId}::`;
    if (typeof scope !== "string" || !scope.toLowerCase().startsWith(prefix.toLowerCase())) return false;
    const collectionKey = scope.slice(prefix.length);
    return Boolean(collectionKey) && !collectionKey.includes("::");
  }

  function readJson(storage, key, fallback) {
    const raw = storage?.getItem?.(key);
    if (raw === null || raw === undefined || raw === "") return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("保存データの形式を読み取れませんでした。");
    }
  }

  async function currentUserId(root) {
    const api = root?.NagaSupabase;
    if (!api || typeof api.currentSession !== "function") throw new Error("新しいアプリでログインしてから操作してください。");
    const session = await api.currentSession();
    const userId = String(session?.user?.id || "").trim().toLowerCase();
    if (!UUID_PATTERN.test(userId)) throw new Error("ログイン中のユーザーIDを確認できません。");
    return userId;
  }

  function buildExportPayload({ userId, state = {}, libraryOrder = [] } = {}) {
    const normalizedUserId = String(userId || "").trim().toLowerCase();
    if (!UUID_PATTERN.test(normalizedUserId)) throw new Error("エクスポート対象のユーザーIDが不正です。");
    const scopes = {};
    const collectionPersonal = isRecord(state?.collectionPersonal) ? state.collectionPersonal : {};
    const entries = Object.entries(collectionPersonal);
    if (entries.length > MAX_SCOPES) throw new Error("問題集の保存件数が上限を超えています。");
    for (const [scope, entry] of entries) {
      if (!isUserScope(scope, normalizedUserId) || !isRecord(entry)) continue;
      const favorites = exportStrings(entry.favorites);
      const archived = exportStrings(entry.archived);
      if (favorites.length || archived.length) scopes[scope] = { favorites, archived };
    }
    return {
      format: TRANSFER_FORMAT,
      version: TRANSFER_VERSION,
      userId: normalizedUserId,
      collectionPersonal: scopes,
      libraryOrder: exportStrings(libraryOrder).slice(0, MAX_ORDER),
      excludedFields: [...EXCLUDED_FIELDS],
      exportedAt: new Date().toISOString()
    };
  }

  function validateImportPayload(payload, userId) {
    const normalizedUserId = String(userId || "").trim().toLowerCase();
    if (!UUID_PATTERN.test(normalizedUserId)) throw new Error("ログイン中のユーザーIDを確認できません。");
    if (isRecord(payload) && payload.format === BUNDLE_FORMAT) {
      if (payload.version !== TRANSFER_VERSION || !Array.isArray(payload.users) || payload.users.length > 100 || Object.keys(payload).some(key=>!["format","version","users"].includes(key))) throw new Error("設定ファイルの形式が不正です。");
      const matches=payload.users.filter(row=>String(row?.userId||"").toLowerCase()===normalizedUserId);
      if(matches.length!==1) throw new Error("ログイン中の本人の設定が見つかりません。旧サイトと同じDiscordアカウントか確認してください。");
      return validateImportPayload(matches[0],normalizedUserId);
    }
    if (!isRecord(payload) || payload.format !== TRANSFER_FORMAT || payload.version !== TRANSFER_VERSION) {
      throw new Error("この保存ファイルの形式またはバージョンに対応していません。");
    }
    if (String(payload.userId || "").trim().toLowerCase() !== normalizedUserId) {
      throw new Error("別のユーザーの保存ファイルは読み込めません。");
    }
    const unsupportedTopLevel = ["favorites", "archived", "trashed", "hidden", "answerHistory", "localComments", "customQuestions", "pendingGenerated", "sessions", "token", "access_token", "refresh_token"];
    const unsupported = unsupportedTopLevel.filter(key => Object.prototype.hasOwnProperty.call(payload, key));
    if (unsupported.length) throw new Error(`未スコープの保存項目（${unsupported.join("、")}）は読み込めません。`);
    const allowedKeys = new Set(["format", "version", "userId", "collectionPersonal", "libraryOrder", "excludedFields", "exportedAt"]);
    const unknownKeys = Object.keys(payload).filter(key => !allowedKeys.has(key));
    if (unknownKeys.length) throw new Error(`対象外の保存項目（${unknownKeys.join("、")}）は読み込めません。`);
    if (!isRecord(payload.collectionPersonal)) throw new Error("collectionPersonal の形式が不正です。");
    const scopeEntries = Object.entries(payload.collectionPersonal);
    if (scopeEntries.length > MAX_SCOPES) throw new Error("問題集の保存件数が上限を超えています。");
    const scopes = {};
    for (const [scope, entry] of scopeEntries) {
      if (!isUserScope(scope, normalizedUserId)) {
        if (scope.toLowerCase().startsWith("guest::") || !scope.includes("::")) throw new Error("未スコープの問題集データは読み込めません。");
        throw new Error("別のユーザーの問題集データは読み込めません。");
      }
      if (!isRecord(entry)) throw new Error("問題集データの形式が不正です。");
      const extraKeys = Object.keys(entry).filter(key => !["favorites", "archived"].includes(key));
      if (extraKeys.length) throw new Error(`対象外の問題集データ（${extraKeys.join("、")}）は読み込めません。`);
      scopes[scope] = {
        favorites: uniqueStrings(entry.favorites, `${scope}.favorites`),
        archived: uniqueStrings(entry.archived, `${scope}.archived`)
      };
    }
    const libraryOrder = uniqueStrings(payload.libraryOrder, "libraryOrder", { max: MAX_ORDER });
    return { userId: normalizedUserId, scopes, libraryOrder };
  }

  function mergeImportedData({ storage, userId, payload } = {}) {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") throw new Error("ローカル保存領域を利用できません。");
    const normalizedUserId = String(userId || "").trim().toLowerCase();
    const imported = payload?.scopes ? payload : validateImportPayload(payload, normalizedUserId);
    if (imported.userId !== normalizedUserId) throw new Error("別のユーザーの保存ファイルは読み込めません。");
    const cloudflareUserStateKey = `${CLOUDFLARE_USER_STATE_PREFIX}${normalizedUserId}`;
    const currentState = readJson(storage, cloudflareUserStateKey, {});
    if (!isRecord(currentState)) throw new Error("現在の保存データの形式が不正です。");
    const currentScopes = isRecord(currentState.collectionPersonal) ? { ...currentState.collectionPersonal } : {};
    for (const [scope, incoming] of Object.entries(imported.scopes)) {
      const current = isRecord(currentScopes[scope]) ? currentScopes[scope] : {};
      const currentFavorites = Array.isArray(current.favorites) ? uniqueStrings(current.favorites, `${scope}.favorites`, { coerce: true }) : [];
      const currentArchived = Array.isArray(current.archived) ? uniqueStrings(current.archived, `${scope}.archived`, { coerce: true }) : [];
      currentScopes[scope] = {
        ...current,
        favorites: [...new Set([...currentFavorites, ...incoming.favorites])],
        archived: [...new Set([...currentArchived, ...incoming.archived])]
      };
    }
    const nextState = { ...currentState, collectionPersonal: currentScopes };
    const orderKey = `${LIBRARY_ORDER_PREFIX}${normalizedUserId}`;
    const rawOrder = storage.getItem(orderKey);
    const currentOrder = rawOrder === null ? [] : uniqueStrings(readJson(storage, orderKey, []), "現在の本棚順", { coerce: true, max: MAX_ORDER });
    const mergedOrder = [...new Set([...currentOrder, ...imported.libraryOrder])];
    storage.setItem(cloudflareUserStateKey, JSON.stringify(nextState));
    storage.setItem(orderKey, JSON.stringify(mergedOrder));
    return { scopeCount: Object.keys(imported.scopes).length, markerCount: Object.values(imported.scopes).reduce((total, entry) => total + entry.favorites.length + entry.archived.length, 0), orderCount: imported.libraryOrder.length };
  }

  function validateFileMetadata(file) {
    if (!file || !Number.isFinite(Number(file.size)) || Number(file.size) > MAX_FILE_BYTES) throw new Error("保存ファイルは512KB以内にしてください。");
    const type = String(file.type || "").toLowerCase();
    const name = String(file.name || "").toLowerCase();
    if (!JSON_TYPES.has(type) || !name.endsWith(".json")) throw new Error("JSON形式の保存ファイルを選択してください。");
    return true;
  }

  function buildStaticExport(storage) {
    const state=readJson(storage,USER_STATE_KEY,null)||readJson(storage,"naga-nanikiru-user-state-v1",{});
    const ids=new Set(Object.keys(state?.collectionPersonal||{}).map(key=>key.split("::")[0].toLowerCase()).filter(id=>UUID_PATTERN.test(id)));
    for(let index=0;index<storage.length;index++){
      const key=storage.key(index)||"";
      if(key.startsWith(LIBRARY_ORDER_PREFIX)&&UUID_PATTERN.test(key.slice(LIBRARY_ORDER_PREFIX.length))) ids.add(key.slice(LIBRARY_ORDER_PREFIX.length).toLowerCase());
    }
    if(ids.size>100) throw new Error("設定の件数が上限を超えています。");
    const users=[...ids].map(userId=>buildExportPayload({userId,state,libraryOrder:readJson(storage,LIBRARY_ORDER_PREFIX+userId,[])}));
    return {format:BUNDLE_FORMAT,version:TRANSFER_VERSION,users};
  }

  function downloadPayload(root,payload) {
    const text=JSON.stringify(payload,null,2),blob=new root.Blob([text],{type:"application/json"});
    if(blob.size>MAX_FILE_BYTES)throw new Error("保存設定が512KBを超えています。元のデータは変更していません。");
    const url=root.URL.createObjectURL(blob),link=root.document.createElement("a");
    link.href=url;link.download="naga-nanikiru-legacy-transfer-v232.json";link.click();
    root.setTimeout(()=>root.URL.revokeObjectURL(url),0);
  }

  async function exportTransfer(root) {
    const userId = await currentUserId(root);
    const state = readJson(root.localStorage, `${CLOUDFLARE_USER_STATE_PREFIX}${userId}`, {});
    const orderKey = `${LIBRARY_ORDER_PREFIX}${userId}`;
    const libraryOrder = readJson(root.localStorage, orderKey, []);
    const payload = buildExportPayload({ userId, state, libraryOrder });
    downloadPayload(root,payload);
    return payload;
  }

  async function importTransfer(root, file) {
    validateFileMetadata(file);
    const userId = await currentUserId(root);
    const payload = JSON.parse(await file.text());
    const validated = validateImportPayload(payload, userId);
    const confirmImport = typeof root.confirm === "function" && root.confirm("お気に入り・アーカイブ・本棚順だけを現在のユーザーに追加します。既存の保存状態は削除せず、読み込み後に再読み込みします。続けますか？");
    if (!confirmImport) return { cancelled: true };
    const confirmedUserId = await currentUserId(root);
    if (confirmedUserId !== userId) throw new Error("ログイン状態が変わったため読み込みを中止しました。");
    const result = mergeImportedData({ storage: root.localStorage, userId, payload: validated });
    if (typeof root.location?.reload === "function") root.location.reload();
    return result;
  }

  function addStyles(root) {
    const doc = root.document;
    if (doc.getElementById("legacyTransferStylesV232")) return;
    const style = doc.createElement("style");
    style.id = "legacyTransferStylesV232";
    style.textContent = "[data-legacy-transfer-v232]{margin-top:14px!important;background:rgba(30,104,111,.18)!important;border-color:rgba(143,217,208,.3)!important}[data-legacy-transfer-v232] h3{margin-bottom:2px}[data-legacy-transfer-v232] .legacy-transfer-actions-v232{display:flex;flex-wrap:wrap;gap:8px;align-items:center}[data-legacy-transfer-v232] button,[data-legacy-transfer-v232] input{font:inherit}[data-legacy-transfer-v232] input[type=file]{max-width:100%;color:#c6d9df;font-size:11px}[data-legacy-transfer-v232] .legacy-transfer-status-v232{min-height:18px;color:#bde7e0;font-size:11px;font-weight:800}[data-legacy-transfer-v232] .legacy-transfer-status-v232.is-error{color:#ff9ba8}";
    (doc.head || doc.documentElement).appendChild(style);
  }

  function setStatus(panel, message, isError = false) {
    const status = panel.querySelector("[data-legacy-transfer-status]");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("is-error", isError);
  }

  function ensurePanel(root) {
    const doc = root.document;
    const settings = doc.querySelector(".settings-section");
    if (!settings || settings.querySelector("[data-legacy-transfer-v232]")) return;
    addStyles(root);
    const panel = doc.createElement("section");
    panel.className = "settings-section";
    panel.dataset.legacyTransferV232 = "";
    panel.innerHTML = "<h3>旧サイトの設定を引き継ぐ</h3><p>旧サイトで保存した設定ファイルを選ぶと、ログイン中の本人のお気に入り・アーカイブ・本棚順だけを取り込みます。回答履歴はサーバーから引き継ぎ済みです。</p><div class=\"legacy-transfer-actions-v232\"><button class=\"primary\" type=\"button\" data-legacy-transfer-export>この端末の設定を保存</button><label>保存ファイルを選択<input type=\"file\" accept=\"application/json,.json\" data-legacy-transfer-import></label></div><div class=\"legacy-transfer-status-v232\" data-legacy-transfer-status aria-live=\"polite\"></div>";
    settings.appendChild(panel);
    const exportButton = panel.querySelector("[data-legacy-transfer-export]");
    const importInput = panel.querySelector("[data-legacy-transfer-import]");
    exportButton?.addEventListener("click", async () => {
      exportButton.disabled = true;
      setStatus(panel, "保存ファイルを準備しています…");
      try {
        const payload = await exportTransfer(root);
        const markerCount = Object.values(payload.collectionPersonal).reduce((total, entry) => total + entry.favorites.length + entry.archived.length, 0);
        setStatus(panel, `保存しました（問題集${Object.keys(payload.collectionPersonal).length}件・マーカー${markerCount}件・本棚順${payload.libraryOrder.length}件）。`);
      } catch (error) {
        setStatus(panel, error?.message || "保存ファイルを作成できませんでした。", true);
      } finally {
        exportButton.disabled = false;
      }
    });
    importInput?.addEventListener("change", async () => {
      const file = importInput.files?.[0];
      if (!file) return;
      importInput.disabled = true;
      setStatus(panel, "保存ファイルを確認しています…");
      try {
        const result = await importTransfer(root, file);
        if (result?.cancelled) setStatus(panel, "読み込みをキャンセルしました。");
        else setStatus(panel, "読み込みました。再読み込みします…");
      } catch (error) {
        setStatus(panel, error?.message || "保存ファイルを読み込めませんでした。", true);
      } finally {
        importInput.disabled = false;
        importInput.value = "";
      }
    });
  }

  function initialize(root) {
    if (!root?.document || root.__NAGA_LEGACY_TRANSFER_V232_INITIALIZED__) return;
    root.__NAGA_LEGACY_TRANSFER_V232_INITIALIZED__ = true;
    const staticButton=root.document.getElementById("legacyExportButton");
    if(staticButton){
      staticButton.addEventListener("click",()=>{
        const status=root.document.getElementById("legacyExportStatus");
        try{
          const payload=buildStaticExport(root.localStorage);
          if(!payload.users.length)throw new Error("この端末には本人に紐づく設定が見つかりません。元の保存データはそのまま残しています。");
          downloadPayload(root,payload);status.textContent="設定ファイルを保存しました。新しいみん切るにログインし、設定から読み込んでください。";
        }catch(error){status.textContent=error?.message||"設定を保存できませんでした。元のデータは保持しています。";}
      });
      return;
    }
    if(root.NAGA_RUNTIME_CONFIG?.backend!=="cloudflare")return;
    const run = () => ensurePanel(root);
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", run, { once: true });
    else run();
    root.document.addEventListener("click", event => {
      if (event.target?.closest?.('[data-menu-view="settings"]')) root.setTimeout(run, 0);
    }, true);
    root.addEventListener?.("naga:authchange", run);
    if (typeof root.MutationObserver === "function" && root.document.body) {
      const observer = new root.MutationObserver(run);
      observer.observe(root.document.body, { childList: true, subtree: true });
    }
  }

  const api = { buildExportPayload, buildStaticExport, validateImportPayload, mergeImportedData, validateFileMetadata, exportTransfer, importTransfer, initialize };
  const root = typeof window === "undefined" ? null : window;
  if (root) {
    root.NagaLegacyTransferV232 = api;
    initialize(root);
  }
})();
