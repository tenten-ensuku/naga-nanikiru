import fs from "node:fs/promises";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const ownerId = process.env.NAGA_OWNER_USER_ID;

if (!supabaseUrl || !secretKey || !ownerId) {
  throw new Error("SUPABASE_URL、SUPABASE_SECRET_KEY、NAGA_OWNER_USER_IDを設定してください。");
}
if (!secretKey.startsWith("sb_secret_")) {
  throw new Error("ブラウザ用publishable keyではなく、サーバー専用secret keyを使用してください。");
}

const supabase = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const source = JSON.parse(await fs.readFile(new URL("../public/question-data/selected-questions.json", import.meta.url), "utf8"));
if (!Array.isArray(source) || !source.length) throw new Error("問題データを読み取れませんでした。");

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
    published_at: new Date().toISOString(),
  }).select("id,share_slug").single();
  if (error) throw error;
  collectionId = data.id;
  shareSlug = data.share_slug;
}

const rows = source.map((question, index) => {
  const scene = parseNagaUrl(question.nagaUrl);
  return {
    collection_id: collectionId,
    created_by: ownerId,
    title: String(question.title || `問題${question.number || index + 1}`).slice(0, 160),
    legacy_key: String(question.id || `number-${question.number || index + 1}`),
    sort_order: index,
    source_kind: scene.reportId ? "naga_scene" : (question.threadUrl ? "discord" : "manual"),
    source_report_id: scene.reportId,
    source_url: question.nagaUrl || question.threadUrl || null,
    scene_tw: Number.isInteger(scene.tw) && scene.tw >= 0 && scene.tw <= 3 ? scene.tw : null,
    scene_ts: Number.isInteger(scene.ts) && scene.ts >= 0 ? scene.ts : null,
    scene_tv: Number.isInteger(scene.tv) && scene.tv >= 0 ? scene.tv : null,
    decision_type: ["discard", "call", "riichi", "combined"].includes(question.decisionType)
      ? question.decisionType
      : "discard",
    payload: question,
    updated_at: new Date().toISOString(),
  };
});

for (let index = 0; index < rows.length; index += 50) {
  const { error } = await supabase
    .from("questions")
    .upsert(rows.slice(index, index + 50), { onConflict: "collection_id,legacy_key" });
  if (error) throw error;
  process.stdout.write(`\r${Math.min(index + 50, rows.length)}/${rows.length}`);
}

console.log(`\nImported ${rows.length} questions.`);
console.log(`Share path: /?collection=${shareSlug}`);
