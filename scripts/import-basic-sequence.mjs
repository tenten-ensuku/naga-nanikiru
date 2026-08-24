#!/usr/bin/env node

/**
 * Import the verified 89-question 基本序列 manifest into its existing
 * Supabase collection. The service key is read from the process environment;
 * it is never printed or committed.
 */

import fs from "node:fs/promises";
import path from "node:path";

const MANIFEST_PATH = path.resolve(process.argv[2] || "outputs/basic-sequence-generated/manifest.json");
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SECRET_KEY = String(process.env.SUPABASE_SECRET_KEY || "").trim();
const OWNER_ID = String(process.env.NAGA_OWNER_USER_ID || "").trim();
const COLLECTION_SLUG = String(process.env.BASIC_SEQUENCE_COLLECTION_SLUG || "3a0a3802df4d41f4bf596eaa").trim();
const EXPECTED_COLLECTION_ID = String(process.env.BASIC_SEQUENCE_COLLECTION_ID || "21c0d135-fce8-450d-b6ef-224788713168").trim();
const CREATED_BY_NAME = String(process.env.BASIC_SEQUENCE_CREATED_BY_NAME || process.env.NAGA_CREATED_BY_NAME || "てんてん").trim();
const STORAGE_BUCKET = String(process.env.NAGA_ASSET_BUCKET || "naga-question-assets").trim();

function requireConfig() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !OWNER_ID) {
    throw new Error("SUPABASE_URL、SUPABASE_SECRET_KEY、NAGA_OWNER_USER_IDを設定してください。");
  }
  if (!SUPABASE_SECRET_KEY.startsWith("sb_secret_")) {
    throw new Error("SUPABASE_SECRET_KEYにはsb_secret_で始まるサーバー専用キーを設定してください。");
  }
}

function apiHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
    ...extra,
  };
}

function storagePathUrl(storagePath) {
  return storagePath.split("/").map(encodeURIComponent).join("/");
}

function publicStorageUrl(storagePath) {
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePathUrl(storagePath)}`;
}

async function requestJson(endpoint, options = {}) {
  const response = await fetch(endpoint, {
    ...options,
    headers: apiHeaders(options.headers || {}),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${options.method || "GET"} ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : null;
}

async function uploadBoardImage(sourcePath, storagePath) {
  const content = await fs.readFile(sourcePath);
  const endpoint = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${storagePathUrl(storagePath)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: apiHeaders({
      "Content-Type": "image/png",
      "x-upsert": "true",
      "cache-control": "31536000",
    }),
    body: content,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`画像アップロード失敗 ${response.status}: ${storagePath} ${(await response.text()).slice(0, 300)}`);
  return publicStorageUrl(storagePath);
}

function payloadForQuestion(question, imageUrl) {
  const payload = structuredClone(question);
  payload.image = imageUrl;
  payload.images = { off: imageUrl, open: imageUrl };
  payload.imageOff = imageUrl;
  payload.imageOpen = imageUrl;
  payload.collectionKey = "basic-sequence";
  payload.tablePlayerNames = {
    shimocha: "アンチョビ",
    toimen: "ター子",
    kamicha: "順子さん",
  };
  return payload;
}

async function main() {
  requireConfig();
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8"));
  const questions = Array.isArray(manifest.questions) ? manifest.questions : [];
  if (questions.length !== 89) throw new Error(`基本序列の問題数が89ではありません: ${questions.length}`);

  const collectionEndpoint = `${SUPABASE_URL}/rest/v1/collections?share_slug=eq.${encodeURIComponent(COLLECTION_SLUG)}&select=id,owner_id,share_slug,title,visibility`;
  const collections = await requestJson(collectionEndpoint);
  const collection = collections?.[0];
  if (!collection) throw new Error(`問題集が見つかりません: ${COLLECTION_SLUG}`);
  if (String(collection.id) !== EXPECTED_COLLECTION_ID) throw new Error(`想定外の問題集IDです: ${collection.id}`);
  if (String(collection.owner_id) !== OWNER_ID) throw new Error("問題集の所有者とNAGA_OWNER_USER_IDが一致しません。");

  const collectionPatchEndpoint = `${SUPABASE_URL}/rest/v1/collections?id=eq.${encodeURIComponent(collection.id)}`;
  await requestJson(collectionPatchEndpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      title: "基本序列問題集",
      description: manifest.collection?.description || "NAGAの第一推奨を選び、基本序列を確認する必須問題集。",
      visibility: "private",
    }),
  });

  const baseDir = path.dirname(MANIFEST_PATH);
  const rows = [];
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    const number = index + 1;
    const imageRelativePath = path.join(baseDir, "images", `q${String(number).padStart(3, "0")}.png`);
    const storagePath = `${collection.id}/basic-sequence-${String(number).padStart(3, "0")}/question.png`;
    const imageUrl = await uploadBoardImage(imageRelativePath, storagePath);
    rows.push({
      collection_id: collection.id,
      created_by: OWNER_ID,
      updated_by: OWNER_ID,
      created_by_name: CREATED_BY_NAME,
      updated_by_name: CREATED_BY_NAME,
      title: `問題${number}`,
      legacy_key: `basic-sequence-${String(number).padStart(3, "0")}`,
      sort_order: index,
      source_kind: "naga_scene",
      source_report_id: question.sourceReportId,
      source_url: question.nagaUrl,
      scene_tw: Number(question.tw),
      scene_ts: Number(question.ts),
      scene_tv: Number(question.tv),
      decision_type: "discard",
      payload: payloadForQuestion(question, imageUrl),
    });
    if (number % 10 === 0 || number === questions.length) console.log(`[basic-sequence] 画像 ${number}/${questions.length}`);
  }

  const questionsEndpoint = `${SUPABASE_URL}/rest/v1/questions?on_conflict=collection_id%2Clegacy_key`;
  for (let offset = 0; offset < rows.length; offset += 20) {
    await requestJson(questionsEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(offset, offset + 20)),
    });
    console.log(`[basic-sequence] 問題 ${Math.min(offset + 20, rows.length)}/${rows.length}`);
  }

  const verifyEndpoint = `${SUPABASE_URL}/rest/v1/questions?collection_id=eq.${encodeURIComponent(collection.id)}&select=id,legacy_key,sort_order,title,source_url,payload&order=sort_order.asc`;
  const registered = await requestJson(verifyEndpoint);
  const numbers = registered.map(row => Number(row.sort_order) + 1);
  const uniqueNumbers = new Set(numbers);
  const imageCount = registered.filter(row => /^https?:\/\//i.test(String(row.payload?.image || ""))).length;
  if (registered.length !== 89 || uniqueNumbers.size !== 89 || numbers[0] !== 1 || numbers.at(-1) !== 89 || imageCount !== 89) {
    throw new Error(`登録確認に失敗しました: count=${registered.length}, unique=${uniqueNumbers.size}, first=${numbers[0]}, last=${numbers.at(-1)}, images=${imageCount}`);
  }
  console.log(JSON.stringify({ collection: "基本序列問題集", collectionSlug: COLLECTION_SLUG, count: registered.length, first: numbers[0], last: numbers.at(-1), images: imageCount }, null, 2));
}

main().catch(error => {
  console.error(`[basic-sequence] ${error.stack || error.message}`);
  process.exitCode = 1;
});
