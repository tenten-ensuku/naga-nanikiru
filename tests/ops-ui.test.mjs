import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(TEST_DIR, "..");
const OPS_DIR = path.join(REPO_DIR, "ops", "public");
const INDEX_PATH = path.join(OPS_DIR, "index.html");
const DASHBOARD_PATH = path.join(OPS_DIR, "dashboard.js");
const STYLE_PATH = path.join(OPS_DIR, "style.css");

const [indexHtml, dashboardSource, styleCss] = await Promise.all([
  fs.readFile(INDEX_PATH, "utf8"),
  fs.readFile(DASHBOARD_PATH, "utf8"),
  fs.readFile(STYLE_PATH, "utf8"),
]);

function loadDashboardApi() {
  const sandbox = {
    Array,
    Date,
    Intl,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RegExp,
    Set,
    String,
    URL,
    console,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(dashboardSource, sandbox, { filename: DASHBOARD_PATH });
  assert.ok(sandbox.OpsDashboard, "dashboard API should be exposed for rendering and export");
  return sandbox.OpsDashboard;
}

function parts(values = {}) {
  return [
    ["minkiru", "みん切る", 200_000_000],
    ["ensuku", "エンスクドリル", 80_000_000],
    ["iishanten", "一向聴受け入れ", 100_000_000],
    ["isolated", "孤立牌比較", 50_000_000],
    ["zundamon", "ずんだもん", 284_000_000],
    ["common", "共通・未分類", 0],
  ].map(([appId, label, bytes]) => ({ appId, label, bytes: Object.hasOwn(values, appId) ? values[appId] : bytes, count: 0 }));
}

const FIXTURE_LATEST = {
  version: 1,
  snapshotState: "current",
  generatedAt: "2026-09-07T08:30:00.000Z",
  control: {
    mode: "armed",
    observeUntil: "2026-09-08T00:00:00.000Z",
    blocked: false,
    reasons: ["監視継続"],
    canResume: false,
  },
  sources: [
    { id: "minkiru", label: "Storage <img src=x onerror=alert(1)>", status: "ok", checkedAt: "2026-09-07T08:20:00.000Z", lastSuccessAt: "2026-09-07T08:20:00.000Z", failures: 0, error: null },
    { id: "ranking", label: "Supabase Database", status: "ok", checkedAt: "2026-09-07T08:21:00.000Z", lastSuccessAt: "2026-09-07T08:21:00.000Z", failures: 0, error: null },
    { id: "r2", label: "Cloudflare R2", status: "stale", checkedAt: "2026-09-07T07:00:00.000Z", lastSuccessAt: "2026-09-07T06:00:00.000Z", failures: 1, error: "Bearer should-not-appear" },
    { id: "cloudflare", label: "Cloudflare API / Workers", status: "ok", checkedAt: "2026-09-07T08:22:00.000Z", lastSuccessAt: "2026-09-07T08:22:00.000Z", failures: 0, error: null },
    { id: "egress", label: "通信量 / Egress", status: "ok", checkedAt: "2026-09-07T08:25:00.000Z", lastSuccessAt: "2026-09-07T08:25:00.000Z", failures: 0, error: null },
  ],
  metrics: [
    { id: "supabase-storage", label: "Supabase Storage", provider: "Supabase", kind: "storage", used: 784_000_000, limit: 1_000_000_000, unit: "bytes", status: "ok", observedAt: "2026-09-07T08:20:00.000Z", source: "https://example.invalid/storage/usage?token=fixture-secret", note: "確認済み", parts: parts(), details: [{ label: "質問画像", bytes: 200_000_000, count: 12 }] },
    { id: "supabase-database", label: "Supabase Database", provider: "Supabase PostgreSQL", kind: "database", used: 600_000_000, limit: 123_000_000, unit: "bytes", status: "ok", observedAt: "2026-09-07T08:21:00.000Z", source: "minkiru", note: "構成比", parts: parts({ minkiru: 200_000_000, ensuku: 100_000_000, iishanten: 100_000_000, isolated: 50_000_000, zundamon: 150_000_000 }), details: [] },
    { id: "r2-storage", label: "Cloudflare R2", provider: "Cloudflare", kind: "storage", used: 2_500_000_000, limit: 10_000_000_000, unit: "bytes", status: "stale", observedAt: "2026-09-07T07:00:00.000Z", source: "r2", note: "更新待ち", parts: parts({ zundamon: null }) },
    { id: "database-minkiru", label: "Supabase DB / みん切る", provider: "Supabase PostgreSQL", kind: "database", used: 100_000_000, limit: 400_000_000, unit: "bytes", status: "ok", observedAt: "2026-09-07T08:21:00.000Z", source: "minkiru", note: "", parts: parts(), details: [] },
    { id: "database-ranking", label: "Supabase DB / ランキング", provider: "Supabase PostgreSQL", kind: "database", used: 490_000_000, limit: 500_000_000, unit: "bytes", status: "ok", observedAt: "2026-09-07T08:21:00.000Z", source: "ranking", note: "", parts: parts(), details: [] },
    { id: "workers-requests", label: "Workersの本日リクエスト", provider: "Cloudflare", kind: "requests", used: 2_000, limit: 5_000, unit: "requests", status: "ok", observedAt: "2026-09-07T08:24:00.000Z", source: "Cloudflare GraphQL Analytics", note: "UTC日次", parts: [], details: [] },
    { id: "r2-class-a", label: "R2 Class A・今月", provider: "Cloudflare", kind: "requests", used: 100, limit: 1_000, unit: "requests", status: "ok", observedAt: "2026-09-07T08:24:00.000Z", source: "Cloudflare GraphQL Analytics", note: "UTC暦月", parts: [], details: [] },
    { id: "r2-class-b", label: "R2 Class B・今月", provider: "Cloudflare", kind: "requests", used: 200, limit: 1_000, unit: "requests", status: "unknown", observedAt: null, source: "Cloudflare GraphQL Analytics", note: "UTC暦月", parts: [], details: [] },
    { id: "egress", label: "Supabase通常Egress", provider: "Supabase", kind: "egress", used: 8_000_000, limit: 30_000_000, unit: "bytes", status: "manual", observedAt: "2026-09-07T08:25:00.000Z", source: "本人がDashboardで確認した期間合計", note: "期間集計", parts: [], details: [{ label: "非キャッシュ", bytes: 8_000_000, count: null }, { label: "キャッシュ", bytes: 0, count: null }] },
    { id: "cached-egress", label: "Supabase Cached Egress", provider: "Supabase", kind: "egress", used: 0, limit: 30_000_000, unit: "bytes", status: "manual", observedAt: "2026-09-07T08:25:00.000Z", source: "本人がDashboardで確認した期間合計", note: "期間集計", parts: [], details: [] },
  ],
  events: [
    { at: "2026-09-07T08:26:00.000Z", level: "warning", message: "<script>alert('xss')</script>", delivery: "sent" },
  ],
  candidates: [
    { label: "未参照画像", bytes: 2_000_000, count: 4, status: "review", advice: "参照関係を確認" },
  ],
  growth: {
    questionCount: 228,
    questionBytes: 40_000_000,
    imageBytes: 300_000_000,
    note: "直近スナップショットからの推計",
  },
  billing: {
    storageAverageBytes: 1_782_000_000,
    periodStart: "2026-09-06",
    periodEnd: "2026-10-06",
    confirmedAt: "2026-10-06T08:30:00.000Z",
  },
};

const FIXTURE_HISTORY = {
  daily: [
    { at: "2026-09-05T00:00:00.000Z", storageBytes: 380_000_000, databaseBytes: null, r2Bytes: 2_300_000_000 },
    { at: "2026-09-06T00:00:00.000Z", storageBytes: 390_000_000, databaseBytes: 590_000_000, r2Bytes: 2_400_000_000 },
    { at: "2026-09-07T00:00:00.000Z", storageBytes: 784_000_000, databaseBytes: 600_000_000, r2Bytes: 2_500_000_000 },
  ],
  recent: [],
};

test("standalone ops shell has local-only assets and the required dashboard entry points", () => {
  assert.match(indexHtml, /<html\s+lang="ja">/);
  assert.match(indexHtml, /<link\s+rel="icon"\s+href="data:,">/);
  assert.match(indexHtml, /href="\.\/style\.css"/);
  assert.match(indexHtml, /src="\.\/dashboard\.js"/);
  assert.doesNotMatch(indexHtml, /https?:\/\//i);
  assert.doesNotMatch(styleCss, /@import|https?:\/\/|url\(/i);
  assert.doesNotMatch(indexHtml, /manifest|apple-touch-icon|shortcut icon/i);
});

test("unknown initial state is explicit and never presented as a zero baseline", () => {
  const api = loadDashboardApi();
  const unknown = api.createUnknownSnapshot();
  const html = api.renderDashboardMarkup(unknown, { daily: [], recent: [] });
  assert.deepEqual(Array.from(unknown.sources, (source) => source.id), ["minkiru", "ranking", "r2", "cloudflare", "egress"]);
  assert.equal(unknown.metrics.filter((metric) => metric.kind === "requests" || metric.kind === "egress").length, 0, "no phantom traffic metric before backend IDs are known");
  assert.ok(unknown.metrics.every((metric) => metric.parts.every((part) => part.bytes === null && part.count === null)), "unknown parts must not use zero placeholders");
  assert.equal(unknown.metrics.find((metric) => metric.id === "supabase-database").limit, null);
  assert.equal(unknown.billing.storageAverageBytes, null);
  assert.ok(html.includes("未確認のソース"));
  assert.ok(html.includes("不明"));
  assert.match(html, /data-resource-id="supabase-storage"/);
  assert.match(html, /data-resource-id="supabase-database"/);
  assert.match(html, /data-resource-id="r2-storage"/);
  assert.equal((html.match(/data-resource-id="/g) || []).length, 3);
  assert.doesNotMatch(html, /現在の物理使用量<\/span>\s*<span[^>]*>0 B/);
  assert.ok(html.indexOf('id="resources"') < html.indexOf('id="app-capacity"'));
});

test("control copy distinguishes critical heavy-processing limits from existing practice", () => {
  const api = loadDashboardApi();
  const snapshot = api.normalizeLatest({
    ...FIXTURE_LATEST,
    control: {
      mode: "blocked",
      observeUntil: "2026-09-08T00:00:00.000Z",
      blocked: true,
      reasons: [],
      canResume: false,
    },
  });
  const html = api.renderDashboardMarkup(snapshot, FIXTURE_HISTORY);
  assert.match(html, /status-chip--critical">重い追加処理のみ制限/);
  assert.match(html, /重い追加処理のみ制限/);
  assert.match(html, /既存回答・練習は継続/);
  assert.match(html, /危険域なし／観測継続/);
  assert.match(html, /観測期限（最短）/);
  assert.match(html, /時刻だけでは有効化しません/);
});

test("fixture rendering preserves zero, keeps unknown distinct, escapes data, and exposes the owner sections", () => {
  const api = loadDashboardApi();
  const normalized = api.normalizeLatest(FIXTURE_LATEST);
  const root = { innerHTML: "" };
  api.mount(root, FIXTURE_LATEST, FIXTURE_HISTORY);
  const html = root.innerHTML;
  assert.deepEqual(Array.from(normalized.sources, (source) => source.id), ["minkiru", "ranking", "r2", "cloudflare", "egress"]);
  assert.equal(normalized.sources.length, 5, "source definitions must stay contract-exact");
  assert.deepEqual(Array.from(normalized.metrics.filter((metric) => metric.kind === "requests" || metric.kind === "egress"), (metric) => metric.id), ["workers-requests", "r2-class-a", "r2-class-b", "egress", "cached-egress"]);
  assert.equal(api.countUnknownValues(normalized), 0, "metric parts must not inflate the source summary");
  assert.equal(api.countStaleValues(normalized), 1, "only required source stale values belong in the summary");
  const liveCloudflareFailure = api.normalizeLatest({ ...FIXTURE_LATEST, sources: FIXTURE_LATEST.sources.map((source) => source.id === "cloudflare" ? { ...source, status: "unknown" } : source) });
  assert.equal(api.countUnknownValues(liveCloudflareFailure), 1, "one unknown Cloudflare source is one unknown summary item");
  assert.equal(normalized.metrics.find((metric) => metric.id === "supabase-database").limit, null, "combined DB must not accept a pooled quota");
  assert.equal(normalized.metrics.find((metric) => metric.id === "supabase-storage").parts.find((part) => part.appId === "common").bytes, 0, "confirmed zero must stay zero");
  assert.equal(normalized.metrics.find((metric) => metric.id === "r2-storage").parts.find((part) => part.appId === "zundamon").bytes, null, "missing part must stay unknown");
  assert.equal(normalized.billing.storageAverageBytes, 1_782_000_000);
  assert.equal(normalized.billing.periodStart, "2026-09-06");
  assert.equal((html.match(/data-resource-id="/g) || []).length, 3);
  assert.match(html, /6用途 \/ 3保存先/);
  assert.match(html, /0 B/);
  assert.match(html, /不明/);
  assert.doesNotMatch(html, /<img src=x|<script>alert/);
  assert.match(html, /&lt;script&gt;alert/);
  assert.match(html, /\[REDACTED_SECRET\]/);
  assert.doesNotMatch(html, /Bearer should-not-appear|fixture-secret/);
  assert.match(html, /https:\/\/example\.invalid\/storage\/usage/);
  assert.doesNotMatch(html, /storage\/usage\?token=/);
  assert.match(html, /みん切る/);
  assert.match(html, /一向聴受け入れ/);
  assert.match(html, /孤立牌比較/);
  assert.match(html, /ずんだもん/);
  assert.match(html, /件数: 0件/);
  assert.match(html, /使用量内 25%/);
  assert.match(html, /残り枠: 216 MB/);
  assert.match(html, /期間平均（保存量）/);
  assert.match(html, /1\.782 GB/);
  assert.match(html, /平均 − 現在/);
  assert.match(html, /998 MB/);
  assert.match(html, /30日推移/);
  assert.match(html, /未取得の日は線をつながず/);
  assert.match(html, /保存量ドリルダウン/);
  assert.match(html, /通信・エグレス/);
  assert.match(html, /Workersの本日リクエスト/);
  assert.match(html, /R2 Class A・今月/);
  assert.match(html, /R2 Class B・今月/);
  assert.match(html, /Cloudflare GraphQL Analytics/);
  assert.match(html, /Supabase Cached Egress/);
  assert.match(html, /2,000件/);
  assert.match(html, /40%/);
  assert.match(html, /8 MB/);
  assert.match(html, /30 MB/);
  assert.match(html, /Supabase DB別比較/);
  const currentDbSection = html.slice(html.indexOf('id="supabase-db-comparison"'), html.indexOf('id="future-plan"'));
  assert.doesNotMatch(currentDbSection, /D1|Cloudflare D1|インベントリ/);
  assert.match(currentDbSection, /300 MB/);
  assert.match(currentDbSection, /10 MB/);
  assert.match(html, /将来案の比較/);
  assert.match(html, /現行改善/);
  assert.match(html, /問題本文R2/);
  assert.match(html, /D1部分移行/);
  assert.match(html, /developers\.cloudflare\.com\/d1\/platform\/limits/);
  assert.match(html, /無料枠を保証しません/);
  assert.match(html, /増加見込み（推計）/);
  assert.match(html, /data-growth-input/);
  assert.match(html, /value="1000"/);
  assert.match(html, /質問の追加量/);
  assert.match(html, /画像の追加量/);
  assert.match(html, /整理候補/);
  assert.match(html, /参照のみ/);
  assert.match(html, /name="uncachedBytes"/);
  assert.match(html, /name="cachedBytes"/);
  assert.match(html, /name="storageAverageBytes"/);
  assert.match(html, /未入力なら送信payloadに含めません/);
  assert.match(html, /data-ops-form="egress"/);
  assert.match(html, /data-ops-form="resume"/);
  const candidateSection = html.slice(html.indexOf('id="candidates"'), html.indexOf('id="owner-actions"'));
  assert.doesNotMatch(candidateSection, /<button\b|<form\b/i);
});

test("export is self-contained, keeps current data inline, and has no API or form writes", () => {
  const api = loadDashboardApi();
  const exported = api.createExportHtml(FIXTURE_LATEST, FIXTURE_HISTORY);
  assert.match(exported, /^<!doctype html>/i);
  assert.match(exported, /<style>/i);
  assert.doesNotMatch(exported, /<link[^>]+stylesheet/i);
  assert.doesNotMatch(exported, /<script[^>]+src=/i);
  assert.match(exported, /window\.__OPS_EXPORT__=true/);
  assert.match(exported, /window\.__OPS_SNAPSHOT__/);
  assert.match(exported, /window\.__OPS_HISTORY__/);
  assert.doesNotMatch(exported, /<form\b/i);
  assert.doesNotMatch(exported, /fetch\s*\(/i);
  assert.doesNotMatch(exported, /method\s*:\s*["']POST/i);
  assert.doesNotMatch(exported, /\/api\/(?:latest|history|egress|resume)/i);
  assert.doesNotMatch(exported, /href="https?:\/\//i);
  assert.match(exported, /D1部分移行/);
  assert.match(exported, /静的コピーではリンク無効/);
  assert.match(exported, /静的エクスポート/);
  assert.doesNotMatch(exported, /fixture-secret|Bearer should-not-appear/);
});

test("source safeguards keep viewing GET-only with no polling or visibility refresh", () => {
  const endpointLiterals = new Set(dashboardSource.match(/\/api\/[A-Za-z0-9/_-]+/g) || []);
  assert.deepEqual(endpointLiterals, new Set(["/api/latest", "/api/history", "/api/egress", "/api/resume"]));
  assert.match(dashboardSource, /const REFRESH_INTERVAL_MS = 0/);
  assert.match(dashboardSource, /const HISTORY_REFRESH_INTERVAL_MS = 0/);
  assert.doesNotMatch(dashboardSource, /visibilitychange|setInterval|host\.setTimeout\(async/);
  assert.match(dashboardSource, /method: "GET"/);
  assert.match(dashboardSource, /method: "POST"/);
  assert.match(dashboardSource, /const payload = \{ periodStart, periodEnd, confirmedAt, uncachedBytes, cachedBytes \}/);
  assert.match(dashboardSource, /payload\.storageAverageBytes = storageAverageBytes/);
  assert.match(dashboardSource, /postJson\("\/api\/resume", \{ confirm: true \}\)/);
  assert.match(dashboardSource, /loadData\(false, \{ includeHistory: true \}\)/);
  assert.match(dashboardSource, /metric\.kind === "requests" \|\| metric\.kind === "egress"/);
  assert.match(dashboardSource, /Preserve unsent input/);
  assert.match(dashboardSource, /critical: "重大"/);
  assert.match(dashboardSource, /snapshotState: "stale"/);
  assert.doesNotMatch(dashboardSource, /method:\s*["']DELETE|\.delete\s*\(/i);
  assert.doesNotMatch(dashboardSource, /db\s*collect|collection\s*refresh|collect\s*\(/i);
  assert.match(dashboardSource, /data-quota-scope=\"\$\{isDatabaseComposition \? "composition-only"/);
  assert.match(dashboardSource, /limit: fallback\.id === "supabase-database"\s*\n\s*\? null/);
  assert.doesNotMatch(dashboardSource, /d1Project|D1インベントリ|Cloudflare D1|D1残量/);
  assert.match(dashboardSource, /id: "minkiru"/);
  assert.match(dashboardSource, /id: "ranking"/);
  assert.match(dashboardSource, /id: "r2"/);
  assert.match(dashboardSource, /id: "cloudflare"/);
  assert.match(dashboardSource, /id: "egress"/);
  assert.match(styleCss, /\.table-wrap\s*\{[\s\S]*max-width:\s*100%[\s\S]*overflow-x:\s*auto/);
});

test("daily view prioritizes four percentages, measured overhead and no resume control", () => {
  const api = loadDashboardApi();
  const source = {...FIXTURE_LATEST,control:{mode:'read-only',blocked:true,canResume:true},collection:{cadence:'daily'},overhead:{metadataOnly:true,measuredAt:FIXTURE_LATEST.generatedAt,inputResponseBytes:501,supabaseResponseBytes:500,supabaseRequests:4,requestCount:5,r2ListCalls:10,imageBodyBytes:0,secret:'never-export'}};
  const normalized = api.normalizeLatest(source);
  assert.equal(normalized.control.blocked,false);assert.equal(normalized.control.canResume,false);
  const html=api.renderDashboardMarkup(source,FIXTURE_HISTORY);
  assert.equal((html.match(/data-daily-usage=/g)||[]).length,4);
  assert.match(html,/残り /);assert.match(html,/毎日03:00/);assert.match(html,/collector-overhead/);
  assert.doesNotMatch(html,/id="resume-form"|never-export/);
  assert.ok(html.indexOf('data-daily-usage')<html.indexOf('id="candidates"'));
  assert.match(html,/500 B/);assert.match(html,/15 KB（推計）/);
  const unknown=api.renderDashboardMarkup({...source,metrics:[],overhead:null},{});
  assert.match(unknown,/初回日次計測待ち/);assert.doesNotMatch(unknown,/NaN|Infinity/);
  const exported=api.createExportHtml(source,FIXTURE_HISTORY);
  assert.match(exported,/Ensuku Ops v2/);assert.doesNotMatch(exported,/fetch\s*\(|<form\b|never-export/);
});

test("boot reads only the saved latest/history snapshots on the initial render", async () => {
  const sandbox = {
    Array,
    Date,
    Intl,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RegExp,
    Set,
    String,
    URL,
    console,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(dashboardSource, sandbox, { filename: DASHBOARD_PATH });
  const requests = [];
  const root = {
    innerHTML: "",
    querySelector() {
      return null;
    },
  };
  const documentRef = {
    visibilityState: "visible",
    readyState: "complete",
    getElementById(id) {
      return id === "dashboard-root" ? root : null;
    },
    addEventListener() {},
  };
  sandbox.document = documentRef;
  sandbox.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      async json() {
        return url.endsWith("latest") ? FIXTURE_LATEST : FIXTURE_HISTORY;
      },
    };
  };
  const state = sandbox.OpsDashboard.boot(documentRef);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requests.map((request) => request.url), ["/api/latest", "/api/history"]);
  assert.deepEqual(requests.map((request) => request.options.method), ["GET", "GET"]);
  assert.match(root.innerHTML, /Supabase Storage/);
  assert.equal(state.snapshot.generatedAt, "2026-09-07T08:30:00.000Z");
});

test("manual refresh reads two small saved files without scheduling another refresh", async () => {
  const sandbox = {
    Array,
    Date,
    Intl,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RegExp,
    Set,
    String,
    URL,
    console,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(dashboardSource, sandbox, { filename: DASHBOARD_PATH });
  const requests = [];
  const handlers = {};
  const timers = [];
  const root = {
    innerHTML: "",
    querySelector(selector) {
      if (selector === "[data-action=refresh]") return { addEventListener(_type, handler) { handlers.refresh = handler; } };
      return null;
    },
  };
  const documentRef = {
    visibilityState: "visible",
    readyState: "complete",
    getElementById(id) {
      return id === "dashboard-root" ? root : null;
    },
    addEventListener() {},
  };
  sandbox.document = documentRef;
  sandbox.setTimeout = (handler, delay) => {
    timers.push({ handler, delay });
    return timers.length;
  };
  sandbox.clearTimeout = () => {};
  sandbox.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      async json() {
        return url.endsWith("latest") ? FIXTURE_LATEST : FIXTURE_HISTORY;
      },
    };
  };
  sandbox.OpsDashboard.boot(documentRef);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(typeof handlers.refresh, "function");
  await handlers.refresh();
  assert.deepEqual(requests.map((request) => request.url), ["/api/latest", "/api/history", "/api/latest", "/api/history"]);
  assert.equal(timers.length, 0);
});

test("latest failure keeps the previous snapshot, timestamp, and stale status", async () => {
  const sandbox = {
    Array,
    Date,
    Intl,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RegExp,
    Set,
    String,
    URL,
    console,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(dashboardSource, sandbox, { filename: DASHBOARD_PATH });
  const requests = [];
  const handlers = {};
  const timers = [];
  const root = {
    innerHTML: "",
    querySelector(selector) {
      if (selector === "[data-action=refresh]") return { addEventListener(_type, handler) { handlers.refresh = handler; } };
      return null;
    },
  };
  const documentRef = {
    visibilityState: "visible",
    readyState: "complete",
    getElementById(id) {
      return id === "dashboard-root" ? root : null;
    },
    addEventListener() {},
  };
  sandbox.document = documentRef;
  sandbox.setTimeout = (handler, delay) => {
    timers.push({ handler, delay });
    return timers.length;
  };
  sandbox.clearTimeout = () => {};
  let latestCalls = 0;
  sandbox.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url === "/api/latest" && latestCalls++ === 1) throw new Error("latest unavailable");
    return {
      ok: true,
      async json() {
        return url.endsWith("latest") ? FIXTURE_LATEST : FIXTURE_HISTORY;
      },
    };
  };
  const state = sandbox.OpsDashboard.boot(documentRef);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await handlers.refresh();
  assert.equal(state.snapshot.snapshotState, "stale");
  assert.equal(state.snapshot.generatedAt, FIXTURE_LATEST.generatedAt);
  assert.match(root.innerHTML, /前回値（stale）/);
  assert.match(root.innerHTML, /前回生成:/);
  assert.deepEqual(requests.map((request) => request.url), ["/api/latest", "/api/history", "/api/latest", "/api/history"]);
});

test("an in-progress form has no timer that could refresh over the draft", async () => {
  const sandbox = {
    Array,
    Date,
    Intl,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    RegExp,
    Set,
    String,
    URL,
    console,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(dashboardSource, sandbox, { filename: DASHBOARD_PATH });
  const requests = [];
  const timers = [];
  const egressForm = {
    elements: {
      periodStart: { type: "date", value: "" },
      periodEnd: { type: "date", value: "" },
      confirmedAt: { type: "datetime-local", value: "" },
      uncachedBytes: { type: "number", value: "" },
      cachedBytes: { type: "number", value: "" },
      storageAverageBytes: { type: "number", value: "" },
    },
    addEventListener() {},
  };
  const root = {
    innerHTML: "",
    querySelector(selector) {
      if (selector === "[data-ops-form=egress]") return egressForm;
      return null;
    },
  };
  const documentRef = {
    visibilityState: "visible",
    readyState: "complete",
    getElementById(id) {
      return id === "dashboard-root" ? root : null;
    },
    addEventListener() {},
  };
  sandbox.document = documentRef;
  sandbox.setTimeout = (handler, delay) => {
    timers.push({ handler, delay });
    return timers.length;
  };
  sandbox.clearTimeout = () => {};
  sandbox.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      async json() {
        return url.endsWith("latest") ? FIXTURE_LATEST : FIXTURE_HISTORY;
      },
    };
  };
  sandbox.OpsDashboard.boot(documentRef);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const before = root.innerHTML;
  egressForm.elements.uncachedBytes.value = "123";
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(requests.map((request) => request.url), ["/api/latest", "/api/history"]);
  assert.equal(root.innerHTML, before, "automatic refresh must not redraw over unsent input");
  assert.equal(timers.length, 0);
});
