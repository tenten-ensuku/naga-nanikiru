// Offline preparation only. No remote client, credentials, execution or cleanup.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BACKUP_FILE = path.join(REPO_DIRECTORY, "outputs/r2-migration-20260906/embedded-question-backup.json");
export const OUTPUT_DIRECTORY = path.join(REPO_DIRECTORY, "outputs/r2-migration-20260906/embedded");
export const MEDIA_ORIGIN = "https://minkiru-media.naga-study.workers.dev";
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const FORMATS = new Map([["image/png", "png"], ["image/jpeg", "jpg"], ["image/webp", "webp"]]);
const digest = (algorithm, value) => createHash(algorithm).update(value).digest("hex");
const fail = (message) => { throw new Error(message); };
const uuid = (value, label) => typeof value === "string" && UUID.test(value)
  ? value.toLowerCase() : fail(`Invalid UUID: ${label}`);
const bytesAt = (bytes, offset, signature) => bytes.subarray(offset, offset + signature.length).equals(signature);

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}

// Bounded container checks catch truncated/corrupt originals without transcoding.
// These are not a full pixel/entropy decoder.
function validatePng(bytes) {
  let offset = 8, imageBytes = 0, first = true;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    const end = offset + 12 + size;
    if (end > bytes.length) fail("Broken PNG chunk length");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) fail("Broken PNG CRC");
    if (first && (type !== "IHDR" || size !== 13 || !bytes.readUInt32BE(offset + 8) || !bytes.readUInt32BE(offset + 12))) fail("Broken PNG header");
    if (!first && type === "IHDR") fail("Duplicate PNG header");
    if (type === "IDAT") imageBytes += size;
    if (type === "IEND") {
      if (size || !imageBytes || end !== bytes.length) fail("Broken PNG end");
      return;
    }
    first = false;
    offset = end;
  }
  fail("Truncated PNG");
}

function validateJpeg(bytes) {
  let offset = 2, frame = false, scan = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) fail("Broken JPEG marker");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!frame || !scan || offset !== bytes.length) fail("Broken JPEG end");
      return;
    }
    if (marker === undefined || marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || offset + 2 > bytes.length) fail("Broken JPEG segment");
    const size = bytes.readUInt16BE(offset);
    if (size < 2 || offset + size > bytes.length) fail("Broken JPEG length");
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (size < 8 || !bytes.readUInt16BE(offset + 3) || !bytes.readUInt16BE(offset + 5)) fail("Broken JPEG frame");
      frame = true;
    }
    offset += size;
    if (marker !== 0xda) continue;
    if (!frame) fail("JPEG scan without frame");
    scan = true;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const start = offset++;
      while (bytes[offset] === 0xff) offset += 1;
      if (bytes[offset] === 0 || (bytes[offset] >= 0xd0 && bytes[offset] <= 0xd7)) { offset += 1; continue; }
      offset = start;
      break;
    }
  }
  fail("Truncated JPEG");
}

function validateWebpChunks(bytes, start, end, allowFrames = true) {
  let offset = start, image = false;
  while (offset + 8 <= end) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8, dataEnd = dataStart + size;
    if (dataEnd + (size & 1) > end) fail("Broken WebP chunk length");
    if (type === "VP8 ") {
      if (size < 10 || !bytesAt(bytes, dataStart + 3, Buffer.from("9d012a", "hex"))) fail("Broken WebP frame");
      image = true;
    } else if (type === "VP8L") {
      if (size < 5 || bytes[dataStart] !== 0x2f) fail("Broken WebP lossless frame");
      image = true;
    } else if (type === "ANMF") {
      if (!allowFrames || size < 16 || !validateWebpChunks(bytes, dataStart + 16, dataEnd, false)) fail("Broken WebP animation frame");
      image = true;
    } else if (type === "VP8X" && size !== 10) fail("Broken WebP extended header");
    offset = dataEnd + (size & 1);
  }
  if (offset !== end) fail("Truncated WebP chunk");
  return image;
}

export function detectImageFormat(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_IMAGE_BYTES) fail("Image must contain 1..10 MiB of bytes");
  if (bytesAt(bytes, 0, PNG_SIGNATURE)) {
    validatePng(bytes);
    return { contentType: "image/png", extension: "png" };
  }
  if (bytesAt(bytes, 0, Buffer.from("ffd8ff", "hex"))) {
    validateJpeg(bytes);
    return { contentType: "image/jpeg", extension: "jpg" };
  }
  // RIFF bytes 4..7 are binary, not four UTF-8 characters.
  if (bytesAt(bytes, 0, Buffer.from("RIFF", "ascii")) && bytesAt(bytes, 8, Buffer.from("WEBP", "ascii"))) {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length || !validateWebpChunks(bytes, 12, bytes.length)) fail("Broken WebP RIFF length or missing frame");
    return { contentType: "image/webp", extension: "webp" };
  }
  fail("Unknown image signature; only PNG/JPEG/WebP are allowed (not SVG/GIF)");
}

export function decodeEmbeddedImage(dataUrl) {
  if (typeof dataUrl !== "string") fail("Invalid image data URL");
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(dataUrl);
  if (!match || !FORMATS.has(match[1].toLowerCase())) fail("Unsupported or malformed image data URL (not SVG/GIF)");
  const encoded = match[2];
  if (!encoded.length || encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) fail("Image exceeds 10 MiB or is empty");
  if (encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail("Noncanonical base64");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) fail("Noncanonical base64 padding bits");
  return { ...detectImageFormat(bytes), bytes, sizeBytes: bytes.length, sha256: digest("sha256", bytes), md5: digest("md5", bytes) };
}

function replaceDataUrls(value, replace) {
  const markers = /data:image\//gi;
  let output = "", cursor = 0, marker;
  while ((marker = markers.exec(value))) {
    const start = marker.index;
    let end = start + marker[0].length;
    while (end < value.length && !/[\s"'<>()[\]{}]/.test(value[end])) end += 1;
    // A standalone data URL cannot hide noncanonical whitespace as trailing text.
    if (start === 0 && end !== value.length) fail("Malformed standalone image data URL");
    const dataUrl = value.slice(start, end);
    output += value.slice(cursor, start) + replace(dataUrl, start, end);
    cursor = end;
    markers.lastIndex = end;
  }
  return cursor ? output + value.slice(cursor) : value;
}

function transformPayload(value, visitString, location = []) {
  if (typeof value === "string") return visitString(value, location);
  if (typeof value === "number" && !Number.isFinite(value)) fail("Non-finite payload number");
  if (Array.isArray(value)) return value.map((item, index) => transformPayload(item, visitString, [...location, index]));
  if (value && typeof value === "object") {
    // fromEntries preserves an own '__proto__' property without prototype mutation.
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transformPayload(item, visitString, [...location, key])]));
  }
  return value;
}

function updatedPayloadText(source, replacements) {
  // Keep all other JSON tokens verbatim, including SQL JSONB numeric precision.
  return source.replace(/"(?:\\[\s\S]|[^"\\])*"/g, (literal, offset) => {
    let next = offset + literal.length;
    while (/\s/.test(source[next] || "") && next < source.length) next += 1;
    if (source[next] === ":") return literal; // Property names are not image values.
    const value = JSON.parse(literal);
    const updated = replaceDataUrls(value, (dataUrl) => replacements.get(dataUrl) ?? fail("Unmatched data URL in source text"));
    return value === updated ? literal : JSON.stringify(updated);
  });
}

export function buildEmbeddedMediaPlan(backup) {
  if (!backup || !Array.isArray(backup.questions)) fail("Backup must contain questions[]");
  const assets = new Map(), ids = new Set(), questions = [];
  for (const row of backup.questions) {
    if (!row || typeof row !== "object") fail("Invalid backup question");
    const id = uuid(row.id, "id"), cid = uuid(row.collection_id, "collection_id");
    const owner = uuid(row.created_by, "created_by");
    const collectionOwner = uuid(row.collection_owner_id, "collection_owner_id");
    if (ids.has(id)) fail(`Duplicate question id: ${id}`);
    ids.add(id);
    if (typeof row.payload_text !== "string" || !/^[0-9a-f]{32}$/i.test(row.payload_md5 || "")) fail(`Invalid source payload/MD5 for ${id}`);
    if (digest("md5", row.payload_text) !== row.payload_md5.toLowerCase()) fail(`Source MD5 mismatch for ${id}`);
    if (!Number.isSafeInteger(row.payload_bytes) || Buffer.byteLength(row.payload_text) !== row.payload_bytes) fail(`Source payload byte count mismatch for ${id}`);
    if (typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at))) fail(`Invalid source updated_at for ${id}`);
    let original;
    try { original = JSON.parse(row.payload_text); } catch { fail(`Malformed source JSON for ${id}`); }
    if (!original || typeof original !== "object" || Array.isArray(original)) fail(`Payload must be an object for ${id}`);
    const changes = [], replacements = new Map();
    const payload = transformPayload(original, (value, location) => replaceDataUrls(value, (dataUrl, start, end) => {
      const image = decodeEmbeddedImage(dataUrl);
      const key = `question-assets/${owner}/questions/${cid}/${image.sha256}.${image.extension}`;
      const url = `${MEDIA_ORIGIN}/v1/private/${key}`;
      const existing = assets.get(key);
      if (existing && !existing.bytes.equals(image.bytes)) fail("Conflicting content for asset key");
      if (!existing) assets.set(key, { key, ownerId: owner, collectionId: cid, url, ...image });
      changes.push({ path: [...location], start, end, beforeDataUrlSha256: digest("sha256", dataUrl), afterUrl: url });
      replacements.set(dataUrl, url);
      return url;
    }));
    const payloadText = updatedPayloadText(row.payload_text, replacements);
    questions.push({ id, collectionId: cid, ownerId: owner, collectionOwnerId: collectionOwner, sourceUpdatedAt: row.updated_at,
      sourcePayloadMd5: row.payload_md5.toLowerCase(), sourcePayloadBytes: row.payload_bytes,
      changes, payload, payloadText });
  }
  return { schemaVersion: 1, status: "prepared_local_only", questions, assets: [...assets.values()],
    totals: { questions: questions.length, changedQuestions: questions.filter((question) => question.changes.length).length,
      replacements: questions.reduce((sum, question) => sum + question.changes.length, 0),
      assets: assets.size, decodedBytes: [...assets.values()].reduce((sum, asset) => sum + asset.sizeBytes, 0) } };
}

const jsonBytes = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");

export function buildEmbeddedOutputFiles(plan, sourceBackupSha256) {
  if (!/^[0-9a-f]{64}$/.test(sourceBackupSha256)) fail("Invalid backup SHA-256");
  const files = [], assetRecords = [], groups = new Map();
  for (const { bytes, ...asset } of plan.assets) {
    const checked = detectImageFormat(bytes);
    const owner = uuid(asset.ownerId, "asset owner"), cid = uuid(asset.collectionId, "asset collection");
    const expectedKey = `question-assets/${owner}/questions/${cid}/${digest("sha256", bytes)}.${checked.extension}`;
    if (asset.key !== expectedKey || asset.contentType !== checked.contentType || asset.sha256 !== digest("sha256", bytes)
      || asset.md5 !== digest("md5", bytes) || asset.sizeBytes !== bytes.length || asset.url !== `${MEDIA_ORIGIN}/v1/private/${expectedKey}`) fail("Asset plan integrity mismatch");
    const file = `decoded/${asset.key}`;
    files.push({ relativePath: file, bytes: Buffer.from(bytes) });
    assetRecords.push({ ...asset, file });
    if (!groups.has(asset.contentType)) groups.set(asset.contentType, []);
    groups.get(asset.contentType).push({ key: asset.key, file: path.join(OUTPUT_DIRECTORY, file) });
  }
  const questionRecords = plan.questions.map(({ payload, payloadText, ...question }) => {
    const id = uuid(question.id, "payload file id");
    const file = question.changes.length ? `payloads/${id}.json` : null;
    if (file) files.push({ relativePath: file, bytes: Buffer.from(payloadText) });
    return { ...question, payloadFile: file };
  });
  const bulkFiles = [];
  for (const [contentType, entries] of [...groups.entries()].sort()) {
    const file = `wrangler-bulk-${contentType.replace("/", "-")}.json`;
    files.push({ relativePath: file, bytes: jsonBytes(entries) });
    bulkFiles.push({ contentType, file, objects: entries.length });
  }
  files.push({ relativePath: "manifest.json", bytes: jsonBytes({ schemaVersion: plan.schemaVersion, status: plan.status,
    sourceBackup: BACKUP_FILE, sourceBackupSha256, totals: plan.totals, assets: assetRecords,
    questions: questionRecords, bulkFiles }) });
  return files;
}

async function checkOutputPath(file, io) {
  const relative = path.relative(REPO_DIRECTORY, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("Output escaped repository");
  let current = REPO_DIRECTORY;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    try {
      const stat = await io.lstat(current);
      if (stat.isSymbolicLink()) fail("Output symlinks/junctions are not allowed");
      if (current !== file && !stat.isDirectory()) fail("Output parent is not a directory");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

async function alreadyMatches(file, bytes, io) {
  try {
    if (!(await io.readFile(file)).equals(bytes)) fail(`Existing output differs; refusing overwrite: ${file}`);
    return true;
  } catch (error) { if (error.code !== "ENOENT") throw error; return false; }
}

export async function writeEmbeddedOutputFiles(files, io = fs) {
  const targets = [], seen = new Set();
  // Validate/preflight every output before creating anything.
  for (const entry of files) {
    if (!entry.relativePath || !Buffer.isBuffer(entry.bytes) || path.isAbsolute(entry.relativePath)
      || entry.relativePath.includes("\\") || entry.relativePath.split("/").some((part) => !part || part === "." || part === ".." || part.includes(":"))) fail("Unsafe output path");
    const file = path.resolve(OUTPUT_DIRECTORY, entry.relativePath);
    if (seen.has(file)) fail("Duplicate output path");
    seen.add(file);
    await checkOutputPath(file, io);
    targets.push({ file, bytes: entry.bytes, exists: await alreadyMatches(file, entry.bytes, io) });
  }
  let written = 0;
  for (const target of targets) {
    if (target.exists) continue;
    await checkOutputPath(target.file, io);
    await io.mkdir(path.dirname(target.file), { recursive: true });
    try { await io.writeFile(target.file, target.bytes, { flag: "wx", mode: 0o600 }); written += 1; }
    catch (error) { if (error.code !== "EEXIST") throw error; await alreadyMatches(target.file, target.bytes, io); }
  }
  return { files: targets.length, written, reused: targets.length - written };
}

export async function main(args = process.argv.slice(2)) {
  if (args.length) {
    if (args.length === 1 && args[0] === "--help") {
      console.log(`Usage: node scripts/prepare-embedded-media.mjs\nInput: ${BACKUP_FILE}\nLocal output only: ${OUTPUT_DIRECTORY}\nValidates all questions first; identical outputs are reused, conflicts are refused.`);
      return;
    }
    fail("No input/output overrides or remote actions are supported; use --help");
  }
  const backupBytes = await fs.readFile(BACKUP_FILE);
  const plan = buildEmbeddedMediaPlan(JSON.parse(backupBytes.toString("utf8")));
  const files = buildEmbeddedOutputFiles(plan, digest("sha256", backupBytes));
  const result = await writeEmbeddedOutputFiles(files);
  console.log(JSON.stringify({ status: plan.status, ...plan.totals, ...result, outputDirectory: OUTPUT_DIRECTORY }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
