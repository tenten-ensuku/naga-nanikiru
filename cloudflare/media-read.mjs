import { ApiError, canAccessCollection, requireActor } from "./access.mjs";

// This module is deliberately read-only.  The Worker owns authentication and
// error serialization; this sidecar only receives the already verified actor
// and the already bounded JSON body.
export const PUBLIC_MEDIA_BUCKETS = Object.freeze([
  "naga-question-assets",
  "comment-assets",
  "reaction-assets",
]);
export const PRIVATE_MEDIA_BUCKET = "question-assets";

const PUBLIC_BUCKET_SET = new Set(PUBLIC_MEDIA_BUCKETS);
const IMAGE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const BUCKET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const ENCODED_DANGEROUS_PATH_PATTERN = /%(?:2e|2f|5c)/i;
const MAX_PATH_LENGTH = 1024;
const MAX_KEYS = 32;
const PRIVATE_URL_LIFETIME_SECONDS = 900;

function mediaError(code, status = 400) {
  throw new ApiError(code, status);
}

function requireDb(env) {
  if (!env?.DB || typeof env.DB.prepare !== "function") {
    mediaError("media_not_configured", 503);
  }
  return env.DB;
}

function requireImages(env) {
  if (!env?.IMAGES || typeof env.IMAGES.get !== "function" || typeof env.IMAGES.head !== "function") {
    mediaError("media_not_configured", 503);
  }
  return env.IMAGES;
}

function rowsFrom(result) {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.results) ? result.results : [];
}

function validDecodedPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PATH_LENGTH) return false;
  if (
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.includes("://") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("%") ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment && segment !== "." && segment !== ".." && !CONTROL_CHARACTER_PATTERN.test(segment));
}

function parseKey(value, allowedBuckets) {
  if (typeof value !== "string" || value.length === 0 || value.length > 1200) return null;
  const separator = value.indexOf("/");
  if (separator <= 0) return null;
  const bucket = value.slice(0, separator);
  const path = value.slice(separator + 1);
  if (!allowedBuckets.has(bucket) || !BUCKET_PATTERN.test(bucket) || !validDecodedPath(path)) return null;
  return { bucket, path, key: `${bucket}/${path}` };
}

function parseRoutePath(rawPath, allowedBuckets) {
  if (typeof rawPath !== "string" || rawPath.length === 0 || rawPath.length > 2200) return null;
  const separator = rawPath.indexOf("/");
  if (separator <= 0) return null;
  const rawBucket = rawPath.slice(0, separator);
  const rawAssetPath = rawPath.slice(separator + 1);
  if (rawBucket.includes("%") || !allowedBuckets.has(rawBucket) || !BUCKET_PATTERN.test(rawBucket)) return null;

  const decodedSegments = [];
  for (const rawSegment of rawAssetPath.split("/")) {
    if (!rawSegment || ENCODED_DANGEROUS_PATH_PATTERN.test(rawSegment)) return null;
    let decoded;
    try {
      decoded = decodeURIComponent(rawSegment);
    } catch {
      return null;
    }
    if (encodeURIComponent(decoded) !== rawSegment) return null;
    decodedSegments.push(decoded);
  }
  const path = decodedSegments.join("/");
  if (!validDecodedPath(path)) return null;
  return {
    bucket: rawBucket,
    path,
    key: `${rawBucket}/${path}`,
    canonicalPath: `${rawBucket}/${decodedSegments.map((segment) => encodeURIComponent(segment)).join("/")}`,
  };
}

function requestKeys(body, allowedBuckets) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !Array.isArray(body.keys)) {
    mediaError("media_body_invalid", 400);
  }
  if (body.keys.length < 1 || body.keys.length > MAX_KEYS) mediaError("media_keys_invalid", 400);

  const unique = [];
  const seen = new Set();
  for (const value of body.keys) {
    const parsed = parseKey(value, allowedBuckets);
    if (!parsed) mediaError("media_key_invalid", 400);
    if (!seen.has(parsed.key)) {
      seen.add(parsed.key);
      unique.push(parsed);
    }
  }
  return unique;
}

function nowSeconds(env) {
  const configured = typeof env?.MEDIA_NOW === "function"
    ? env.MEDIA_NOW()
    : env?.MEDIA_NOW ?? env?.NOW ?? (typeof env?.now === "function" ? env.now() : env?.now);
  const value = configured == null ? Date.now() : Number(configured);
  if (!Number.isFinite(value)) return Math.floor(Date.now() / 1000);
  return Math.floor(value > 10_000_000_000 ? value / 1000 : value);
}

function jsonResponse(value) {
  return Response.json(value, {
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function readyPublicRows(db, keys) {
  const placeholders = keys.map(() => "?").join(",");
  const result = await db.prepare(`
    SELECT object_key
      FROM media_assets
     WHERE state='ready'
       AND bucket IN ('naga-question-assets','comment-assets','reaction-assets')
       AND object_key IN (${placeholders})
  `).bind(...keys).all();
  return rowsFrom(result);
}

async function readyPrivateRows(db, keys) {
  const placeholders = keys.map(() => "?").join(",");
  const result = await db.prepare(`
    SELECT object_key, bucket, path, owner_id, collection_id, size_bytes, content_type
      FROM media_assets
     WHERE state='ready'
       AND bucket='question-assets'
       AND object_key IN (${placeholders})
  `).bind(...keys).all();
  return rowsFrom(result);
}

async function readyAsset(db, parsed) {
  return await db.prepare(`
    SELECT object_key, bucket, path, owner_id, collection_id, size_bytes, content_type
      FROM media_assets
     WHERE object_key=? AND bucket=? AND state='ready'
     LIMIT 1
  `).bind(parsed.key, parsed.bucket).first();
}

function canonicalRoutePath(kind, parsed) {
  return `/v1/${kind}/${parsed.canonicalPath}`;
}

function checkPrivateQuery(url, env) {
  const entries = [...url.searchParams.entries()];
  if (
    entries.length !== 2 ||
    new Set(entries.map(([name]) => name)).size !== 2 ||
    !url.searchParams.has("expires") ||
    !url.searchParams.has("signature") ||
    url.searchParams.get("signature") !== "cookie"
  ) {
    mediaError("media_signature_invalid", 403);
  }
  const rawExpires = url.searchParams.get("expires") ?? "";
  if (!/^\d+$/.test(rawExpires)) mediaError("media_expiry_invalid", 403);
  const expires = Number(rawExpires);
  const now = nowSeconds(env);
  if (!Number.isSafeInteger(expires) || expires < now || expires > now + PRIVATE_URL_LIFETIME_SECONDS) {
    mediaError("media_url_expired", 403);
  }
  return expires;
}

function metadataFor(object, asset, isPrivate) {
  const headers = new Headers();
  if (typeof object.writeHttpMetadata === "function") object.writeHttpMetadata(headers);

  const expectedType = String(asset.content_type ?? "").toLowerCase();
  const actualType = String(
    headers.get("content-type") || object.httpMetadata?.contentType || object.contentType || "",
  ).split(";", 1)[0].trim().toLowerCase();
  if (!IMAGE_CONTENT_TYPES.has(expectedType) || actualType !== expectedType) {
    mediaError("media_content_type_invalid", 415);
  }

  const objectSize = Number.isSafeInteger(object.size) ? object.size : null;
  const ledgerSize = Number(asset.size_bytes);
  if (objectSize !== null && Number.isSafeInteger(ledgerSize) && objectSize !== ledgerSize) {
    mediaError("media_object_mismatch", 404);
  }

  headers.set("Content-Type", actualType);
  if (objectSize !== null) headers.set("Content-Length", String(objectSize));
  else if (Number.isSafeInteger(ledgerSize)) headers.set("Content-Length", String(ledgerSize));
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", isPrivate ? "no-store" : "public, max-age=86400");
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

async function serveObject(request, env, parsed, asset, isPrivate) {
  const images = requireImages(env);
  const object = request.method === "HEAD"
    ? await images.head(parsed.key)
    : await images.get(parsed.key, { onlyIf: request.headers });
  if (!object) mediaError("media_not_found", 404);

  const headers = metadataFor(object, asset, isPrivate);
  if (request.method === "GET" && object.body == null) {
    if (request.headers.has("if-none-match")) return new Response(null, { status: 304, headers });
    mediaError("media_not_found", 404);
  }
  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
}

async function resolvePublic(request, env, actor, body) {
  requireActor(actor);
  const parsedKeys = requestKeys(body, PUBLIC_BUCKET_SET);
  const requested = parsedKeys.map(({ key }) => key);
  const rows = await readyPublicRows(requireDb(env), requested);
  const ready = new Set(rows.map((row) => row.object_key));
  return jsonResponse({ keys: requested.filter((key) => ready.has(key)) });
}

async function resolvePrivate(request, env, actor, body) {
  requireActor(actor);
  const parsedKeys = requestKeys(body, new Set([PRIVATE_MEDIA_BUCKET]));
  const requested = parsedKeys.map(({ key }) => key);
  const rows = await readyPrivateRows(requireDb(env), requested);
  const byKey = new Map(rows.map((row) => [row.object_key, row]));
  for (const key of requested) {
    const asset = byKey.get(key);
    if (!asset || (asset.owner_id !== actor.id && !(await canAccessCollection(env.DB, actor, asset.collection_id)))) {
      mediaError("media_access_denied", 403);
    }
  }

  const expires = nowSeconds(env) + PRIVATE_URL_LIFETIME_SECONDS;
  const origin = new URL(request.url).origin;
  const urls = Object.create(null);
  for (const parsed of parsedKeys) {
    urls[parsed.key] = `${origin}${canonicalRoutePath("private", {
      ...parsed,
      canonicalPath: `${parsed.bucket}/${parsed.path.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`,
    })}?expires=${expires}&signature=cookie`;
  }
  return jsonResponse({ urls });
}

async function serve(request, env, actor, isPrivate) {
  if (isPrivate) requireActor(actor);
  const url = new URL(request.url);
  const prefix = isPrivate ? "/v1/private/" : "/v1/public/";
  const allowed = isPrivate ? new Set([PRIVATE_MEDIA_BUCKET]) : PUBLIC_BUCKET_SET;
  const rawPath = url.pathname.slice(prefix.length);
  const parsed = parseRoutePath(rawPath, allowed);
  if (!parsed || url.pathname !== canonicalRoutePath(isPrivate ? "private" : "public", parsed)) {
    mediaError("media_not_found", 404);
  }
  if (isPrivate) checkPrivateQuery(url, env);
  else if (url.search) mediaError("media_not_found", 404);

  const db = requireDb(env);
  const asset = await readyAsset(db, parsed);
  if (!asset) mediaError("media_not_found", 404);
  if (isPrivate && asset.owner_id !== actor.id && !(await canAccessCollection(db, actor, asset.collection_id))) {
    mediaError("media_access_denied", 403);
  }
  return serveObject(request, env, parsed, asset, isPrivate);
}

/**
 * Handle the D1/R2 read-only media surface.  Unknown routes return null so the
 * main Worker can reject uploads/deletes and route the rest of the API itself.
 */
export async function mediaRead(request, env, { actor = null, body = null } = {}) {
  const url = new URL(request.url);
  if (url.pathname === "/v1/resolve-public") {
    if (request.method !== "POST") mediaError("method_not_allowed", 405);
    return resolvePublic(request, env, actor, body);
  }
  if (url.pathname === "/v1/resolve") {
    if (request.method !== "POST") mediaError("method_not_allowed", 405);
    return resolvePrivate(request, env, actor, body);
  }
  if (url.pathname.startsWith("/v1/public/")) {
    if (request.method !== "GET" && request.method !== "HEAD") mediaError("method_not_allowed", 405);
    return serve(request, env, actor, false);
  }
  if (url.pathname.startsWith("/v1/private/")) {
    if (request.method !== "GET" && request.method !== "HEAD") mediaError("method_not_allowed", 405);
    return serve(request, env, actor, true);
  }
  return null;
}

export default mediaRead;
