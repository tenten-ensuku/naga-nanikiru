import assert from "node:assert/strict";
import test from "node:test";
import { mediaRead } from "../cloudflare/media-read.mjs";
import { ApiError } from "../cloudflare/access.mjs";
import { testD1 } from "./helpers/cloudflare-d1.mjs";

const ORIGIN = "https://minkiru.test";
const NOW = 1_800_000_000;
const OWNER = "media-owner";
const MEMBER = "media-member";
const OUTSIDER = "media-outsider";
const COLLECTION = "media-private-collection";
const PUBLIC_KEY = `${"comment-assets"}/${OWNER}/comments/hello world.png`;
const PENDING_KEY = `${"reaction-assets"}/${OWNER}/reactions/pending.png`;
const PRIVATE_KEY = `${"question-assets"}/${OWNER}/questions/${COLLECTION}/private.png`;
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

function request(path, method = "GET") {
  return new Request(`${ORIGIN}${path}`, { method });
}

function imageObject(bytes = PNG, contentType = "image/png") {
  return {
    body: bytes,
    size: bytes.length,
    httpEtag: '"media-test-etag"',
    writeHttpMetadata(headers) {
      headers.set("Content-Type", contentType);
    },
  };
}

function fakeR2(objects = new Map()) {
  const calls = { get: [], head: [], put: [], delete: [], list: [] };
  return {
    calls,
    async get(key, options) {
      calls.get.push([key, options]);
      return objects.get(key) ?? null;
    },
    async head(key) {
      calls.head.push([key]);
      const object = objects.get(key);
      return object ? { ...object, body: undefined } : null;
    },
    async put() {
      calls.put.push(arguments);
      throw new Error("media read must not write R2");
    },
    async delete() {
      calls.delete.push(arguments);
      throw new Error("media read must not delete R2");
    },
    async list() {
      calls.list.push(arguments);
      throw new Error("media read must not list R2");
    },
  };
}

async function exec(db, sql, ...params) {
  return db.prepare(sql).bind(...params).run();
}

async function fixture() {
  const db = testD1();
  await exec(db, "INSERT INTO profiles(id) VALUES (?), (?), (?)", OWNER, MEMBER, OUTSIDER);
  await exec(
    db,
    "INSERT INTO collections(id,owner_id,title,visibility,share_slug) VALUES (?,?,?,?,?)",
    COLLECTION,
    OWNER,
    "Private media fixture",
    "private",
    "private-media-fixture",
  );
  await exec(db, "INSERT INTO collection_members(collection_id,user_id,role,status) VALUES (?,?,?,?)", COLLECTION, MEMBER, "viewer", "active");
  await exec(
    db,
    `INSERT INTO media_assets(object_key,bucket,path,owner_id,collection_id,size_bytes,sha256,content_type,state)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    PUBLIC_KEY,
    "comment-assets",
    `${OWNER}/comments/hello world.png`,
    OWNER,
    null,
    PNG.length,
    "a".repeat(64),
    "image/png",
    "ready",
  );
  await exec(
    db,
    `INSERT INTO media_assets(object_key,bucket,path,owner_id,collection_id,size_bytes,sha256,content_type,state)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    PENDING_KEY,
    "reaction-assets",
    `${OWNER}/reactions/pending.png`,
    OWNER,
    null,
    PNG.length,
    "b".repeat(64),
    "image/png",
    "pending",
  );
  await exec(
    db,
    `INSERT INTO media_assets(object_key,bucket,path,owner_id,collection_id,size_bytes,sha256,content_type,state)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    PRIVATE_KEY,
    "question-assets",
    `${OWNER}/questions/${COLLECTION}/private.png`,
    OWNER,
    COLLECTION,
    PNG.length,
    "c".repeat(64),
    "image/png",
    "ready",
  );
  return db;
}

function env(db, r2) {
  return { DB: db, IMAGES: r2, MEDIA_NOW: NOW };
}

async function rejected(promise, status) {
  await assert.rejects(promise, (error) => error instanceof ApiError && error.status === status);
}

test("unknown routes remain for the main Worker and writes never reach this sidecar", async () => {
  const db = await fixture();
  try {
    const r2 = fakeR2();
    const target = env(db, r2);
    assert.equal(await mediaRead(request("/v1/assets", "POST"), target, { actor: { id: OWNER }, body: {} }), null);
    assert.equal(await mediaRead(request("/other"), target, { actor: { id: OWNER } }), null);
    assert.deepEqual(r2.calls, { get: [], head: [], put: [], delete: [], list: [] });
  } finally {
    db.close();
  }
});

test("public resolution requires an actor, returns only ready ledger keys, and matches the client contract", async () => {
  const db = await fixture();
  try {
    const r2 = fakeR2(new Map([[PUBLIC_KEY, imageObject()]]));
    const target = env(db, r2);
    await rejected(mediaRead(request("/v1/resolve-public", "POST"), target, { body: { keys: [PUBLIC_KEY] } }), 401);
    const response = await mediaRead(request("/v1/resolve-public", "POST"), target, {
      actor: { id: MEMBER },
      body: { keys: [PUBLIC_KEY, PENDING_KEY] },
    });
    assert.deepEqual(await response.json(), { keys: [PUBLIC_KEY] });

    const publicResponse = await mediaRead(
      request("/v1/public/comment-assets/media-owner/comments/hello%20world.png"),
      target,
      { actor: null },
    );
    assert.equal(publicResponse.status, 200);
    assert.deepEqual(new Uint8Array(await publicResponse.arrayBuffer()), PNG);
    assert.equal(publicResponse.headers.get("content-type"), "image/png");
    assert.equal(publicResponse.headers.get("etag"), '"media-test-etag"');
    assert.equal(publicResponse.headers.get("cache-control"), "public, max-age=86400");
  } finally {
    db.close();
  }
});

test("public HEAD uses R2 metadata, while pending and missing ledger rows are 404", async () => {
  const db = await fixture();
  try {
    const r2 = fakeR2(new Map([[PUBLIC_KEY, imageObject()]]));
    const target = env(db, r2);
    const head = await mediaRead(request("/v1/public/comment-assets/media-owner/comments/hello%20world.png", "HEAD"), target);
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.deepEqual(r2.calls.get, []);
    assert.deepEqual(r2.calls.head, [[PUBLIC_KEY]]);

    await rejected(
      mediaRead(request("/v1/public/reaction-assets/media-owner/reactions/pending.png"), target),
      404,
    );
    await rejected(
      mediaRead(request("/v1/public/comment-assets/media-owner/comments/missing.png"), target),
      404,
    );
    assert.equal(r2.calls.get.length, 0);
  } finally {
    db.close();
  }
});

test("private resolution returns same-origin cookie-bound URLs and checks ACL again on GET/HEAD", async () => {
  const db = await fixture();
  try {
    const r2 = fakeR2(new Map([[PRIVATE_KEY, imageObject()]]));
    const target = env(db, r2);
    const resolved = await mediaRead(request("/v1/resolve", "POST"), target, {
      actor: { id: OWNER },
      body: { keys: [PRIVATE_KEY] },
    });
    const body = await resolved.json();
    const signedUrl = body.urls[PRIVATE_KEY];
    assert.equal(
      signedUrl,
      `${ORIGIN}/v1/private/question-assets/media-owner/questions/${COLLECTION}/private.png?expires=${NOW + 900}&signature=cookie`,
    );

    const ownerResponse = await mediaRead(new Request(signedUrl), target, { actor: { id: OWNER } });
    assert.equal(ownerResponse.status, 200);
    assert.equal(ownerResponse.headers.get("cache-control"), "no-store");
    assert.deepEqual(new Uint8Array(await ownerResponse.arrayBuffer()), PNG);

    const memberHead = await mediaRead(new Request(signedUrl, { method: "HEAD" }), target, { actor: { id: MEMBER } });
    assert.equal(memberHead.status, 200);
    assert.equal(memberHead.headers.get("cache-control"), "no-store");

    await rejected(mediaRead(new Request(signedUrl), target, { actor: null }), 401);
    await rejected(mediaRead(new Request(signedUrl), target, { actor: { id: OUTSIDER } }), 403);
    await rejected(
      mediaRead(new Request(signedUrl.replace("signature=cookie", "signature=forged")), target, { actor: { id: OWNER } }),
      403,
    );
    await rejected(
      mediaRead(request(`/v1/private/question-assets/${OWNER}/questions/${COLLECTION}/private.png`), target, { actor: { id: OWNER } }),
      403,
    );
    assert.equal(r2.calls.put.length, 0);
    assert.equal(r2.calls.delete.length, 0);
    assert.equal(r2.calls.list.length, 0);
  } finally {
    db.close();
  }
});

test("private resolution is all-or-nothing and encoded traversal is rejected before R2", async () => {
  const db = await fixture();
  try {
    const r2 = fakeR2(new Map([[PRIVATE_KEY, imageObject()]]));
    const target = env(db, r2);
    await rejected(
      mediaRead(request("/v1/resolve", "POST"), target, {
        actor: { id: OWNER },
        body: { keys: [PRIVATE_KEY, `${"question-assets"}/${OUTSIDER}/questions/foreign.png`] },
      }),
      403,
    );
    await rejected(
      mediaRead(request("/v1/public/comment-assets/media-owner/comments/%2e%2e%2fsecret.png"), target),
      404,
    );
    await rejected(
      mediaRead(request(`/v1/private/question-assets/${OWNER}/questions/${COLLECTION}/%2e%2e%2fsecret.png?expires=${NOW + 900}&signature=cookie`), target, {
        actor: { id: OWNER },
      }),
      404,
    );
    assert.equal(r2.calls.get.length, 0);
    assert.equal(r2.calls.head.length, 0);
  } finally {
    db.close();
  }
});
