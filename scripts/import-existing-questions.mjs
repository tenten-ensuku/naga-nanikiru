import fs from "node:fs/promises";
import process from "node:process";
import vm from "node:vm";
import { createClient } from "@supabase/supabase-js";

const scriptUrl = import.meta.url;

function extractExpression(source, pattern, label) {
  const match = source.match(pattern);
  if (!match) throw new Error(`${label} を public/index.html から取得できませんでした。`);
  return match[1];
}

async function loadQuestions() {
  const selected = JSON.parse(
    await fs.readFile(new URL("../public/question-data/selected-questions.json", scriptUrl), "utf8"),
  );
  if (!Array.isArray(selected) || !selected.length) {
    throw new Error("問題データを読み込めませんでした。");
  }

  const html = await fs.readFile(new URL("../public/index.html", scriptUrl), "utf8");
  const sceneExpression = extractExpression(
    html,
    /const SCENE = (\{[\s\S]*?\n\s{4}\});\r?\n\s{4}const TILE_NAMES/,
    "SCENE",
  );
  const nagaUrlExpression = extractExpression(html, /const NAGA_URL = ("[^"]+");/, "NAGA_URL");
  const threadUrlExpression = extractExpression(html, /const THREAD_URL = ("[^"]+");/, "THREAD_URL");
  const nagaUrl = vm.runInNewContext(`(${nagaUrlExpression})`);
  const threadUrl = vm.runInNewContext(`(${threadUrlExpression})`);
  const scene = vm.runInNewContext(`(${sceneExpression})`);
  const messagesExpression = extractExpression(
    html,
    /const THREAD_MESSAGES = (\[[\s\S]*?\n\s{4}\]);\r?\n\s{4}const state/,
    "THREAD_MESSAGES",
  );
  const comments = vm.runInNewContext(`(${messagesExpression})`, { NAGA_URL: nagaUrl });

  const question249 = {
    ...scene,
    id: "249",
    number: 249,
    title: "問題249",
    image: "naga-scene-off.jpg",
    nagaUrl,
    threadUrl,
    comments,
    hasRiichiJudgment: true,
    decisionType: "combined",
    melds: [],
  };

  return [question249, ...selected];
}

function parseNagaUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const reportId = url.pathname.endsWith("report_viewer.html")
      ? url.searchParams.get("report_id")
      : url.pathname.match(/\/htmls\/([^/]+?)(?:\.html)?$/)?.[1];
    return {
      reportId: reportId || null,
      tw: Number(url.searchParams.get("tw")),
      ts: Number(url.searchParams.get("ts")),
      tv: Number(url.searchParams.get("tv")),
    };
  } catch {
    return { reportId: null, tw: Number.NaN, ts: Number.NaN, tv: Number.NaN };
  }
}

function buildRows(questions, collectionId, ownerId) {
  return questions.map((question, index) => {
    const scene = parseNagaUrl(question.nagaUrl);
    const decisionType = question.hasRiichiJudgment
      ? (question.decisionType === "riichi" ? "riichi" : "combined")
      : (question.decisionType || "discard");
    return {
      collection_id: collectionId,
      created_by: ownerId,
      updated_by: ownerId,
      title: String(question.title || `問題${question.number || index + 1}`).slice(0, 160),
      legacy_key: String(question.id || `number-${question.number || index + 1}`),
      sort_order: index,
      source_kind: scene.reportId ? "naga_scene" : (question.threadUrl ? "discord" : "manual"),
      source_report_id: scene.reportId,
      source_url: question.nagaUrl || question.threadUrl || null,
      scene_tw: Number.isInteger(scene.tw) && scene.tw >= 0 && scene.tw <= 3 ? scene.tw : null,
      scene_ts: Number.isInteger(scene.ts) && scene.ts >= 0 ? scene.ts : null,
      scene_tv: Number.isInteger(scene.tv) && scene.tv >= 0 ? scene.tv : null,
      decision_type: ["discard", "call", "riichi", "combined"].includes(decisionType)
        ? decisionType
        : "discard",
      payload: question,
    };
  });
}

const questions = await loadQuestions();
const exportIndex = process.argv.indexOf("--export-chunk");
if (exportIndex >= 0) {
  const start = Number(process.argv[exportIndex + 1] || 0);
  const count = Number(process.argv[exportIndex + 2] || 25);
  const rows = buildRows(questions, null, null).slice(start, start + count).map((row) => {
    const { collection_id, created_by, updated_by, ...portable } = row;
    return portable;
  });
  process.stdout.write(Buffer.from(JSON.stringify(rows), "utf8").toString("base64"));
  process.exit(0);
}

const supabaseUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const ownerId = process.env.NAGA_OWNER_USER_ID;
if (!supabaseUrl || !secretKey || !ownerId) {
  throw new Error("SUPABASE_URL、SUPABASE_SECRET_KEY、NAGA_OWNER_USER_ID を設定してください。");
}
if (!secretKey.startsWith("sb_secret_")) {
  throw new Error("ブラウザ用キーではなく、サーバー専用 secret key を使用してください。");
}

const supabase = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let collectionId = process.env.NAGA_COLLECTION_ID || null;
let shareSlug = null;
if (collectionId) {
  const { data, error } = await supabase.from("collections").select("id,share_slug").eq("id", collectionId).single();
  if (error) throw error;
  shareSlug = data.share_slug;
} else {
  const { data, error } = await supabase.from("collections").insert({
    owner_id: ownerId,
    title: "くにたそチェック",
    description: "NAGA局面から復習する限定公開問題集",
    visibility: "unlisted",
    allow_comments: true,
    allow_contributions: true,
    published_at: new Date().toISOString(),
  }).select("id,share_slug").single();
  if (error) throw error;
  collectionId = data.id;
  shareSlug = data.share_slug;
}

const rows = buildRows(questions, collectionId, ownerId);
for (let index = 0; index < rows.length; index += 50) {
  const { error } = await supabase
    .from("questions")
    .upsert(rows.slice(index, index + 50), { onConflict: "collection_id,legacy_key" });
  if (error) throw error;
  process.stdout.write(`\r${Math.min(index + 50, rows.length)}/${rows.length}`);
}

console.log(`\nImported ${rows.length} questions.`);
console.log(`Share path: /?collection=${shareSlug}`);
