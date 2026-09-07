import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalPrivateAssetUrl,
  createMediaClient,
  encodeAssetPath,
  normalizeAssetPath,
  parseDataImageUrl,
  sha256Hex,
} from "../client/media-assets.mjs";

const SUPABASE_URL = "https://naga-project.supabase.co";
const MEDIA_URL = "https://media.example.test";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "33333333-3333-4333-8333-333333333333";
const QUESTION_ID = "22222222-2222-4222-8222-222222222222";
const PNG_DATA_URL = "data:image/png;base64,SGVsbG8=";
const HELLO_SHA256 = "185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969";

function userSession(id = USER_ID, accessToken = "jwt") {
  return { user: { id }, access_token: accessToken };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 400,
    status,
    async json() {
      return body;
    },
  };
}

function makeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return handler({ url, options, calls });
  };
  return { calls, fetchImpl };
}

function header(options, name) {
  if (options.headers instanceof Headers) return options.headers.get(name);
  return options.headers[name] ?? options.headers[name.toLowerCase()];
}

test("V230 public bucket allowlists require object preparation before any origin change", async () => {
  const requestStarted = deferred();
  const workerResponse = deferred();
  const path = `${USER_ID}/comments/hello world.png`;
  const legacy = `${SUPABASE_URL}/storage/v1/object/public/comment-assets/${USER_ID}/comments/hello%20world.png`;
  const { calls, fetchImpl } = makeFetch(({ url, options }) => {
    assert.equal(url, `${MEDIA_URL}/v1/resolve-public`);
    assert.equal(options.method, "POST");
    assert.equal(header(options, "Authorization"), "Bearer jwt");
    assert.equal(header(options, "Content-Type"), "application/json");
    assert.equal(options.redirect, "error");
    assert.deepEqual(JSON.parse(options.body), { keys: [`comment-assets/${path}`] });
    requestStarted.resolve();
    return workerResponse.promise;
  });
  const client = createMediaClient({
    config: {
      supabaseUrl: SUPABASE_URL,
      mediaApiUrl: `${MEDIA_URL}/`,
      mediaReadyBuckets: ["comment-assets"],
    },
    getSession: () => userSession(),
    fetchImpl,
  });

  assert.equal(client.resolvePublicUrl("comment-assets", path), legacy);
  assert.deepEqual(client.rewritePublicPayload({ image: legacy }), { image: legacy });
  assert.equal(calls.length, 0);
  const preparing = client.preparePublicPaths("comment-assets", [path, path]);
  await requestStarted.promise;
  assert.equal(client.resolvePublicUrl("comment-assets", path), legacy);
  workerResponse.resolve(jsonResponse({ keys: [`comment-assets/${path}`] }));
  assert.deepEqual(await preparing, [`comment-assets/${path}`]);
  assert.equal(
    client.resolvePublicUrl("comment-assets", path),
    `${MEDIA_URL}/v1/public/comment-assets/${USER_ID}/comments/hello%20world.png`,
  );
  assert.equal(calls.length, 1);
  assert.equal(
    client.resolvePublicUrl("reaction-assets", `${USER_ID}/reactions/heart.png`),
    `${SUPABASE_URL}/storage/v1/object/public/reaction-assets/${USER_ID}/reactions/heart.png`,
  );
  assert.equal(
    client.resolvePublicUrl("naga-question-assets", `${USER_ID}/questions/legacy.png`),
    `${SUPABASE_URL}/storage/v1/object/public/naga-question-assets/${USER_ID}/questions/legacy.png`,
  );
  const configuredNagaClient = createMediaClient({
    config: {
      supabaseUrl: SUPABASE_URL,
      mediaApiUrl: MEDIA_URL,
      mediaReadyBuckets: ["naga-question-assets"],
    },
    getSession: () => userSession(),
    fetchImpl: async (_url, options) => jsonResponse({ keys: JSON.parse(options.body).keys }),
  });
  assert.equal(
    configuredNagaClient.resolvePublicUrl("naga-question-assets", `${USER_ID}/questions/legacy.png`),
    `${SUPABASE_URL}/storage/v1/object/public/naga-question-assets/${USER_ID}/questions/legacy.png`,
  );
  await configuredNagaClient.preparePublicPaths("naga-question-assets", [`${USER_ID}/questions/legacy.png`]);
  assert.equal(
    configuredNagaClient.resolvePublicUrl("naga-question-assets", `${USER_ID}/questions/legacy.png`),
    `${MEDIA_URL}/v1/public/naga-question-assets/${USER_ID}/questions/legacy.png`,
  );
  assert.equal(client.resolvePublicUrl("comment-assets", "../private/secret.png"), "");
  assert.equal(client.resolvePublicUrl("comment-assets", "%2e%2e/secret.png"), "");
  assert.equal(client.resolvePublicUrl("comment-assets", "https://foreign.example/x.png"), "");
  assert.equal(client.resolvePublicUrl("comment-assets", "image.png?download=1"), "");
  assert.equal(client.resolvePublicUrl("comment-assets", "folder//image.png"), "");
  assert.equal(normalizeAssetPath(`${USER_ID}/reactions/heart.png`), `${USER_ID}/reactions/heart.png`);
  assert.equal(encodeAssetPath(`${USER_ID}/reactions/hello world.png`), `${USER_ID}/reactions/hello%20world.png`);
});

test("V230 accepts only an HTTPS media origin and never resolves a path as an arbitrary URL", async () => {
  const client = createMediaClient({
    config: {
      supabaseUrl: SUPABASE_URL,
      mediaApiUrl: "http://media.example.test/worker",
      mediaReadyBuckets: ["comment-assets"],
    },
    getSession: async () => ({ access_token: "jwt" }),
    fetchImpl: async () => {
      throw new Error("an invalid media origin must not reach fetch");
    },
  });

  assert.equal(client.resolvePublicUrl("comment-assets", `${USER_ID}/comments/a.png`), `${SUPABASE_URL}/storage/v1/object/public/comment-assets/${USER_ID}/comments/a.png`);
  await assert.rejects(
    client.uploadImage(new Blob(["x"], { type: "image/png" }), { bucket: "comment-assets" }),
    /mediaApiUrl/i,
  );
});

test("V230 uploads binary images with the JWT, collection metadata, and actual SHA-256", async () => {
  const { calls, fetchImpl } = makeFetch(({ url, options }) => {
    assert.equal(url, `${MEDIA_URL}/v1/assets`);
    assert.equal(options.method, "POST");
    assert.equal(header(options, "Authorization"), "Bearer jwt-v230");
    assert.equal(header(options, "Content-Type"), "image/png");
    assert.equal(header(options, "X-Asset-Bucket"), "comment-assets");
    assert.equal(header(options, "X-Collection-Slug"), "lesson-book");
    assert.equal(header(options, "X-Collection-Id"), QUESTION_ID);
    assert.equal(header(options, "X-Asset-SHA256"), "185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969");
    assert.deepEqual([...options.body], [...new TextEncoder().encode("Hello")]);
    return jsonResponse({
      bucket: "comment-assets",
      path: `${USER_ID}/comments/hello.png`,
      src: `${MEDIA_URL}/v1/public/comment-assets/${USER_ID}/comments/hello.png`,
      size: 5,
      sha256: HELLO_SHA256,
    });
  });
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: ["comment-assets"] },
    getSession: () => userSession(USER_ID, "jwt-v230"),
    fetchImpl,
  });

  const result = await client.uploadImage(new Blob(["Hello"], { type: "image/png" }), {
    bucket: "comment-assets",
    shareSlug: "lesson-book",
    collectionId: QUESTION_ID,
  });

  assert.deepEqual(result, {
    bucket: "comment-assets",
    path: `${USER_ID}/comments/hello.png`,
    src: `${MEDIA_URL}/v1/public/comment-assets/${USER_ID}/comments/hello.png`,
    size: 5,
    sha256: "185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969",
  });
  assert.equal(calls.length, 1);
  assert.equal(client.resolvePublicUrl(result.bucket, result.path), result.src);
  assert.equal(
    client.resolvePublicUrl(result.bucket, `${USER_ID}/comments/future.png`),
    `${SUPABASE_URL}/storage/v1/object/public/comment-assets/${USER_ID}/comments/future.png`,
  );
});

test("V230 enforces bucket-specific image limits and never falls back when the media API fails", async () => {
  let calls = 0;
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: ["reaction-assets"] },
    getSession: () => userSession(),
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ error: "unavailable" }, 503);
    },
  });

  await assert.rejects(
    client.uploadImage(new Blob(["x"], { type: "image/gif" }), { bucket: "question-assets" }),
    /question-assets.*GIF/i,
  );
  await assert.rejects(
    client.uploadImage(new Blob([new Uint8Array(1024 * 1024 + 1)], { type: "image/png" }), { bucket: "reaction-assets" }),
    /1MiB/i,
  );
  await assert.rejects(
    client.uploadImage(new Blob(["x"], { type: "image/png" }), { bucket: "comment-assets" }),
    /HTTP 503/i,
  );
  await assert.rejects(
    client.uploadImage(new Blob(["x"], { type: "image/png" }), { bucket: "naga-question-assets" }),
    /comment-assets.*reaction-assets.*question-assets/i,
  );
  assert.equal(calls, 1);
});

test("V230 deletes through the worker and propagates failures", async () => {
  const { calls, fetchImpl } = makeFetch(({ options }) => {
    assert.equal(options.method, "DELETE");
    assert.equal(header(options, "Authorization"), "Bearer jwt");
    assert.equal(header(options, "Content-Type"), "application/json");
    assert.deepEqual(JSON.parse(options.body), {
      bucket: "comment-assets",
      path: `${USER_ID}/comments/old.png`,
    });
    return jsonResponse({}, 204);
  });
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: [] },
    getSession: async () => ({ access_token: "jwt" }),
    fetchImpl,
  });
  await client.removeImage("comment-assets", `${USER_ID}/comments/old.png`);
  assert.equal(calls.length, 1);

  const failingClient = createMediaClient({
    config: { mediaApiUrl: MEDIA_URL },
    getSession: async () => ({ access_token: "jwt" }),
    fetchImpl: async () => jsonResponse({ error: "denied" }, 403),
  });
  await assert.rejects(failingClient.removeImage("comment-assets", `${USER_ID}/comments/old.png`), /HTTP 403/i);
});

test("V230 externalizes duplicate data URLs once, keeps labels, and does not mutate payloads", async () => {
  const { calls, fetchImpl } = makeFetch(({ options }) => {
    assert.equal(options.method, "POST");
    assert.equal(header(options, "Authorization"), "Bearer jwt");
    assert.equal(header(options, "X-Asset-Bucket"), "question-assets");
    assert.equal(header(options, "X-Collection-Slug"), "lesson-book");
    assert.equal(header(options, "X-Collection-Id"), QUESTION_ID);
    assert.equal(header(options, "Content-Type"), "image/png");
    return jsonResponse({
      bucket: "question-assets",
      path: `${USER_ID}/questions/one.png`,
      src: canonicalPrivateAssetUrl(MEDIA_URL, `${USER_ID}/questions/one.png`),
      size: 5,
      sha256: HELLO_SHA256,
    });
  });
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: [] },
    getSession: async () => ({ access_token: "jwt" }),
    fetchImpl,
  });
  const payload = {
    label: "この説明ラベルは保持",
    answer: { image: PNG_DATA_URL, label: "内側ラベル" },
    choices: [PNG_DATA_URL, { image: PNG_DATA_URL }],
    external: "https://foreign.example/image.png",
  };
  const original = structuredClone(payload);

  const result = await client.externalizePayload(payload, {
    shareSlug: "lesson-book",
    collectionId: QUESTION_ID,
  });
  const stable = canonicalPrivateAssetUrl(MEDIA_URL, `${USER_ID}/questions/one.png`);

  assert.equal(calls.length, 1);
  assert.deepEqual(result, {
    label: "この説明ラベルは保持",
    answer: { image: stable, label: "内側ラベル" },
    choices: [stable, { image: stable }],
    external: "https://foreign.example/image.png",
  });
  assert.deepEqual(payload, original);
});

test("V230 rejects blob persistence and invalid UUID metadata before making a request", async () => {
  let calls = 0;
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL },
    getSession: async () => ({ access_token: "jwt" }),
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    },
  });

  await assert.rejects(client.externalizePayload({ image: "blob:https://app.example/id" }), /blob.*永続化/i);
  await assert.rejects(
    client.uploadImage(new Blob(["x"], { type: "image/png" }), { bucket: "question-assets", collectionId: "not-a-uuid" }),
    /UUID/i,
  );
  assert.equal(calls, 0);
});

test("V230 rewrites only individually verified own Supabase public URLs", async () => {
  const { calls, fetchImpl } = makeFetch(({ url, options }) => {
    assert.equal(url, `${MEDIA_URL}/v1/resolve-public`);
    return jsonResponse({ keys: JSON.parse(options.body).keys });
  });
  const client = createMediaClient({
    config: {
      supabaseUrl: SUPABASE_URL,
      mediaApiUrl: MEDIA_URL,
      mediaReadyBuckets: ["reaction-assets"],
    },
    getSession: () => userSession(),
    fetchImpl,
  });
  const own = `${SUPABASE_URL}/storage/v1/object/public/reaction-assets/${USER_ID}/reactions/heart.png`;
  const query = `${own}?download=1`;
  const foreign = "https://other.supabase.co/storage/v1/object/public/reaction-assets/path.png";
  const privateUrl = `${MEDIA_URL}/v1/private/question-assets/${USER_ID}/questions/one.png`;
  const unmigrated = `${SUPABASE_URL}/storage/v1/object/public/comment-assets/${USER_ID}/comments/a.png`;
  const nagaLegacy = `${SUPABASE_URL}/storage/v1/object/public/naga-question-assets/${USER_ID}/questions/legacy.png`;
  const payload = { label: "保持", own, query, foreign, privateUrl, unmigrated };

  assert.deepEqual(client.rewritePublicPayload(payload), payload);
  assert.equal(calls.length, 0);
  await client.preparePublicPaths("reaction-assets", [`${USER_ID}/reactions/heart.png`]);
  const result = client.rewritePublicPayload(payload);
  assert.deepEqual(result, {
    label: "保持",
    own: `${MEDIA_URL}/v1/public/reaction-assets/${USER_ID}/reactions/heart.png`,
    query,
    foreign,
    privateUrl,
    unmigrated,
  });
  assert.equal(payload.own, own);
  assert.equal(calls.length, 1);

  const configuredNagaClient = createMediaClient({
    config: {
      supabaseUrl: SUPABASE_URL,
      mediaApiUrl: MEDIA_URL,
      mediaReadyBuckets: ["naga-question-assets"],
    },
    getSession: () => userSession(),
    fetchImpl,
  });
  assert.equal(configuredNagaClient.rewritePublicPayload({ image: nagaLegacy }).image, nagaLegacy);
  await configuredNagaClient.preparePublicPaths("naga-question-assets", [`${USER_ID}/questions/legacy.png`]);
  assert.equal(
    configuredNagaClient.rewritePublicPayload({ label: "問題", image: nagaLegacy }).image,
    `${MEDIA_URL}/v1/public/naga-question-assets/${USER_ID}/questions/legacy.png`,
  );
  assert.equal(client.rewritePublicPayload({ image: nagaLegacy }).image, nagaLegacy);
});

test("V230 resolves unique private keys with JWT and only accepts matching signed media URLs", async () => {
  const firstPath = `${USER_ID}/questions/one.png`;
  const secondPath = `${USER_ID}/questions/two.webp`;
  const firstCanonical = canonicalPrivateAssetUrl(MEDIA_URL, firstPath);
  const secondCanonical = canonicalPrivateAssetUrl(MEDIA_URL, secondPath);
  const firstSigned = `${MEDIA_URL}/v1/private/question-assets/${USER_ID}/questions/one.png?expires=1700000000&signature=first`;
  const secondSigned = `${MEDIA_URL}/v1/private/question-assets/${USER_ID}/questions/two.webp?expires=1700000001&signature=second`;
  const wrongHost = "https://foreign.example/v1/private/question-assets/11111111-1111-4111-8111-111111111111/questions/one.png?expires=1&signature=x";
  const { calls, fetchImpl } = makeFetch(({ options }) => {
    assert.equal(options.method, "POST");
    assert.equal(header(options, "Authorization"), "Bearer jwt");
    assert.equal(header(options, "Content-Type"), "application/json");
    assert.deepEqual(JSON.parse(options.body), {
      keys: [`question-assets/${firstPath}`, `question-assets/${secondPath}`],
    });
    return jsonResponse({
      urls: {
        [`question-assets/${firstPath}`]: firstSigned,
        [`question-assets/${secondPath}`]: secondSigned,
        "question-assets/other.png": wrongHost,
      },
    });
  });
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL },
    getSession: async () => ({ access_token: "jwt" }),
    fetchImpl,
  });
  const payload = {
    label: "保持",
    first: firstCanonical,
    duplicate: firstCanonical,
    nested: [secondCanonical, "https://foreign.example/asset.png"],
    query: `${firstCanonical}?download=1`,
    privateForeign: wrongHost,
  };

  const result = await client.resolvePrivatePayload(payload);
  assert.deepEqual(result, {
    label: "保持",
    first: firstSigned,
    duplicate: firstSigned,
    nested: [secondSigned, "https://foreign.example/asset.png"],
    query: `${firstCanonical}?download=1`,
    privateForeign: wrongHost,
  });
  assert.equal(calls.length, 1);
  assert.equal(payload.first, firstCanonical);
});

test("V230 normalizes a signed private URL back to its stable canonical value before persistence", async () => {
  const canonical = canonicalPrivateAssetUrl(MEDIA_URL, `${USER_ID}/questions/one.png`);
  const signed = `${canonical}?expires=1700000000&signature=abc123`;
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL },
    getSession: async () => {
      throw new Error("no session is needed when no upload or resolve request is required");
    },
    fetchImpl: async () => {
      throw new Error("normalization must not fetch");
    },
  });
  const payload = { label: "署名 URL", image: signed };
  const result = await client.externalizePayload(payload);
  assert.deepEqual(result, { label: "署名 URL", image: canonical });
  assert.deepEqual(payload, { label: "署名 URL", image: signed });
});

test("V230 refreshes expired signed private URLs and resolves private keys in batches of 32", async () => {
  const paths = Array.from({ length: 33 }, (_, index) => `${USER_ID}/questions/batch-${index}.png`);
  const canonicalValues = paths.map((path) => canonicalPrivateAssetUrl(MEDIA_URL, path));
  const expiredFirst = `${canonicalValues[0]}?expires=1&signature=expired`;
  let sessionCalls = 0;
  const { calls, fetchImpl } = makeFetch(({ options }) => {
    const body = JSON.parse(options.body);
    assert.ok(body.keys.length <= 32);
    assert.ok(body.keys.every((key) => key.startsWith("question-assets/")));
    const urls = Object.fromEntries(
      body.keys.map((key) => [
        key,
        `${MEDIA_URL}/v1/private/${key}?expires=2700000000&signature=fresh-${body.keys.indexOf(key)}`,
      ]),
    );
    return jsonResponse({ urls });
  });
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL },
    getSession: async () => {
      sessionCalls += 1;
      return { access_token: "jwt" };
    },
    fetchImpl,
  });

  const result = await client.resolvePrivatePayload({ label: "保持", images: [expiredFirst, ...canonicalValues.slice(1)] });
  assert.equal(sessionCalls, 1);
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[0].options.body).keys.length, 32);
  assert.equal(JSON.parse(calls[1].options.body).keys.length, 1);
  assert.match(result.images[0], /expires=2700000000&signature=fresh-/);
  assert.match(result.images[32], /expires=2700000000&signature=fresh-/);
  assert.equal(result.label, "保持");
});

test("V230 requires a session before upload, delete, or private resolution requests", async () => {
  let calls = 0;
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL },
    getSession: async () => null,
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({});
    },
  });
  const canonical = canonicalPrivateAssetUrl(MEDIA_URL, `${USER_ID}/questions/one.png`);

  await assert.rejects(client.uploadImage(new Blob(["x"], { type: "image/png" }), { bucket: "question-assets" }), /ログイン/i);
  await assert.rejects(client.removeImage("question-assets", `${USER_ID}/questions/one.png`), /ログイン/i);
  await assert.rejects(client.resolvePrivatePayload({ image: canonical }), /ログイン/i);
  assert.equal(calls, 0);
});

test("V230 exposes deterministic pure hashing and data-image parsing helpers", async () => {
  const parsed = parseDataImageUrl(PNG_DATA_URL);
  assert.equal(parsed.mimeType, "image/png");
  assert.deepEqual([...parsed.bytes], [...new TextEncoder().encode("Hello")]);
  assert.equal(await sha256Hex(parsed.bytes), "185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969");
});

test("V230 keeps unverified19, unavailable15 and future legacy images on Supabase", async () => {
  const bucket = "naga-question-assets";
  const readyPath = "reports/ready-sample.png";
  const missingPaths = [
    ...Array.from({ length: 19 }, (_, index) => `reports/unverified-${index}.png`),
    ...Array.from({ length: 15 }, (_, index) => `reports/unavailable-${index}.png`),
  ];
  const legacy = (path) => `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
  const { calls, fetchImpl } = makeFetch(({ url, options }) => {
    assert.equal(url, `${MEDIA_URL}/v1/resolve-public`);
    const { keys } = JSON.parse(options.body);
    assert.ok(keys.length <= 32);
    return jsonResponse({ keys: keys.filter((key) => key === `${bucket}/${readyPath}`) });
  });
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: [bucket] },
    getSession: () => userSession(),
    fetchImpl,
  });
  const payload = {
    label: "問題画像",
    ready: legacy(readyPath),
    duplicate: { src: legacy(readyPath), alt: "サンプル" },
    images: missingPaths.map((path) => ({ src: legacy(path), label: path })),
  };
  const original = structuredClone(payload);
  const result = await client.resolvePublicPayload(payload);
  assert.equal(result.ready, `${MEDIA_URL}/v1/public/${bucket}/${readyPath}`);
  assert.equal(result.duplicate.src, result.ready);
  assert.equal(result.duplicate.alt, "サンプル");
  assert.equal(result.label, payload.label);
  assert.deepEqual(result.images, payload.images);
  assert.notEqual(result.images, payload.images);
  assert.notEqual(result.images[0], payload.images[0]);
  assert.deepEqual(payload, original);
  assert.deepEqual(calls.map(({ options }) => JSON.parse(options.body).keys.length), [32, 3]);
  for (const path of missingPaths) assert.equal(client.resolvePublicUrl(bucket, path), legacy(path));
  assert.equal(client.resolvePublicUrl(bucket, "reports/future-legacy.png"), legacy("reports/future-legacy.png"));
  assert.deepEqual(await client.preparePublicPaths(bucket, [missingPaths[0]]), []);
  assert.equal(calls.length, 3, "missing keys may be retried; a miss is not permanently cached");
});

test("V230 public preparation deduplicates 65 keys into 32/32/1 and uses the current JWT per batch", async () => {
  let currentSession = userSession(USER_ID, "jwt-1");
  const paths = Array.from({ length: 65 }, (_, index) => `comments/chunk-${index}.png`);
  const { calls, fetchImpl } = makeFetch(({ options, calls: recorded }) => {
    assert.equal(header(options, "Authorization"), `Bearer jwt-${recorded.length}`);
    const { keys } = JSON.parse(options.body);
    currentSession = userSession(USER_ID, `jwt-${recorded.length + 1}`);
    return jsonResponse({ keys });
  });
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: ["comment-assets"] },
    getSession: () => currentSession,
    fetchImpl,
  });
  assert.deepEqual(
    await client.preparePublicPaths("comment-assets", [...paths, paths[0], paths[64]]),
    paths.map((path) => `comment-assets/${path}`),
  );
  assert.deepEqual(calls.map(({ options }) => JSON.parse(options.body).keys.length), [32, 32, 1]);
  for (const path of paths) {
    assert.equal(client.resolvePublicUrl("comment-assets", path), `${MEDIA_URL}/v1/public/comment-assets/${path}`);
  }
  await client.preparePublicPaths("comment-assets", [paths[0], paths[64]]);
  assert.equal(calls.length, 3, "the same user may reuse individually verified keys after JWT refresh");
});

test("V230 resolves only exact own canonical public URLs and preserves adversarial references", async () => {
  const prefix = `${SUPABASE_URL}/storage/v1/object/public/`;
  const path = `${USER_ID}/comments/hello world.png`;
  const valid = `${prefix}comment-assets/${USER_ID}/comments/hello%20world.png`;
  const preserved = [
    `${valid}?download=1`, `${valid}?`, `${valid}#`, `${valid}#image`,
    valid.replace("naga-project.supabase.co", "naga-project.supabase.co.evil.test"),
    valid.replace("https://", "http://"), valid.replace("https://", "https://evil.test@"),
    valid.replace("supabase.co/", "supabase.co:444/"),
    valid.replace("/public/", "/private/"), valid.replace("/public/", "/sign/"),
    `${prefix}question-assets/${path}`, `${MEDIA_URL}/v1/private/question-assets/${USER_ID}/q.png`,
    `${prefix}reaction-assets/reactions/disabled.png`,
    `${prefix}comment-assets/../outside.png`, `${prefix}comment-assets/%2e%2e/outside.png`,
    `${prefix}comment-assets/x/%252e%252e/outside.png`, `${prefix}comment-assets/a%2fb.png`,
    `${prefix}comment-assets/a%252fb.png`, `${prefix}comment-assets/a\\b.png`,
    `${prefix}comment-assets/a%5cb.png`, `${prefix}comment-assets/a//b.png`,
    `${prefix}comment-assets/%61.png`, `${prefix}comment-assets/a.png%3fdownload=1`,
    `${prefix}comment-assets/a.png%23image`, `${prefix}comment-assets/a%00.png`,
    `${prefix}comment-assets/%ZZ.png`, "https://external.example/learn?chapter=1", USER_ID,
  ];
  const { calls, fetchImpl } = makeFetch(({ options }) => {
    assert.deepEqual(JSON.parse(options.body), { keys: [`comment-assets/${path}`] });
    return jsonResponse({ keys: [`comment-assets/${path}`] });
  });
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: ["comment-assets", "question-assets"] },
    getSession: () => userSession(),
    fetchImpl,
  });
  const payload = { label: "参照", items: [valid, { src: valid, alt: "画像" }, ...preserved] };
  const before = structuredClone(payload);
  const result = await client.resolvePublicPayload(payload);
  assert.equal(calls.length, 1);
  assert.equal(result.items[0], `${MEDIA_URL}/v1/public/comment-assets/${USER_ID}/comments/hello%20world.png`);
  assert.equal(result.items[1].src, result.items[0]);
  assert.deepEqual(result.items.slice(2), preserved);
  assert.deepEqual(payload, before);
});

test("V230 public verification is keyed by user id, cleared on logout/change, and never restored across users", async () => {
  let currentSession = userSession();
  const path = "comments/account.png";
  const legacy = `${SUPABASE_URL}/storage/v1/object/public/comment-assets/${path}`;
  const ready = `${MEDIA_URL}/v1/public/comment-assets/${path}`;
  const { calls, fetchImpl } = makeFetch(({ options }) => jsonResponse({
    keys: currentSession.user.id === USER_ID ? JSON.parse(options.body).keys : [],
  }));
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: ["comment-assets"] },
    getSession: () => currentSession,
    fetchImpl,
  });
  await client.preparePublicPaths("comment-assets", [path]);
  assert.equal(client.resolvePublicUrl("comment-assets", path), ready);
  currentSession = userSession(OTHER_USER_ID); // Intentionally the same JWT string; scope must be the user ID.
  assert.deepEqual(client.rewritePublicPayload({ image: legacy }), { image: legacy });
  assert.equal(client.resolvePublicUrl("comment-assets", path), legacy);
  assert.deepEqual(await client.preparePublicPaths("comment-assets", [path]), []);
  currentSession = userSession();
  assert.equal(client.resolvePublicUrl("comment-assets", path), legacy);
  await client.preparePublicPaths("comment-assets", [path]);
  assert.equal(client.resolvePublicUrl("comment-assets", path), ready);
  currentSession = null;
  assert.equal(client.resolvePublicUrl("comment-assets", path), legacy);
  currentSession = userSession();
  assert.equal(client.resolvePublicUrl("comment-assets", path), legacy);
  assert.equal(calls.length, 3);
});

test("V230 ignores delayed account-A verification after account-B has its own verified keys", async () => {
  let currentSession = userSession(USER_ID, "jwt-A");
  const firstStarted = deferred();
  const firstResponse = deferred();
  const { fetchImpl } = makeFetch(({ options }) => {
    if (header(options, "Authorization") === "Bearer jwt-A") {
      firstStarted.resolve();
      return firstResponse.promise;
    }
    return jsonResponse({ keys: JSON.parse(options.body).keys });
  });
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: ["comment-assets"] },
    getSession: () => currentSession,
    fetchImpl,
  });
  const first = client.preparePublicPaths("comment-assets", ["comments/A.png"]);
  const rejected = assert.rejects(first, /アカウント/);
  await firstStarted.promise;
  currentSession = userSession(OTHER_USER_ID, "jwt-B");
  await client.preparePublicPaths("comment-assets", ["comments/B.png"]);
  firstResponse.resolve(jsonResponse({ keys: ["comment-assets/comments/A.png"] }));
  await rejected;
  assert.equal(client.resolvePublicUrl("comment-assets", "comments/A.png"), `${SUPABASE_URL}/storage/v1/object/public/comment-assets/comments/A.png`);
  assert.equal(client.resolvePublicUrl("comment-assets", "comments/B.png"), `${MEDIA_URL}/v1/public/comment-assets/comments/B.png`);
});

test("V230 does not accept an earlier request after an observed A-to-B-to-A account change", async () => {
  let currentSession = userSession();
  const started = deferred();
  const response = deferred();
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: ["comment-assets"] },
    getSession: () => currentSession,
    fetchImpl: async () => { started.resolve(); return response.promise; },
  });
  const pending = client.preparePublicPaths("comment-assets", ["a.png"]);
  const rejected = assert.rejects(pending, /アカウント/);
  await started.promise;
  currentSession = userSession(OTHER_USER_ID);
  client.resolvePublicUrl("comment-assets", "a.png");
  currentSession = userSession();
  client.resolvePublicUrl("comment-assets", "a.png");
  response.resolve(jsonResponse({ keys: ["comment-assets/a.png"] }));
  await rejected;
  assert.equal(client.resolvePublicUrl("comment-assets", "a.png"), `${SUPABASE_URL}/storage/v1/object/public/comment-assets/a.png`);
});

test("V230 async getters use resolvePublicPayload while sync helpers never reuse an unobservable account", async () => {
  let currentSession = userSession();
  const legacy = `${SUPABASE_URL}/storage/v1/object/public/comment-assets/a.png`;
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: ["comment-assets"] },
    getSession: async () => ({ data: { session: currentSession } }),
    fetchImpl: async (_url, options) => jsonResponse({
      keys: currentSession.user.id === USER_ID ? JSON.parse(options.body).keys : [],
    }),
  });
  const resolved = await client.resolvePublicPayload({ src: legacy });
  assert.equal(resolved.src, `${MEDIA_URL}/v1/public/comment-assets/a.png`);
  assert.equal(client.resolvePublicUrl("comment-assets", "a.png"), legacy);
  assert.deepEqual(client.rewritePublicPayload({ src: legacy }), { src: legacy });
  currentSession = userSession(OTHER_USER_ID);
  assert.deepEqual(await client.resolvePublicPayload({ src: legacy }), { src: legacy });
});

test("V230 an async session read completing late cannot overwrite a newer observed user", async () => {
  const staleSession = deferred();
  let first = true;
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: ["comment-assets"] },
    getSession: () => {
      if (first) { first = false; return staleSession.promise; }
      return userSession(OTHER_USER_ID);
    },
    fetchImpl: async (_url, options) => jsonResponse({ keys: JSON.parse(options.body).keys }),
  });
  const oldOperation = client.preparePublicPaths("comment-assets", ["A.png"]);
  const rejected = assert.rejects(oldOperation, /アカウント/);
  await client.preparePublicPaths("comment-assets", ["B.png"]);
  staleSession.resolve(userSession());
  await rejected;
  assert.equal(client.resolvePublicUrl("comment-assets", "B.png"), `${MEDIA_URL}/v1/public/comment-assets/B.png`);
});

test("V230 rejects unexpected Worker keys without promoting any part of the response", async () => {
  const key = "comment-assets/comments/requested.png";
  const invalidKeys = [
    "https://foreign.example/a.png", "reaction-assets/reactions/foreign.png",
    "question-assets/private.png", "comment-assets/comments/unrequested.png",
    "comment-assets/../outside.png", "comment-assets/comments/%72equested.png",
    "comment-assets/comments/requested.png?download=1", null, { key },
  ];
  for (const invalid of invalidKeys) {
    const client = createMediaClient({
      config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: ["comment-assets", "reaction-assets"] },
      getSession: () => userSession(),
      fetchImpl: async () => jsonResponse({ keys: [key, invalid] }),
    });
    await assert.rejects(client.preparePublicPaths("comment-assets", ["comments/requested.png"]), /要求していない key/);
    assert.equal(client.resolvePublicUrl("comment-assets", "comments/requested.png"), `${SUPABASE_URL}/storage/v1/object/public/${key}`);
  }
});

test("V230 only accepts keys from the current 32-key batch, not later batches", async () => {
  const paths = Array.from({ length: 33 }, (_, index) => `comments/batch-${index}.png`);
  const { calls, fetchImpl } = makeFetch(({ options }) => jsonResponse({
    keys: [...JSON.parse(options.body).keys, `comment-assets/${paths[32]}`],
  }));
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: ["comment-assets"] },
    getSession: () => userSession(),
    fetchImpl,
  });
  await assert.rejects(client.preparePublicPaths("comment-assets", paths), /要求していない key/);
  assert.equal(calls.length, 1);
  assert.equal(client.resolvePublicUrl("comment-assets", paths[0]), `${SUPABASE_URL}/storage/v1/object/public/comment-assets/${paths[0]}`);
});

test("V230 Worker failures propagate and do not promote keys from earlier successful batches", async () => {
  const paths = Array.from({ length: 33 }, (_, index) => `comments/error-${index}.png`);
  const failures = [
    async () => jsonResponse({ error: "unavailable" }, 503),
    async () => { throw new Error("offline"); },
    async () => jsonResponse({ keys: null }),
    async () => ({ ok: true, status: 200, json: async () => { throw new Error("invalid JSON"); } }),
  ];
  for (const failure of failures) {
    const { calls, fetchImpl } = makeFetch(({ options, calls: recorded }) => recorded.length === 1
      ? jsonResponse({ keys: JSON.parse(options.body).keys })
      : failure());
    const client = createMediaClient({
      config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: ["comment-assets"] },
      getSession: () => userSession(),
      fetchImpl,
    });
    const payload = paths.map((path) => `${SUPABASE_URL}/storage/v1/object/public/comment-assets/${path}`);
    await assert.rejects(client.resolvePublicPayload(payload), /HTTP 503|offline|keys|invalid JSON/);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(({ url, options }) => url === `${MEDIA_URL}/v1/resolve-public` && options.method === "POST"));
    assert.deepEqual(client.rewritePublicPayload(payload), payload);
  }
});

test("V230 requires a session user ID before public requests and leaves disabled reads intact", async () => {
  const legacy = `${SUPABASE_URL}/storage/v1/object/public/comment-assets/a.png`;
  for (const session of [null, { access_token: "jwt" }, userSession(""), userSession(USER_ID, "")]) {
    let calls = 0;
    const client = createMediaClient({
      config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: ["comment-assets"] },
      getSession: () => session,
      fetchImpl: async () => { calls += 1; throw new Error("must not request"); },
    });
    await assert.rejects(client.preparePublicPaths("comment-assets", ["a.png"]), /ログイン/);
    await assert.rejects(client.resolvePublicPayload({ image: legacy }), /ログイン/);
    assert.equal(client.resolvePublicUrl("comment-assets", "a.png"), legacy);
    assert.equal(calls, 0);
  }
  const noNetwork = async () => { throw new Error("unconfigured reads must not authenticate or fetch"); };
  for (const config of [
    { supabaseUrl: SUPABASE_URL },
    { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: [] },
  ]) {
    const client = createMediaClient({ config, getSession: noNetwork, fetchImpl: noNetwork });
    assert.deepEqual(await client.preparePublicPaths("comment-assets", ["a.png"]), []);
    const input = { nested: [legacy], label: "保持" };
    const copy = await client.resolvePublicPayload(input);
    assert.deepEqual(copy, input);
    assert.notEqual(copy.nested, input.nested);
  }
});

test("V230 rejects traversal, encoded slashes, foreign URLs and UUID-as-path-array before public requests", async () => {
  let calls = 0;
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: ["comment-assets"] },
    getSession: () => userSession(),
    fetchImpl: async () => { calls += 1; throw new Error("must not request"); },
  });
  const invalidPaths = ["", "../a.png", "a/../b.png", "%2e%2e/b.png", "a%2fb.png", "a%252fb.png", "/a.png", "a\\b.png", "a//b.png", "a.png?x=1", "a.png#x", "https://foreign.test/a.png", null];
  for (const path of invalidPaths) {
    await assert.rejects(client.preparePublicPaths("comment-assets", ["valid.png", path]), /path/);
  }
  await assert.rejects(client.preparePublicPaths("comment-assets", USER_ID), /paths/);
  await assert.rejects(client.preparePublicPaths("comment-assets/../question-assets", ["a.png"]), /bucket/);
  assert.equal(calls, 0);
});

test("V230 an account change while decoding the Worker body cannot promote public keys", async () => {
  let currentSession = userSession();
  const decoding = deferred();
  const decoded = deferred();
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: ["comment-assets"] },
    getSession: () => currentSession,
    fetchImpl: async () => ({ ok: true, status: 200, json: () => { decoding.resolve(); return decoded.promise; } }),
  });
  const pending = client.preparePublicPaths("comment-assets", ["a.png"]);
  const rejected = assert.rejects(pending, /アカウント/);
  await decoding.promise;
  currentSession = userSession(OTHER_USER_ID);
  decoded.resolve({ keys: ["comment-assets/a.png"] });
  await rejected;
  assert.equal(client.resolvePublicUrl("comment-assets", "a.png"), `${SUPABASE_URL}/storage/v1/object/public/comment-assets/a.png`);
});

test("V230 a public upload completed after switching accounts cannot verify keys for the new user", async () => {
  let currentSession = userSession();
  const started = deferred();
  const response = deferred();
  const client = createMediaClient({
    config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: ["comment-assets"] },
    getSession: () => currentSession,
    fetchImpl: async () => { started.resolve(); return response.promise; },
  });
  const pending = client.uploadImage(new Blob(["Hello"], { type: "image/png" }), { bucket: "comment-assets" });
  const rejected = assert.rejects(pending, /アカウント/);
  await started.promise;
  currentSession = userSession(OTHER_USER_ID);
  response.resolve(jsonResponse({ bucket: "comment-assets", path: "comments/upload.png", size: 5, sha256: HELLO_SHA256 }));
  await rejected;
  assert.equal(client.resolvePublicUrl("comment-assets", "comments/upload.png"), `${SUPABASE_URL}/storage/v1/object/public/comment-assets/comments/upload.png`);
});

test("V230 upload response size and SHA-256 are required and must match before verification", async () => {
  const invalidMetadata = [
    {}, { size: 5 }, { sha256: HELLO_SHA256 },
    { size: "5", sha256: HELLO_SHA256 }, { size: 4, sha256: HELLO_SHA256 },
    { size: null, sha256: HELLO_SHA256 }, { size: 5, sha256: null },
    { size: 5, sha256: "0".repeat(64) }, { size: 5, sha256: HELLO_SHA256.toUpperCase() },
  ];
  for (const bucket of ["comment-assets", "question-assets"]) {
    for (const metadata of invalidMetadata) {
      const path = `${USER_ID}/uploads/integrity.png`;
      const legacy = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
      const { calls, fetchImpl } = makeFetch(() => jsonResponse({ asset: { bucket, path, ...metadata } }));
      const client = createMediaClient({
        config: { supabaseUrl: SUPABASE_URL, mediaApiUrl: MEDIA_URL, mediaReadyBuckets: ["comment-assets"] },
        getSession: () => userSession(),
        fetchImpl,
      });
      await assert.rejects(client.uploadImage(new Blob(["Hello"], { type: "image/png" }), { bucket }), /size|sha256/);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, `${MEDIA_URL}/v1/assets`);
      assert.equal(client.resolvePublicUrl(bucket, path), legacy);
      assert.deepEqual(client.rewritePublicPayload({ src: legacy }), { src: legacy });
    }
  }
});
