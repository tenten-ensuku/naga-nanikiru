import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  BACKUP_FILE, OUTPUT_DIRECTORY, MEDIA_ORIGIN, MAX_IMAGE_BYTES,
  detectImageFormat, decodeEmbeddedImage, buildEmbeddedMediaPlan,
  buildEmbeddedOutputFiles, writeEmbeddedOutputFiles, main,
} from "../scripts/prepare-embedded-media.mjs";

// Complete, locally decoded 1x1 images. No files, network or database fixtures.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4z8AAAAMBAQD3A0FDAAAAAElFTkSuQmCC", "base64");
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCLAGVxf//Z", "base64");
const WEBP = Buffer.from("UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=", "base64");
const OWNER = "11111111-1111-4111-8111-111111111111";
const CID = "22222222-2222-4222-8222-222222222222";
const ID = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest("hex");
const dataUrl = (bytes = WEBP, mime = "image/webp") => `data:${mime};base64,${bytes.toString("base64")}`;
function row(payload = { image: dataUrl() }, overrides = {}) {
  const payload_text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return { id: ID, collection_id: CID, created_by: OWNER, collection_owner_id: OWNER,
    updated_at: "2026-09-06T12:00:00Z", payload_text, payload_bytes: Buffer.byteLength(payload_text),
    payload_md5: hash("md5", payload_text), ...overrides };
}
const planFor = (...questions) => buildEmbeddedMediaPlan({ questions });
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function paddedWebp(size = 0xa1c2 + 8) {
  const bytes = Buffer.alloc(size);
  WEBP.copy(bytes);
  bytes.writeUInt32LE(size - 8, 4);
  bytes.write("JUNK", WEBP.length, "ascii");
  bytes.writeUInt32LE(size - WEBP.length - 8, WEBP.length + 4);
  return bytes;
}

test("actual PNG/JPEG/WebP bytes determine canonical type, key and both hashes", () => {
  for (const [bytes, contentType, extension] of [[PNG, "image/png", "png"], [JPEG, "image/jpeg", "jpg"], [WEBP, "image/webp", "webp"]]) {
    const source = row({ image: dataUrl(bytes) }); // All declared WebP, deliberately.
    const plan = planFor(source), asset = plan.assets[0];
    assert.equal(asset.contentType, contentType);
    assert.equal(asset.extension, extension);
    assert.equal(asset.sha256, hash("sha256", bytes));
    assert.equal(asset.md5, hash("md5", bytes));
    assert.deepEqual(asset.bytes, bytes);
    assert.equal(asset.key, `question-assets/${OWNER}/questions/${CID}/${asset.sha256}.${extension}`);
    assert.equal(asset.url, `${MEDIA_ORIGIN}/v1/private/${asset.key}`);
    assert.equal(plan.questions[0].sourcePayloadMd5, source.payload_md5);
    assert.deepEqual(plan.questions[0].changes[0].path, ["image"]);
    assert.equal(plan.questions[0].changes[0].beforeDataUrlSha256, hash("sha256", dataUrl(bytes)));
    assert.equal(plan.questions[0].changes[0].afterUrl, asset.url);
  }
});

test("missing created_by and invalid owner, creator, collection or question UUIDs are refused", () => {
  for (const overrides of [{ collection_owner_id: null }, { created_by: null }, { created_by: undefined },
    { collection_owner_id: "../owner" }, { created_by: "invalid" }, { collection_id: "invalid" }, { id: "invalid" }]) {
    assert.throws(() => planFor(row(undefined, overrides)), /Owner|UUID/);
  }
  assert.throws(() => planFor(row(), row()), /Duplicate question/);
});

test("existing collaborator-created questions use created_by as image owner, independently of collection owner", () => {
  const plan = planFor(row(undefined, { created_by: OTHER, collection_owner_id: OWNER }));
  assert.equal(plan.assets[0].ownerId, OTHER);
  assert.match(plan.assets[0].key, new RegExp(`^question-assets/${OTHER}/questions/${CID}/`));
  assert.equal(plan.questions[0].ownerId, OTHER);
  assert.equal(plan.questions[0].collectionOwnerId, OWNER);
});

test("source exact-text MD5, UTF-8 byte count and JSON are verified without changing input", () => {
  const source = freeze(row('{ "image": "' + dataUrl() + '", "text": "日本語" }'));
  assert.doesNotThrow(() => planFor(source));
  assert.throws(() => planFor({ ...source, payload_text: source.payload_text + " " }), /MD5 mismatch/);
  assert.throws(() => planFor({ ...source, payload_md5: "0".repeat(32) }), /MD5 mismatch/);
  assert.throws(() => planFor({ ...source, payload_bytes: source.payload_text.length }), /byte count/);
  assert.throws(() => planFor(row('{"broken":')), /Malformed source JSON/);
  assert.throws(() => planFor(row("null")), /Payload must be/);
});

test("WebP compares bytes 0..3 and 8..11 despite UTF-8 contraction in RIFF length", () => {
  const bytes = paddedWebp();
  assert.deepEqual(bytes.subarray(4, 8), Buffer.from([0xc2, 0xa1, 0, 0]));
  assert.notEqual(bytes.subarray(0, 12).toString("utf8").slice(8, 12), "WEBP");
  assert.equal(decodeEmbeddedImage(dataUrl(bytes)).contentType, "image/webp");
  const misplaced = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0xc2, 0xa1, 0, 0, 0]), Buffer.from("WEBP")]);
  assert.equal(misplaced.toString("utf8").slice(8, 12), "WEBP");
  assert.throws(() => detectImageFormat(misplaced), /Unknown/);
});

test("SVG/GIF/unknown formats, broken containers and noncanonical base64 fail closed", () => {
  const brokenPng = Buffer.from(PNG); brokenPng[40] ^= 1;
  for (const bytes of [Buffer.from("GIF89a"), Buffer.from("<svg/>"), Buffer.from("unknown"), PNG.subarray(0, 7),
    PNG.subarray(0, -1), brokenPng, JPEG.subarray(0, -2), WEBP.subarray(0, -2)]) {
    assert.throws(() => planFor(row({ image: dataUrl(bytes) })));
  }
  const canonical = dataUrl();
  const badPadBits = canonical.slice(0, -2) + "B="; // Same decoded tail, nonzero unused bits.
  for (const value of [canonical.slice(0, -1), canonical + "=", canonical + "\n", canonical.replace(";base64,", ";base64, "),
    "data:image/webp;base64,AA_A", "data:image/webp;base64,%%%%", badPadBits,
    dataUrl(PNG, "image/svg+xml"), dataUrl(PNG, "image/gif"), "data:image/webp;base64,"]) {
    assert.throws(() => planFor(row({ image: value })));
  }
});

test("decoded 10 MiB limit is enforced, including the exact boundary", () => {
  assert.equal(decodeEmbeddedImage(dataUrl(paddedWebp(MAX_IMAGE_BYTES))).sizeBytes, MAX_IMAGE_BYTES);
  assert.throws(() => decodeEmbeddedImage(dataUrl(paddedWebp(MAX_IMAGE_BYTES + 2))), /10 MiB/);
});

test("dedup includes owner and collection, not declared MIME or question id", () => {
  const first = row({ image: dataUrl(PNG), nested: [dataUrl(PNG, "image/png")] });
  const sameScope = row({ image: dataUrl(PNG) }, { id: OTHER });
  assert.equal(planFor(first, sameScope).assets.length, 1);
  assert.equal(planFor(first, sameScope).totals.replacements, 3);
  assert.equal(planFor(first, { ...sameScope, collection_id: OTHER }).assets.length, 2);
  assert.equal(planFor(first, { ...sameScope, created_by: OTHER, collection_owner_id: OTHER }).assets.length, 2);
});

test("all nested image values change, but text/answers/comments/keys and input stay unchanged", () => {
  const image = dataUrl();
  const original = { text: "本文", answer: "3m", score: 0.123, enabled: true, optional: null,
    comments: [{ text: "解説", attachments: [{ src: image }], inline: `前 <img src="${image}"> 後` }],
    extra: [image, { nested: { image } }] };
  const backup = freeze({ questions: [row(original)] });
  const before = JSON.stringify(backup);
  const plan = buildEmbeddedMediaPlan(backup), next = plan.questions[0].payload;
  assert.equal(plan.totals.replacements, 4);
  const restored = structuredClone(next);
  for (const change of plan.questions[0].changes) {
    let parent = restored;
    for (const key of change.path.slice(0, -1)) parent = parent[key];
    const key = change.path.at(-1);
    parent[key] = parent[key].replace(change.afterUrl, image);
  }
  assert.deepEqual(restored, original);
  assert.deepEqual(JSON.parse(plan.questions[0].payloadText), next);
  assert.equal(JSON.stringify(backup), before);
  const special = planFor(row('{"__proto__":{"image":"' + image + '"},"large":9007199254740993,"answer":"\\u767c"}'));
  assert.match(special.questions[0].payloadText, /"large":9007199254740993,"answer":"\\u767c"/);
  assert.equal(Object.hasOwn(special.questions[0].payload, "__proto__"), true);
  assert.equal({}.image, undefined);
});

test("repeated preparation is deterministic; already-replaced payloads have no new work", () => {
  const source = row(), first = planFor(source), second = planFor(source);
  assert.deepEqual(first, second);
  assert.deepEqual(buildEmbeddedOutputFiles(first, "a".repeat(64)), buildEmbeddedOutputFiles(second, "a".repeat(64)));
  const next = planFor(row(first.questions[0].payloadText));
  assert.equal(next.assets.length, 0);
  assert.equal(next.questions[0].changes.length, 0);
});

test("output consists only of originals, guarded manifest, exact payload JSON and MIME-separated key/file lists", () => {
  const plan = planFor(row({ images: [dataUrl(PNG), dataUrl(JPEG), dataUrl(WEBP)] }));
  const files = buildEmbeddedOutputFiles(plan, "a".repeat(64));
  assert.equal(files.length, 8);
  for (const asset of plan.assets) {
    assert.deepEqual(files.find((file) => file.relativePath === `decoded/${asset.key}`).bytes, asset.bytes);
    const bulk = files.find((file) => file.relativePath === `wrangler-bulk-${asset.contentType.replace("/", "-")}.json`);
    assert.deepEqual(JSON.parse(bulk.bytes), [{ key: asset.key, file: path.join(OUTPUT_DIRECTORY, `decoded/${asset.key}`) }]);
  }
  assert.equal(files.find((file) => file.relativePath === `payloads/${ID}.json`).bytes.toString(), plan.questions[0].payloadText);
  const manifest = JSON.parse(files.find((file) => file.relativePath === "manifest.json").bytes);
  assert.equal(manifest.sourceBackup, BACKUP_FILE);
  assert.equal(manifest.questions[0].sourcePayloadMd5, plan.questions[0].sourcePayloadMd5);
  assert.equal(JSON.stringify(manifest).includes("data:image/"), false);
});

test("local writer is repeat-safe and refuses conflicts/escape paths before any write (in-memory IO only)", async () => {
  const saved = new Map(); let writes = 0;
  const missing = () => Object.assign(new Error("missing"), { code: "ENOENT" });
  const io = {
    lstat: async () => { throw missing(); }, mkdir: async () => {},
    readFile: async (file) => { if (!saved.has(file)) throw missing(); return saved.get(file); },
    writeFile: async (file, bytes, options) => {
      assert.equal(options.flag, "wx");
      assert.ok(file.startsWith(OUTPUT_DIRECTORY + path.sep));
      if (saved.has(file)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
      saved.set(file, Buffer.from(bytes)); writes += 1;
    },
  };
  const files = buildEmbeddedOutputFiles(planFor(row()), "a".repeat(64));
  assert.equal((await writeEmbeddedOutputFiles(files, io)).written, files.length);
  assert.equal((await writeEmbeddedOutputFiles(files, io)).written, 0);
  const before = writes;
  await assert.rejects(writeEmbeddedOutputFiles([{ relativePath: "new.json", bytes: Buffer.from("new") },
    { relativePath: "manifest.json", bytes: Buffer.from("different") }], io), /refusing overwrite/);
  await assert.rejects(writeEmbeddedOutputFiles([{ relativePath: "../backup.json", bytes: PNG }], io), /Unsafe/);
  await assert.rejects(writeEmbeddedOutputFiles(files, { ...io, lstat: async () => ({ isSymbolicLink: () => true }) }), /symlinks/);
  assert.equal(writes, before);
  await assert.rejects(main(["--output", "elsewhere"]), /No input\/output overrides/);
});
