import assert from "node:assert/strict";
import test from "node:test";

import {
  R2_MEDIA_ORIGIN,
  ASSET_BUCKET,
  DEFAULT_COLLECTION_ID,
  DEFAULT_COLLECTION_SLUG,
  requireConfig,
  runImport,
  sha256Hex,
  uploadR2Image,
} from "../scripts/import-basic-sequence.mjs";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const COLLECTION_ID = DEFAULT_COLLECTION_ID;
const BOT_TOKEN = "bot-token-v230-test";
const SUPABASE_URL = "https://naga-test.supabase.co";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);

function env(overrides = {}) {
  return {
    SUPABASE_URL,
    SUPABASE_SECRET_KEY: "sb_secret_test-only",
    NAGA_OWNER_USER_ID: OWNER_ID,
    NAGA_ASSET_PROVIDER: "r2",
    NAGA_MEDIA_API_URL: R2_MEDIA_ORIGIN,
    NAGA_MEDIA_BOT_TOKEN: BOT_TOKEN,
    ...overrides,
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function header(options, name) {
  return new Headers(options.headers).get(name);
}

function tinyManifest() {
  return {
    collection: { description: "tiny fixture" },
    questions: Array.from({ length: 89 }, (_, index) => ({
      sourceReportId: `tiny-report-${index + 1}`,
      nagaUrl: `https://naga.example/tiny/${index + 1}`,
      tw: 1,
      ts: 2,
      tv: 3,
      fixtureLabel: `tiny-${index + 1}`,
    })),
  };
}

function rowId(index) {
  return `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}

test("V230 requires R2-only config and rejects it before any DB request", async () => {
  assert.throws(
    () => requireConfig(env({ NAGA_ASSET_PROVIDER: "supabase" })),
    /NAGA_ASSET_PROVIDER=r2/,
  );
  assert.throws(
    () => requireConfig(env({ NAGA_MEDIA_API_URL: `${R2_MEDIA_ORIGIN}/v1` })),
    /オリジンだけ/,
  );

  let fetchCalls = 0;
  await assert.rejects(
    runImport({
      env: env({ NAGA_MEDIA_BOT_TOKEN: "" }),
      manifest: { questions: [] },
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("network must not be used");
      },
      readFileImpl: async () => {
        throw new Error("fixture must not be read");
      },
    }),
    /NAGA_MEDIA_BOT_TOKEN/,
  );
  assert.equal(fetchCalls, 0);
});

test("V230 sends raw PNG bytes to the fixed R2 Worker and verifies the canonical result", async () => {
  const config = requireConfig(env());
  const sha = sha256Hex(PNG);
  const expectedPath = `${COLLECTION_ID}/${sha}.png`;
  const expectedSrc = `${R2_MEDIA_ORIGIN}/v1/public/${ASSET_BUCKET}/${expectedPath}`;
  let call;

  const result = await uploadR2Image("tiny-image.png", COLLECTION_ID, {
    config,
    readFileImpl: async sourcePath => {
      assert.equal(sourcePath, "tiny-image.png");
      return PNG;
    },
    fetchImpl: async (url, options) => {
      call = { url, options };
      return jsonResponse({
        bucket: ASSET_BUCKET,
        path: expectedPath,
        src: expectedSrc,
        size: PNG.length,
        sha256: sha,
      });
    },
  });

  assert.equal(call.url, `${R2_MEDIA_ORIGIN}/v1/bot/assets`);
  assert.equal(call.options.method, "POST");
  assert.equal(header(call.options, "Authorization"), `Bearer ${BOT_TOKEN}`);
  assert.equal(header(call.options, "Content-Type"), "image/png");
  assert.equal(header(call.options, "X-Collection-Id"), COLLECTION_ID);
  assert.equal(header(call.options, "X-Asset-SHA256"), sha);
  assert.equal(header(call.options, "X-Asset-Key"), `${ASSET_BUCKET}/${expectedPath}`);
  assert.equal(header(call.options, "X-Upsert"), null);
  assert.deepEqual([...call.options.body], [...PNG]);
  assert.deepEqual(result, {
    bucket: ASSET_BUCKET,
    path: expectedPath,
    src: expectedSrc,
    size: PNG.length,
    sha256: sha,
  });
});

test("V230 stops on Worker 402 without retrying or falling back to Supabase Storage", async () => {
  const config = requireConfig(env());
  let calls = 0;
  await assert.rejects(
    uploadR2Image("tiny-image.png", COLLECTION_ID, {
      config,
      readFileImpl: async () => PNG,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ error: "payment_required" }, 402);
      },
    }),
    /402.*自動再試行は行いません/,
  );
  assert.equal(calls, 1);
});

test("V230 imports the tiny fixture with mocked DB/Worker calls and verifies only the image alias", async () => {
  const manifest = tinyManifest();
  const calls = [];
  const postedRows = [];
  const logs = [];
  const imageSha = sha256Hex(PNG);

  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    calls.push({ url, options });

    if (url.origin === SUPABASE_URL && url.pathname === "/rest/v1/collections" && options.method === "GET") {
      return jsonResponse([{
        id: COLLECTION_ID,
        owner_id: OWNER_ID,
        share_slug: DEFAULT_COLLECTION_SLUG,
        title: "既存タイトル",
        visibility: "private",
      }]);
    }
    if (url.origin === SUPABASE_URL && url.pathname === "/rest/v1/collections" && options.method === "PATCH") {
      return jsonResponse(null);
    }
    if (url.origin === R2_MEDIA_ORIGIN && url.pathname === "/v1/bot/assets") {
      assert.equal(header(options, "Authorization"), `Bearer ${BOT_TOKEN}`);
      assert.equal(header(options, "Content-Type"), "image/png");
      assert.equal(header(options, "X-Collection-Id"), COLLECTION_ID);
      assert.equal(header(options, "X-Asset-SHA256"), imageSha);
      assert.equal(header(options, "X-Asset-Key"), `${ASSET_BUCKET}/${COLLECTION_ID}/${imageSha}.png`);
      assert.deepEqual([...options.body], [...PNG]);
      return jsonResponse({
        bucket: ASSET_BUCKET,
        path: `${COLLECTION_ID}/${imageSha}.png`,
        src: `${R2_MEDIA_ORIGIN}/v1/public/${ASSET_BUCKET}/${COLLECTION_ID}/${imageSha}.png`,
        size: PNG.length,
        sha256: imageSha,
      });
    }
    if (url.origin === SUPABASE_URL && url.pathname === "/rest/v1/questions" && options.method === "POST") {
      postedRows.push(...JSON.parse(options.body));
      return jsonResponse(null);
    }
    if (url.origin === SUPABASE_URL && url.pathname === "/rest/v1/questions" && options.method === "GET") {
      assert.equal(url.searchParams.get("select"), "id,legacy_key,sort_order,title,image:payload->>image");
      assert.doesNotMatch(url.searchParams.get("select"), /(?:^|,)payload(?:,|$)/);
      return jsonResponse(postedRows.map((row, index) => ({
        id: rowId(index),
        legacy_key: row.legacy_key,
        sort_order: row.sort_order,
        title: row.title,
        image: row.payload.image,
      })));
    }
    throw new Error(`unexpected mocked request: ${options.method} ${url}`);
  };

  const summary = await runImport({
    env: env(),
    manifestPath: "tiny/manifest.json",
    manifest,
    fetchImpl,
    readFileImpl: async sourcePath => {
      assert.match(sourcePath, /tiny[\\/]images[\\/]q\d{3}\.png$/);
      return PNG;
    },
    log: message => logs.push(String(message)),
  });

  assert.deepEqual(summary, {
    collection: "基本序列問題集",
    collectionSlug: DEFAULT_COLLECTION_SLUG,
    count: 89,
    first: 1,
    last: 89,
    images: 89,
  });
  assert.equal(postedRows.length, 89);
  assert.equal(calls.filter(call => call.url.pathname === "/v1/bot/assets").length, 89);
  assert.equal(calls.filter(call => call.url.pathname.includes("/storage/v1/object")).length, 0);
  assert.equal(calls.filter(call => header(call.options, "X-Upsert")).length, 0);
  assert.doesNotMatch(logs.join("\n"), new RegExp(BOT_TOKEN));
});
