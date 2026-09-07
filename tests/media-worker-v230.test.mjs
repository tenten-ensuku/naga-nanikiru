import assert from "node:assert/strict";
import test from "node:test";
import { createMediaWorker, imageType, validKey } from "../worker/media.mjs";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const COLLECTION_ID = "33333333-3333-4333-8333-333333333333";
const MEDIA_ORIGIN = "https://media.example";
const NOW = 1_800_000_000_000;
const SIGNING_KEY = "s".repeat(32);
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]);

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes) {
  return hex(await globalThis.crypto.subtle.digest("SHA-256", bytes));
}

async function signature(key, expires, secret = SIGNING_KEY) {
  const encoder = new TextEncoder();
  const signingKey = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return hex(await globalThis.crypto.subtle.sign("HMAC", signingKey, encoder.encode(`${key}\n${expires}`)));
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function makeSupabaseFetch(handlers = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const call = { url, init, body: init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);

    if (url.pathname === "/auth/v1/user") return jsonResponse({ id: USER_ID });
    if (url.pathname.startsWith("/rest/v1/collections")) return jsonResponse([{ owner_id: USER_ID }]);

    const rpcName = url.pathname.startsWith("/rest/v1/rpc/")
      ? url.pathname.slice("/rest/v1/rpc/".length)
      : null;
    if (rpcName && handlers[rpcName]) return handlers[rpcName](call);
    if (rpcName === "authorize_media_upload") {
      return jsonResponse({ owner_id: USER_ID, collection_id: COLLECTION_ID });
    }
    if (["reserve_media_asset", "complete_media_asset", "finish_media_asset_delete"].includes(rpcName)) {
      return jsonResponse({});
    }
    return jsonResponse([]);
  };
  return { calls, fetchImpl };
}

function makeR2({ head = async () => null, get = async () => null, put = async (_key, bytes, options) => ({size:bytes.length,customMetadata:options.customMetadata}),
  deleteObject = async () => undefined, list = async () => ({ objects: [], truncated: false }) } = {}) {
  const calls = { head: [], get: [], put: [], delete: [], list: [] };
  return {
    calls,
    async head(...args) { calls.head.push(args); return head(...args); },
    async get(...args) { calls.get.push(args); return get(...args); },
    async put(...args) { calls.put.push(args); return put(...args); },
    async delete(...args) { calls.delete.push(args); return deleteObject(...args); },
    async list(...args) { calls.list.push(args); return list(...args); }
  };
}

function makeEnv(IMAGES, overrides = {}) {
  return {
    IMAGES,
    SUPABASE_URL: "https://media-test.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    SUPABASE_SECRET_KEY: "secret-key",
    MEDIA_SIGNING_KEY: SIGNING_KEY,
    UPLOADS_ENABLED: "true",
    ALLOWED_ORIGINS: "https://tenten-ensuku.github.io",
    ...overrides
  };
}

function makeContext() {
  const pending = [];
  return {
    pending,
    waitUntil(promise) { pending.push(Promise.resolve(promise)); },
    async drain() { await Promise.all(pending); }
  };
}

function request(path, { method = "GET", headers = {}, body } = {}) {
  return new Request(MEDIA_ORIGIN + path, { method, headers, body });
}

async function uploadRequest(bucket, bytes = PNG, contentType = "image/png", overrides = {}) {
  return request("/v1/assets", {
    method: "POST",
    headers: {
      Authorization: "Bearer user-token",
      "X-Asset-Bucket": bucket,
      "Content-Type": contentType,
      "X-Asset-SHA256": await sha256(bytes),
      ...overrides
    },
    body: bytes
  });
}

function imageObject(bytes = PNG, contentType = "image/png", etag = '"etag-v230"') {
  return {
    body: bytes,
    size: bytes.length,
    httpEtag: etag,
    writeHttpMetadata(headers) { headers.set("Content-Type", contentType); }
  };
}

test("V230 exports reject unsafe keys and recognize the supported image signatures", () => {
  assert.equal(validKey("question-assets/owner/questions/file.png"), true);
  assert.equal(validKey("naga-question-assets/collection/file.png"), true);
  for (const key of [
    "",
    "unknown-assets/owner/file.png",
    "question-assets/",
    "question-assets/owner/../file.png",
    "question-assets/owner/%2e%2e/file.png",
    "question-assets/owner/file.png?x=1",
    "question-assets/owner\\file.png",
    `question-assets/owner/${"x".repeat(1201)}`
  ]) assert.equal(validKey(key), false, key);

  assert.equal(imageType(PNG), "image/png");
  assert.equal(imageType(new Uint8Array([255, 216, 255, 0])), "image/jpeg");
  assert.equal(imageType(new TextEncoder().encode("GIF89a")), "image/gif");
  assert.equal(imageType(new TextEncoder().encode("RIFFxxxxWEBP")), "image/webp");
  assert.equal(imageType(new Uint8Array([82,73,70,70,195,169,128,0,87,69,66,80])), "image/webp");
  assert.equal(imageType(new Uint8Array([1, 2, 3, 4])), "");
});

test("V230 rejects unauthenticated uploads and uploads without ownership", async () => {
  const r2 = makeR2();
  const supabase = makeSupabaseFetch({
    authorize_media_upload: () => jsonResponse({ owner_id: OTHER_USER_ID, collection_id: COLLECTION_ID })
  });
  const worker = createMediaWorker({ fetchImpl: supabase.fetchImpl });
  const env = makeEnv(r2);

  const unauthenticated = await worker.fetch(await uploadRequest("comment-assets", PNG, "image/png", { Authorization: "" }), env, makeContext());
  assert.equal(unauthenticated.status, 401);

  const foreignOwner = await worker.fetch(await uploadRequest("comment-assets"), env, makeContext());
  assert.equal(foreignOwner.status, 403);
  assert.equal(supabase.calls.filter(call => call.url.pathname.endsWith("/authorize_media_upload")).length, 1);
  assert.equal(r2.calls.head.length, 0);
  assert.equal(r2.calls.put.length, 0);
});

test("V230 rejects oversized bodies and magic/content-type mismatches", async () => {
  const r2 = makeR2();
  const supabase = makeSupabaseFetch();
  const worker = createMediaWorker({ fetchImpl: supabase.fetchImpl });
  const env = makeEnv(r2);

  const oversized = await worker.fetch(await uploadRequest("reaction-assets", PNG, "image/png", {
    "Content-Length": "1048577"
  }), env, makeContext());
  assert.equal(oversized.status, 413);

  const wrongType = await worker.fetch(await uploadRequest("comment-assets", PNG, "image/jpeg"), env, makeContext());
  assert.equal(wrongType.status, 415);

  const gif = new TextEncoder().encode("GIF89a");
  const questionGif = await worker.fetch(await uploadRequest("question-assets", gif, "image/gif"), env, makeContext());
  assert.equal(questionGif.status, 415);
  assert.equal(r2.calls.put.length, 0);
});

test("V230 rejects a mismatched SHA-256 before touching R2", async () => {
  const r2 = makeR2();
  const supabase = makeSupabaseFetch();
  const worker = createMediaWorker({ fetchImpl: supabase.fetchImpl });
  const env = makeEnv(r2);
  const response = await worker.fetch(await uploadRequest("comment-assets", PNG, "image/png", {
    "X-Asset-SHA256": "0".repeat(64)
  }), env, makeContext());

  assert.equal(response.status, 422);
  assert.equal(r2.calls.head.length, 0);
  assert.equal(r2.calls.put.length, 0);
  assert.equal(supabase.calls.filter(call => call.url.pathname.endsWith("/reserve_media_asset")).length, 0);
});

test("V230 skips R2 put for an identical duplicate and completes the reservation", async () => {
  const digest = await sha256(PNG);
  const key = `comment-assets/${USER_ID}/comments/${digest}.png`;
  const r2 = makeR2({ head: async requestedKey => {
    assert.equal(requestedKey, key);
    return { size: PNG.length, customMetadata: { sha256: digest } };
  }, put: async () => assert.fail("duplicate upload must not call R2 put") });
  const supabase = makeSupabaseFetch();
  const worker = createMediaWorker({ fetchImpl: supabase.fetchImpl });
  const response = await worker.fetch(await uploadRequest("comment-assets"), makeEnv(r2), makeContext());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.reused, true);
  assert.equal(body.bucket, "comment-assets");
  assert.equal(body.path, `${USER_ID}/comments/${digest}.png`);
  assert.equal(r2.calls.put.length, 0);
  assert.equal(supabase.calls.filter(call => call.url.pathname.endsWith("/complete_media_asset")).length, 1);
});

test("V230 never marks a failed conditional R2 put as complete",async()=>{
  const r2=makeR2({put:async()=>null});
  const supabase=makeSupabaseFetch();
  const worker=createMediaWorker({fetchImpl:supabase.fetchImpl});
  const result=await worker.fetch(await uploadRequest("comment-assets"),makeEnv(r2),makeContext());
  assert.equal(result.status,409);
  assert.equal(supabase.calls.filter(call=>call.url.pathname.endsWith("/complete_media_asset")).length,0);
});

test("V230 public migration resolution returns only individual verified keys",async()=>{
  const keys=["naga-question-assets/collection/ready.png","naga-question-assets/collection/pending.png"];
  const supabase=makeSupabaseFetch({
    resolve_public_media:call=>{
      assert.deepEqual(call.body.p_keys,keys);
      return jsonResponse([{object_key:keys[0]}]);
    }
  });
  const worker=createMediaWorker({fetchImpl:supabase.fetchImpl});
  const result=await worker.fetch(request("/v1/resolve-public",{
    method:"POST",headers:{Authorization:"Bearer user-token"},body:JSON.stringify({keys})
  }),makeEnv(makeR2()),makeContext());
  assert.equal(result.status,200);
  assert.deepEqual(await result.json(),{keys:[keys[0]]});
});

test("V230 returns quota 402 without retrying the reservation", async () => {
  const r2 = makeR2();
  const supabase = makeSupabaseFetch({
    reserve_media_asset: () => jsonResponse({ message: "payment_required" }, 402)
  });
  const worker = createMediaWorker({ fetchImpl: supabase.fetchImpl });
  const response = await worker.fetch(await uploadRequest("comment-assets"), makeEnv(r2), makeContext());

  assert.equal(response.status, 402);
  assert.equal(supabase.calls.filter(call => call.url.pathname.endsWith("/reserve_media_asset")).length, 1);
  assert.equal(r2.calls.head.length, 0);
  assert.equal(r2.calls.put.length, 0);
});

test("V230 returns upload-disabled 503 before contacting Supabase", async () => {
  const r2 = makeR2();
  const supabase = makeSupabaseFetch();
  const worker = createMediaWorker({ fetchImpl: supabase.fetchImpl });
  const response = await worker.fetch(request("/v1/assets", { method: "POST" }), makeEnv(r2, { UPLOADS_ENABLED: "false" }), makeContext());

  assert.equal(response.status, 503);
  assert.equal(supabase.calls.length, 0);
  assert.equal(r2.calls.head.length, 0);
  assert.equal(r2.calls.put.length, 0);
});

test("V230 serves public GET from R2 with metadata and never calls Supabase", async () => {
  const key = `comment-assets/${USER_ID}/comments/public.png`;
  const r2 = makeR2({ get: async requestedKey => {
    assert.equal(requestedKey, key);
    return imageObject();
  } });
  const supabase = makeSupabaseFetch();
  const worker = createMediaWorker({ fetchImpl: supabase.fetchImpl });
  const response = await worker.fetch(request(`/v1/public/${key}`), makeEnv(r2), makeContext());

  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), PNG);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("etag"), '"etag-v230"');
  assert.equal(response.headers.get("content-length"), String(PNG.length));
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(supabase.calls.length, 0);
  assert.equal(r2.calls.get.length, 1);
  assert.equal(r2.calls.head.length, 0);
});

test("V230 denies unsigned, expired, and forged private URLs, then serves a valid signature", async () => {
  const key = `question-assets/${USER_ID}/${COLLECTION_ID}/${"a".repeat(64)}.png`;
  const r2 = makeR2({ get: async requestedKey => {
    assert.equal(requestedKey, key);
    return imageObject();
  } });
  const worker = createMediaWorker({ fetchImpl: makeSupabaseFetch().fetchImpl, now: () => NOW });
  const env = makeEnv(r2);
  const expires = Math.floor(NOW / 1000) + 300;

  const unsigned = await worker.fetch(request(`/v1/private/${key}?expires=${expires}`), env, makeContext());
  const expired = await worker.fetch(request(`/v1/private/${key}?expires=${Math.floor(NOW / 1000) - 1}`), env, makeContext());
  const forged = await worker.fetch(request(`/v1/private/${key}?expires=${expires}&signature=${"0".repeat(64)}`), env, makeContext());
  const valid = await worker.fetch(request(`/v1/private/${key}?expires=${expires}&signature=${await signature(key, expires)}`), env, makeContext());

  assert.equal(unsigned.status, 403);
  assert.equal(expired.status, 403);
  assert.equal(forged.status, 403);
  assert.equal(valid.status, 200);
  assert.deepEqual(new Uint8Array(await valid.arrayBuffer()), PNG);
  assert.equal(r2.calls.get.length, 1);
});

test("V230 resolves private URLs only after auth and the returned signed URL is fetchable", async () => {
  const key = `question-assets/${USER_ID}/${COLLECTION_ID}/${"b".repeat(64)}.png`;
  const r2 = makeR2({ get: async () => imageObject() });
  const supabase = makeSupabaseFetch({
    resolve_private_media: call => {
      assert.deepEqual(call.body, { p_keys: [key] });
      return jsonResponse([{ object_key:key }]);
    }
  });
  const worker = createMediaWorker({ fetchImpl: supabase.fetchImpl, now: () => NOW });
  const env = makeEnv(r2);
  const resolveResponse = await worker.fetch(request("/v1/resolve", {
    method: "POST",
    headers: { Authorization: "Bearer user-token", "Content-Type": "application/json" },
    body: JSON.stringify({ keys: [key] })
  }), env, makeContext());
  const resolved = await resolveResponse.json();
  const signedUrl = resolved.urls[key];
  const validGet = await worker.fetch(new Request(signedUrl), env, makeContext());

  assert.equal(resolveResponse.status, 200);
  assert.match(signedUrl, /\/v1\/private\/question-assets\//);
  assert.equal(validGet.status, 200);
  assert.equal(supabase.calls.filter(call => call.url.pathname === "/auth/v1/user").length, 1);
  assert.equal(supabase.calls.filter(call => call.url.pathname.endsWith("/resolve_private_media")).length, 1);
  assert.equal(r2.calls.get.length, 1);
});

test("V230 denies foreign buckets and traversal in runtime routes", async () => {
  const r2 = makeR2();
  const supabase = makeSupabaseFetch();
  const worker = createMediaWorker({ fetchImpl: supabase.fetchImpl, now: () => NOW });
  const env = makeEnv(r2);

  const publicForeign = await worker.fetch(request(`/v1/public/question-assets/${USER_ID}/file.png`), env, makeContext());
  const privateForeign = await worker.fetch(request(`/v1/private/comment-assets/${USER_ID}/file.png?expires=1800000300&signature=${"0".repeat(64)}`), env, makeContext());
  const traversal = await worker.fetch(request("/v1/public/comment-assets/user/%2e%2e%2fsecret.png"), env, makeContext());
  const resolveTraversal = await worker.fetch(request("/v1/resolve", {
    method: "POST",
    headers: { Authorization: "Bearer user-token", "Content-Type": "application/json" },
    body: JSON.stringify({ keys: [`question-assets/${USER_ID}/../secret.png`] })
  }), env, makeContext());

  assert.equal(publicForeign.status, 404);
  assert.equal(privateForeign.status, 404);
  assert.equal(traversal.status, 404);
  assert.equal(resolveTraversal.status, 400);
  assert.equal(r2.calls.get.length, 0);
});

test("V230 does not allow a foreign CORS origin", async () => {
  const r2 = makeR2();
  const worker = createMediaWorker({ fetchImpl: makeSupabaseFetch().fetchImpl });
  const response = await worker.fetch(request("/v1/assets", {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" }
  }), makeEnv(r2), makeContext());

  assert.equal(response.status, 204);
  assert.equal(response.headers.has("access-control-allow-origin"), false);
  assert.equal(response.headers.has("access-control-allow-methods"), false);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("V230 does not delete an R2 object when the database says it is in use", async () => {
  const r2 = makeR2();
  const supabase = makeSupabaseFetch({
    begin_media_asset_delete: () => jsonResponse({ message: "media_asset_in_use" }, 409)
  });
  const worker = createMediaWorker({ fetchImpl: supabase.fetchImpl });
  const response = await worker.fetch(request("/v1/assets", {
    method: "DELETE",
    headers: { Authorization: "Bearer user-token", "Content-Type": "application/json" },
    body: JSON.stringify({ bucket: "comment-assets", path: `${USER_ID}/comments/in-use.png` })
  }), makeEnv(r2), makeContext());

  assert.equal(response.status, 409);
  assert.equal(r2.calls.delete.length, 0);
  assert.equal(supabase.calls.filter(call => call.url.pathname.endsWith("/finish_media_asset_delete")).length, 0);
});

test("V230 deleting an unused image invalidates the exact serving cache key", async () => {
  const r2 = makeR2();
  const supabase = makeSupabaseFetch({begin_media_asset_delete: () => jsonResponse(true)});
  const deleted = [];
  const worker = createMediaWorker({fetchImpl:supabase.fetchImpl,cache:{delete:async value=>{deleted.push(value.url);return true;}}});
  const context = makeContext();
  const response = await worker.fetch(request("/v1/assets", {
    method:"DELETE", headers:{Authorization:"Bearer user-token","Content-Type":"application/json"},
    body:JSON.stringify({bucket:"comment-assets",path:`${USER_ID}/comments/unused.png`})
  }),makeEnv(r2),context);
  await context.drain();
  assert.equal(response.status,200);
  assert.equal(r2.calls.delete.length,1);
  assert.deepEqual(deleted,[`${MEDIA_ORIGIN}/v1/public/comment-assets/${USER_ID}/comments/unused.png?media-cache=v230-mime`]);
});

test("V230 scheduled usage counts R2 metadata without reading object bodies", async () => {
  const r2 = makeR2({
    get: async () => assert.fail("scheduled usage must not call R2 get"),
    list: async (_options = {}) => r2.calls.list.length === 1
      ? { objects: [{ size: 5, key: "a" }, { size: 7, key: "b" }], truncated: true, cursor: "next" }
      : { objects: [{ size: 3, key: "c" }], truncated: false }
  });
  const snapshots = [];
  const supabase = makeSupabaseFetch({
    media_usage_snapshot: call => { snapshots.push(call.body); return jsonResponse({ recorded: true }); }
  });
  const worker = createMediaWorker({ fetchImpl: supabase.fetchImpl });
  const context = makeContext();
  await worker.scheduled({}, makeEnv(r2), context);
  await context.drain();

  assert.equal(r2.calls.list.length, 2);
  assert.equal(r2.calls.get.length, 0);
  assert.deepEqual(snapshots, [{ p_actual_r2_bytes: 15, p_inventory_error: null }]);
});

test("V230 records unknown scheduled usage when R2 inventory fails", async () => {
  const r2 = makeR2({
    get: async () => assert.fail("unknown inventory must not call R2 get"),
    list: async () => { throw new Error("r2 unavailable"); }
  });
  const snapshots = [];
  const supabase = makeSupabaseFetch({
    media_usage_snapshot: call => { snapshots.push(call.body); return jsonResponse({ recorded: true }); }
  });
  const worker = createMediaWorker({ fetchImpl: supabase.fetchImpl });
  const context = makeContext();
  await worker.scheduled({}, makeEnv(r2), context);
  await context.drain();

  assert.deepEqual(snapshots, [{ p_actual_r2_bytes: null, p_inventory_error: "inventory_unavailable" }]);
  assert.equal(r2.calls.get.length, 0);
});
