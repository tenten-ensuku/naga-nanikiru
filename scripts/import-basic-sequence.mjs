#!/usr/bin/env node

/**
 * Import the verified 89-question 基本序列 manifest into its existing
 * Supabase collection. New question images are saved only through the
 * authenticated R2 media Worker; secrets are read from process.env only.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const EXPECTED_QUESTION_COUNT = 89;
export const ASSET_BUCKET = "naga-question-assets";
export const R2_MEDIA_ORIGIN = "https://minkiru-media.naga-study.workers.dev";
export const DEFAULT_COLLECTION_SLUG = "3a0a3802df4d41f4bf596eaa";
export const DEFAULT_COLLECTION_ID = "21c0d135-fce8-450d-b6ef-224788713168";
export const DEFAULT_CREATED_BY_NAME = "てんてん";
export const DEFAULT_MANIFEST_RELATIVE_PATH = "outputs/basic-sequence-generated/manifest.json";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;

function stringValue(value) {
  return String(value || "").trim();
}

function fetchOrThrow(fetchImpl) {
  const resolved = fetchImpl || globalThis.fetch;
  if (typeof resolved !== "function") throw new Error("fetchを利用できません。");
  return resolved;
}

function timeoutSignal() {
  return AbortSignal.timeout(60_000);
}

function originOnly(value) {
  const raw = stringValue(value);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`NAGA_MEDIA_API_URLには${R2_MEDIA_ORIGIN}のオリジンだけを設定してください。`);
  }
  if (parsed.protocol !== "https:" || parsed.origin !== R2_MEDIA_ORIGIN || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`NAGA_MEDIA_API_URLには${R2_MEDIA_ORIGIN}のオリジンだけを設定してください。`);
  }
  return parsed.origin;
}

export function requireConfig(env = process.env) {
  const supabaseUrl = stringValue(env.SUPABASE_URL).replace(/\/+$/, "");
  const supabaseSecretKey = stringValue(env.SUPABASE_SECRET_KEY);
  const ownerId = stringValue(env.NAGA_OWNER_USER_ID);
  const assetProvider = stringValue(env.NAGA_ASSET_PROVIDER);
  const mediaBotToken = stringValue(env.NAGA_MEDIA_BOT_TOKEN);

  if (!supabaseUrl || !supabaseSecretKey || !ownerId || !assetProvider || !mediaBotToken || !stringValue(env.NAGA_MEDIA_API_URL)) {
    throw new Error("SUPABASE_URL、SUPABASE_SECRET_KEY、NAGA_OWNER_USER_ID、NAGA_ASSET_PROVIDER、NAGA_MEDIA_API_URL、NAGA_MEDIA_BOT_TOKENを設定してください。");
  }
  if (!supabaseSecretKey.startsWith("sb_secret_")) {
    throw new Error("SUPABASE_SECRET_KEYにはsb_secret_で始まるサーバー専用キーを設定してください。");
  }
  if (assetProvider !== "r2") {
    throw new Error("NAGA_ASSET_PROVIDER=r2を明示してください。R2 Worker専用です。");
  }

  return {
    supabaseUrl,
    supabaseSecretKey,
    ownerId,
    assetProvider,
    mediaApiUrl: originOnly(env.NAGA_MEDIA_API_URL),
    mediaBotToken,
    collectionSlug: stringValue(env.BASIC_SEQUENCE_COLLECTION_SLUG) || DEFAULT_COLLECTION_SLUG,
    expectedCollectionId: stringValue(env.BASIC_SEQUENCE_COLLECTION_ID) || DEFAULT_COLLECTION_ID,
    createdByName: stringValue(env.BASIC_SEQUENCE_CREATED_BY_NAME) || stringValue(env.NAGA_CREATED_BY_NAME) || DEFAULT_CREATED_BY_NAME,
  };
}

export function apiHeaders(secretKey, extra = {}) {
  return {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    ...extra,
  };
}

async function responseJson(response, method, statusContext) {
  if (!response.ok) {
    if (response.status === 402) {
      throw new Error(`${statusContext} 402: 保存サービスは利用制限中です。自動再試行は行いません。`);
    }
    throw new Error(`${statusContext} ${response.status}`);
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${method || "GET"} ${statusContext}: JSONレスポンスを解釈できません。`);
  }
}

export async function requestSupabaseJson(endpoint, {
  fetchImpl = globalThis.fetch,
  secretKey,
  method = "GET",
  headers = {},
  body,
} = {}) {
  const response = await fetchOrThrow(fetchImpl)(endpoint, {
    method,
    headers: apiHeaders(secretKey, headers),
    body,
    signal: timeoutSignal(),
  });
  return responseJson(response, method, `${method} ${new URL(endpoint).pathname}`);
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalAssetUrl(mediaApiUrl, bucket, assetPath) {
  const encodedPath = assetPath.split("/").map(segment => encodeURIComponent(segment)).join("/");
  return `${mediaApiUrl}/v1/public/${bucket}/${encodedPath}`;
}

export function expectedMediaAsset({ mediaApiUrl, collectionId, sha, size }) {
  const assetPath = `${collectionId}/${sha}.png`;
  const bucket = ASSET_BUCKET;
  return {
    bucket,
    path: assetPath,
    src: canonicalAssetUrl(mediaApiUrl, bucket, assetPath),
    size,
    sha,
    key: `${bucket}/${assetPath}`,
  };
}

export function validateMediaUploadResponse(result, expected) {
  const returnedSha = result?.sha256 ?? result?.sha;
  if (!result || result.bucket !== expected.bucket || result.path !== expected.path || result.src !== expected.src ||
      result.size !== expected.size || returnedSha !== expected.sha ||
      (result.sha256 !== undefined && result.sha256 !== expected.sha) ||
      (result.sha !== undefined && result.sha !== expected.sha)) {
    throw new Error("R2 Workerの画像保存結果が想定したbucket/path/src/size/shaと一致しません。");
  }
  return result;
}

export async function uploadR2Image(sourcePath, collectionId, {
  config,
  fetchImpl = globalThis.fetch,
  readFileImpl = fs.readFile,
} = {}) {
  if (config?.assetProvider !== "r2" || config.mediaApiUrl !== R2_MEDIA_ORIGIN || !config.mediaBotToken) {
    throw new Error("R2画像保存の設定が未完了です。NAGA_ASSET_PROVIDER=r2と固定Workerオリジンが必要です。");
  }
  if (!UUID.test(String(collectionId))) throw new Error("R2画像保存にはUUID形式の問題集IDが必要です。");

  const content = await readFileImpl(sourcePath);
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  const sha = sha256Hex(bytes);
  if (!SHA256.test(sha)) throw new Error("画像SHA-256の計算に失敗しました。");
  const expected = expectedMediaAsset({ mediaApiUrl: config.mediaApiUrl, collectionId, sha, size: bytes.length });
  const response = await fetchOrThrow(fetchImpl)(`${config.mediaApiUrl}/v1/bot/assets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.mediaBotToken}`,
      "Content-Type": "image/png",
      "X-Collection-Id": collectionId,
      "X-Asset-SHA256": sha,
      "X-Asset-Key": expected.key,
    },
    body: bytes,
    signal: timeoutSignal(),
  });
  const result = await responseJson(response, "POST", "R2 Worker /v1/bot/assets");
  return validateMediaUploadResponse(result, expected);
}

export function payloadForQuestion(question, imageUrl) {
  const payload = structuredClone(question);
  payload.image = imageUrl;
  payload.images = { off: imageUrl, open: imageUrl };
  payload.imageOff = imageUrl;
  payload.imageOpen = imageUrl;
  payload.collectionKey = "basic-sequence";
  return payload;
}

function manifestPathFromArgv(argv = process.argv) {
  return path.resolve(argv[2] || DEFAULT_MANIFEST_RELATIVE_PATH);
}

async function manifestFromInput(manifestInput, readFileImpl, manifestPath) {
  if (manifestInput !== undefined) return manifestInput;
  return JSON.parse(await readFileImpl(manifestPath, "utf8"));
}

export function validateManifestQuestions(manifest) {
  const questions = Array.isArray(manifest?.questions) ? manifest.questions : [];
  if (questions.length !== EXPECTED_QUESTION_COUNT) throw new Error(`基本序列の問題数が${EXPECTED_QUESTION_COUNT}ではありません: ${questions.length}`);
  return questions;
}

export function validateRegisteredQuestions(registered, expectedRows) {
  if (!Array.isArray(registered) || registered.length !== expectedRows.length) {
    throw new Error(`登録確認に失敗しました: count=${registered?.length ?? 0}, expected=${expectedRows.length}`);
  }
  for (let index = 0; index < expectedRows.length; index += 1) {
    const row = registered[index];
    const expected = expectedRows[index];
    const expectedLegacyKey = `basic-sequence-${String(index + 1).padStart(3, "0")}`;
    const expectedTitle = `問題${index + 1}`;
    if (!UUID.test(String(row?.id || "")) || row.legacy_key !== expectedLegacyKey || row.sort_order !== index ||
        row.title !== expectedTitle || row.image !== expected.payload.image) {
      throw new Error(`登録確認に失敗しました: index=${index + 1}`);
    }
  }
  return {
    count: registered.length,
    first: Number(registered[0]?.sort_order) + 1,
    last: Number(registered.at(-1)?.sort_order) + 1,
    images: registered.filter(row => typeof row?.image === "string" && row.image.length > 0).length,
  };
}

export async function runImport({
  env = process.env,
  manifestPath = manifestPathFromArgv(),
  manifest: manifestInput,
  fetchImpl = globalThis.fetch,
  readFileImpl = fs.readFile,
  log = console.log,
} = {}) {
  // This must stay before the manifest/collection workflow: every required
  // secret and the R2-only provider are checked before any DB mutation.
  const config = requireConfig(env);
  const manifest = await manifestFromInput(manifestInput, readFileImpl, manifestPath);
  const questions = validateManifestQuestions(manifest);

  const requestJson = (endpoint, options = {}) => requestSupabaseJson(endpoint, {
    ...options,
    fetchImpl,
    secretKey: config.supabaseSecretKey,
  });
  const collectionEndpoint = `${config.supabaseUrl}/rest/v1/collections?share_slug=eq.${encodeURIComponent(config.collectionSlug)}&select=id,owner_id,share_slug,title,visibility`;
  const collections = await requestJson(collectionEndpoint);
  const collection = collections?.[0];
  if (!collection) throw new Error(`問題集が見つかりません: ${config.collectionSlug}`);
  if (String(collection.id) !== config.expectedCollectionId) throw new Error(`想定外の問題集IDです: ${collection.id}`);
  if (String(collection.owner_id) !== config.ownerId) throw new Error("問題集の所有者とNAGA_OWNER_USER_IDが一致しません。");
  if (!UUID.test(String(collection.id))) throw new Error(`問題集IDがUUIDではありません: ${collection.id}`);

  const collectionPatchEndpoint = `${config.supabaseUrl}/rest/v1/collections?id=eq.${encodeURIComponent(collection.id)}`;
  await requestJson(collectionPatchEndpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      title: "基本序列問題集",
      description: manifest.collection?.description || "NAGAの第一推奨を選び、基本序列を確認する必須問題集。",
      visibility: "private",
    }),
  });

  const baseDir = path.dirname(manifestPath);
  const rows = [];
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    const number = index + 1;
    const imageRelativePath = path.join(baseDir, "images", `q${String(number).padStart(3, "0")}.png`);
    const image = await uploadR2Image(imageRelativePath, collection.id, { config, fetchImpl, readFileImpl });
    rows.push({
      collection_id: collection.id,
      created_by: config.ownerId,
      updated_by: config.ownerId,
      created_by_name: config.createdByName,
      updated_by_name: config.createdByName,
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
      payload: payloadForQuestion(question, image.src),
    });
    if (number % 10 === 0 || number === questions.length) log(`[basic-sequence] 画像 ${number}/${questions.length}`);
  }

  const questionsEndpoint = `${config.supabaseUrl}/rest/v1/questions?on_conflict=collection_id%2Clegacy_key`;
  for (let offset = 0; offset < rows.length; offset += 20) {
    await requestJson(questionsEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(offset, offset + 20)),
    });
    log(`[basic-sequence] 問題 ${Math.min(offset + 20, rows.length)}/${rows.length}`);
  }

  const verifyEndpoint = `${config.supabaseUrl}/rest/v1/questions?collection_id=eq.${encodeURIComponent(collection.id)}&select=id,legacy_key,sort_order,title,image:payload->>image&order=sort_order.asc`;
  const registered = await requestJson(verifyEndpoint);
  const registration = validateRegisteredQuestions(registered, rows);
  const summary = {
    collection: "基本序列問題集",
    collectionSlug: config.collectionSlug,
    count: registration.count,
    first: registration.first,
    last: registration.last,
    images: registration.images,
  };
  log(JSON.stringify(summary, null, 2));
  return summary;
}

export async function main(options = {}) {
  return runImport({ ...options, manifestPath: options.manifestPath ?? manifestPathFromArgv(options.argv) });
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath && import.meta.url === invokedPath) {
  main().catch(error => {
    console.error(`[basic-sequence] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
