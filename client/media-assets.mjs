const BYTES_PER_MIB = 1024 * 1024;

export const MEDIA_BUCKET_RULES = Object.freeze({
  "comment-assets": Object.freeze({ maxBytes: 5 * BYTES_PER_MIB, allowGif: true }),
  "reaction-assets": Object.freeze({ maxBytes: 1 * BYTES_PER_MIB, allowGif: true }),
  "question-assets": Object.freeze({ maxBytes: 10 * BYTES_PER_MIB, allowGif: false }),
});

export const MEDIA_IMAGE_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export const LEGACY_PUBLIC_MEDIA_BUCKETS = Object.freeze([
  "comment-assets",
  "reaction-assets",
  "naga-question-assets",
]);

export const PRIVATE_RESOLVE_BATCH_SIZE = 32;
export const PUBLIC_RESOLVE_BATCH_SIZE = 32;

const MEDIA_IMAGE_TYPE_SET = new Set(MEDIA_IMAGE_TYPES);
const QUESTION_ASSET_BUCKET = "question-assets";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_BUCKET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const SAFE_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const ENCODED_DANGEROUS_PATH_PATTERN = /%(?:2e|2f|5c)/i;

function mediaError(message) {
  return new Error(`メディア: ${message}`);
}

function normalizeOrigin(value, { httpsOnly = false } = {}) {
  if (typeof value !== "string" || value.length === 0) return "";
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return "";
  }
  if (httpsOnly ? parsed.protocol !== "https:" : !["http:", "https:"].includes(parsed.protocol)) return "";
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return "";
  if (parsed.pathname !== "" && parsed.pathname !== "/") return "";
  if (!parsed.hostname) return "";
  return parsed.origin;
}

export function normalizeMediaApiOrigin(value) {
  return normalizeOrigin(value, { httpsOnly: true });
}

export function normalizeAssetBucket(value) {
  if (typeof value !== "string" || !SAFE_BUCKET_PATTERN.test(value)) return "";
  return value;
}

function parseAssetPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  if (value.startsWith("/") || value.endsWith("/")) return null;
  if (value.includes("\\") || value.includes("://") || CONTROL_CHARACTER_PATTERN.test(value)) return null;
  if (value.includes("?") || value.includes("#")) return null;

  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;

  const decodedSegments = [];
  for (const segment of segments) {
    if (ENCODED_DANGEROUS_PATH_PATTERN.test(segment)) return null;
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (
      !decoded ||
      decoded === "." ||
      decoded === ".." ||
      /[\\/?#]/.test(decoded) ||
      CONTROL_CHARACTER_PATTERN.test(decoded)
    ) {
      return null;
    }
    decodedSegments.push(decoded);
  }

  const path = decodedSegments.join("/");
  return {
    path,
    encodedPath: decodedSegments.map((segment) => encodeURIComponent(segment)).join("/"),
  };
}

export function normalizeAssetPath(value) {
  return parseAssetPath(value)?.path ?? "";
}

export function encodeAssetPath(value) {
  return parseAssetPath(value)?.encodedPath ?? "";
}

export function isValidCollectionId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

function normalizeOptionalSlug(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && SAFE_SLUG_PATTERN.test(normalized) ? normalized : null;
}

function normalizeOptionalCollectionId(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && UUID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeCollectionHeaders(options = {}) {
  const shareSlug = normalizeOptionalSlug(options.shareSlug);
  if (shareSlug === null) throw mediaError("shareSlug が不正です。");
  const collectionId = normalizeOptionalCollectionId(options.collectionId);
  if (collectionId === null) throw mediaError("collectionId は UUID で指定してください。");
  return { shareSlug, collectionId };
}

function isRawUrlPathSafe(value) {
  const schemeIndex = value.indexOf("://");
  if (schemeIndex < 0) return false;
  const authorityEnd = value.indexOf("/", schemeIndex + 3);
  if (authorityEnd < 0) return true;
  const queryIndex = value.search(/[?#]/);
  const rawPath = value.slice(authorityEnd, queryIndex < 0 ? value.length : queryIndex);
  return !(
    rawPath.includes("\\") ||
    ENCODED_DANGEROUS_PATH_PATTERN.test(rawPath) ||
    /(?:^|\/)(?:\.{1,2})(?:\/|$)/.test(rawPath)
  );
}

function decodeUrlAssetPath(rawPath) {
  if (!rawPath || rawPath.startsWith("/") || rawPath.endsWith("/")) return null;
  const segments = rawPath.split("/");
  const decodedSegments = [];
  for (const segment of segments) {
    if (!segment || ENCODED_DANGEROUS_PATH_PATTERN.test(segment)) return null;
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    decodedSegments.push(decoded);
  }
  const parsed = parseAssetPath(decodedSegments.join("/"));
  return parsed ? parsed.path : null;
}

function decodeBucketSegment(value) {
  if (!value || value.includes("%")) return "";
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return "";
  }
  return normalizeAssetBucket(decoded);
}

function canonicalPublicUrl(origin, bucket, path) {
  const normalizedBucket = normalizeAssetBucket(bucket);
  const parsedPath = parseAssetPath(path);
  if (!origin || !normalizedBucket || !parsedPath) return "";
  return `${origin}/v1/public/${normalizedBucket}/${parsedPath.encodedPath}`;
}

function canonicalSupabasePublicUrl(origin, bucket, path) {
  const normalizedBucket = normalizeAssetBucket(bucket);
  const parsedPath = parseAssetPath(path);
  if (!origin || !normalizedBucket || !parsedPath) return "";
  return `${origin}/storage/v1/object/public/${encodeURIComponent(normalizedBucket)}/${parsedPath.encodedPath}`;
}

function canonicalPrivateUrl(origin, bucket, path) {
  const normalizedBucket = normalizeAssetBucket(bucket);
  const parsedPath = parseAssetPath(path);
  if (!origin || normalizedBucket !== QUESTION_ASSET_BUCKET || !parsedPath) return "";
  return `${origin}/v1/private/${normalizedBucket}/${parsedPath.encodedPath}`;
}

export function canonicalPrivateAssetUrl(mediaApiUrl, path) {
  return canonicalPrivateUrl(normalizeMediaApiOrigin(mediaApiUrl), QUESTION_ASSET_BUCKET, path);
}

function parsePublicRouteReference(value, origin, routePrefix, { allowQuery = false } = {}) {
  if (typeof value !== "string" || !origin || !isRawUrlPathSafe(value)) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    parsed.origin !== origin ||
    parsed.username ||
    parsed.password ||
    (!allowQuery && parsed.search) ||
    parsed.hash ||
    !parsed.pathname.startsWith(routePrefix)
  ) {
    return null;
  }

  const rest = parsed.pathname.slice(routePrefix.length);
  const slashIndex = rest.indexOf("/");
  if (slashIndex <= 0 || slashIndex === rest.length - 1) return null;
  const bucket = decodeBucketSegment(rest.slice(0, slashIndex));
  const path = decodeUrlAssetPath(rest.slice(slashIndex + 1));
  if (!bucket || !path) return null;
  return { bucket, path, canonical: `${origin}${routePrefix}${bucket}/${parseAssetPath(path).encodedPath}` };
}

function parsePrivateReference(value, origin, { allowSigned = false } = {}) {
  const reference = parsePublicRouteReference(value, origin, "/v1/private/", { allowQuery: allowSigned });
  if (!reference || reference.bucket !== QUESTION_ASSET_BUCKET) return null;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (!allowSigned) return reference;
  if (!parsed.search) return reference;
  const params = [...parsed.searchParams.entries()];
  if (
    params.length !== 2 ||
    params.some(([, parameterValue]) => !parameterValue) ||
    new Set(params.map(([key]) => key)).size !== 2 ||
    !parsed.searchParams.has("expires") ||
    !parsed.searchParams.has("signature")
  ) {
    return null;
  }
  return { ...reference, signed: true };
}

function parseMediaPublicReference(value, origin) {
  return parsePublicRouteReference(value, origin, "/v1/public/");
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    const copy = [];
    for (const key of Object.keys(value)) {
      Object.defineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: cloneValue(value[key]),
        writable: true,
      });
    }
    return copy;
  }
  if (value && typeof value === "object") {
    const copy = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: cloneValue(value[key]),
        writable: true,
      });
    }
    return copy;
  }
  return value;
}

export function cloneMediaPayload(payload) {
  return cloneValue(payload);
}

async function mapPayload(value, mapString) {
  if (typeof value === "string") return mapString(value);
  if (Array.isArray(value)) {
    const copy = [];
    for (const key of Object.keys(value)) {
      Object.defineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: await mapPayload(value[key], mapString),
        writable: true,
      });
    }
    return copy;
  }
  if (value && typeof value === "object") {
    const copy = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: await mapPayload(value[key], mapString),
        writable: true,
      });
    }
    return copy;
  }
  return value;
}

function mapPayloadSync(value, mapString) {
  if (typeof value === "string") return mapString(value);
  if (Array.isArray(value)) {
    const copy = [];
    for (const key of Object.keys(value)) {
      Object.defineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: mapPayloadSync(value[key], mapString),
        writable: true,
      });
    }
    return copy;
  }
  if (value && typeof value === "object") {
    const copy = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: mapPayloadSync(value[key], mapString),
        writable: true,
      });
    }
    return copy;
  }
  return value;
}

function assertNoBlobUrls(value) {
  if (typeof value === "string") {
    if (/^blob:/i.test(value)) throw mediaError("blob URL は永続化できません。画像を再選択してください。");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoBlobUrls(item);
    return;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) assertNoBlobUrls(value[key]);
  }
}

export function isDataImageUrl(value) {
  return typeof value === "string" && /^data:image\//i.test(value);
}

export function parseDataImageUrl(value) {
  if (!isDataImageUrl(value)) return null;
  const commaIndex = value.indexOf(",");
  if (commaIndex < 0) throw mediaError("data:image URL の形式が不正です。");

  const metadata = value.slice(5, commaIndex);
  const encodedData = value.slice(commaIndex + 1);
  const metadataParts = metadata.split(";");
  const mimeType = String(metadataParts.shift() ?? "").toLowerCase();
  if (!MEDIA_IMAGE_TYPE_SET.has(mimeType)) throw mediaError("PNG・JPEG・WebP・GIF の data:image URL のみ利用できます。");

  const isBase64 = metadataParts.some((part) => part.toLowerCase() === "base64");
  let bytes;
  if (isBase64) {
    const base64 = encodedData.replace(/[\t\n\r ]/g, "");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
      throw mediaError("base64 の data:image URL が不正です。");
    }
    if (typeof globalThis.atob !== "function") throw mediaError("base64 をデコードできません。");
    const binary = globalThis.atob(base64);
    bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  } else {
    let decoded;
    try {
      decoded = decodeURIComponent(encodedData);
    } catch {
      throw mediaError("data:image URL のエンコードが不正です。");
    }
    bytes = new TextEncoder().encode(decoded);
  }
  return { mimeType, bytes };
}

export async function sha256Hex(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  if (!globalThis.crypto?.subtle) throw mediaError("SHA-256 を計算できません。");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function copyBytes(value) {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  throw mediaError("画像データを読み取れません。");
}

async function readFileBytes(file) {
  if (!file || typeof file.arrayBuffer !== "function") throw mediaError("画像ファイルが不正です。");
  return copyBytes(await file.arrayBuffer());
}

function makeEmbeddedImageFile(parsed) {
  const bytes = parsed.bytes.slice();
  return {
    name: "embedded-image",
    type: parsed.mimeType,
    size: bytes.byteLength,
    async arrayBuffer() {
      return bytes.slice().buffer;
    },
  };
}

function getResponseStatus(response) {
  return typeof response?.status === "number" ? response.status : 0;
}

function assertResponseOk(response) {
  const status = getResponseStatus(response);
  if (!response || response.ok === false || (status >= 400 && status !== 0)) {
    const suffix = status ? ` (HTTP ${status})` : "";
    throw mediaError(`メディア API のリクエストに失敗しました${suffix}。`);
  }
}

async function readJsonResponse(response) {
  assertResponseOk(response);
  if (typeof response.json !== "function") throw mediaError("メディア API の JSON 応答がありません。");
  return response.json();
}

function getResponseAsset(body) {
  if (body && typeof body === "object" && body.asset && typeof body.asset === "object") return body.asset;
  return body;
}

function expectedUploadSource(mediaOrigin, bucket, path) {
  return bucket === QUESTION_ASSET_BUCKET
    ? canonicalPrivateUrl(mediaOrigin, bucket, path)
    : canonicalPublicUrl(mediaOrigin, bucket, path);
}

function normalizeUploadResponse(body, requestedBucket, bytes, sha256, mediaOrigin) {
  const asset = getResponseAsset(body);
  if (!asset || typeof asset !== "object") throw mediaError("メディア API のアップロード応答が不正です。");

  const bucket = normalizeAssetBucket(asset.bucket ?? requestedBucket);
  if (bucket !== requestedBucket) throw mediaError("アップロード応答の bucket が一致しません。");
  const path = normalizeAssetPath(asset.path);
  if (!path) throw mediaError("アップロード応答の path が不正です。");
  if (asset.size !== bytes.byteLength) throw mediaError("アップロード応答の size が実データと一致しません。");
  if (asset.sha256 !== sha256) throw mediaError("アップロード応答の sha256 が実データと一致しません。");

  const expectedSource = expectedUploadSource(mediaOrigin, bucket, path);
  if (!expectedSource) throw mediaError("アップロード先の source を組み立てられません。");
  let src = expectedSource;
  if (asset.src != null) {
    if (bucket === QUESTION_ASSET_BUCKET) {
      const privateReference = parsePrivateReference(String(asset.src), mediaOrigin, { allowSigned: true });
      if (!privateReference || privateReference.bucket !== bucket || privateReference.path !== path) {
        throw mediaError("アップロード応答の src が許可された media API origin と一致しません。");
      }
      src = String(asset.src);
    } else if (String(asset.src) !== expectedSource) {
      throw mediaError("アップロード応答の src が許可された media API origin と一致しません。");
    } else {
      src = String(asset.src);
    }
  }

  return {
    bucket,
    path,
    src,
    size: asset.size,
    sha256: asset.sha256,
  };
}

function createHeaderSet(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

/**
 * Public verification is memory-only and scoped to getSession().user.id.
 * Supply a live synchronous session getter to use the sync URL/rewrite helpers.
 * Async session getters are supported by resolvePublicPayload; sync helpers keep
 * legacy URLs when the current account cannot be checked synchronously.
 */
export function createMediaClient({ config = {}, getSession, fetchImpl = globalThis.fetch } = {}) {
  const runtimeConfig = config && typeof config === "object" ? config : {};
  const supabaseOrigin = normalizeOrigin(runtimeConfig.supabaseUrl);
  const mediaOrigin = normalizeMediaApiOrigin(runtimeConfig.mediaApiUrl);
  // This is a feature allowlist, never evidence that an individual object exists.
  const publicBucketAllowlist = new Set(
    Array.isArray(runtimeConfig.mediaReadyBuckets)
      ? runtimeConfig.mediaReadyBuckets.map(normalizeAssetBucket).filter(Boolean)
      : [],
  );
  const verifiedPublicKeys = new Set();
  let publicSession = { userId: "", accessToken: "", epoch: 0 };
  let sessionReadSequence = 0;
  let observedSessionSequence = 0;

  function accountChangedError() {
    return mediaError("アカウントが変更されたため、メディア操作をやり直してください。");
  }

  function observePublicSession(value, sequence) {
    if (value?.error) return failPublicSessionRead(value.error, sequence);
    const session = value?.data?.session ?? value?.session ?? value;
    const token = typeof session?.access_token === "string" ? session.access_token.trim() : "";
    const id = typeof session?.user?.id === "string" ? session.user.id : "";
    const userId = token && !CONTROL_CHARACTER_PATTERN.test(token) && id.trim() ? id : "";

    // An older async getter must not restore an account observed before a newer read.
    if (sequence < observedSessionSequence) {
      if (userId !== publicSession.userId) throw accountChangedError();
      return { ...publicSession };
    }
    observedSessionSequence = sequence;
    const changed = userId !== publicSession.userId;
    if (changed || !userId) verifiedPublicKeys.clear();
    publicSession = {
      userId,
      accessToken: userId ? token : "",
      epoch: publicSession.epoch + (changed ? 1 : 0),
    };
    return { ...publicSession };
  }

  function failPublicSessionRead(error, sequence) {
    if (sequence >= observedSessionSequence) observePublicSession(null, sequence);
    throw error;
  }

  function readPublicSession() {
    const sequence = ++sessionReadSequence;
    let value;
    try {
      value = typeof getSession === "function" ? getSession() : null;
    } catch (error) {
      return failPublicSessionRead(error, sequence);
    }
    if (value && typeof value.then === "function") {
      return Promise.resolve(value).then(
        (session) => observePublicSession(session, sequence),
        (error) => failPublicSessionRead(error, sequence),
      );
    }
    return observePublicSession(value, sequence);
  }

  async function requirePublicSession() {
    const session = await readPublicSession();
    if (!session.userId) throw mediaError("このメディア操作にはユーザーIDを含むログインセッションが必要です。");
    return session;
  }

  function synchronousPublicSession() {
    try {
      const session = readPublicSession();
      if (session && typeof session.then === "function") {
        // Sync reads cannot prove the current account using an async getter.
        // Use resolvePublicPayload for that adapter; never expose the previous account's cache.
        session.catch(() => {});
        return null;
      }
      return session.userId ? session : null;
    } catch {
      return null;
    }
  }

  function isCurrentPublicSession(session) {
    return Boolean(session?.userId && session.userId === publicSession.userId && session.epoch === publicSession.epoch);
  }

  async function checkPublicAccount(expected) {
    const current = await requirePublicSession();
    if (expected.userId !== current.userId || expected.epoch !== current.epoch || !isCurrentPublicSession(current)) {
      throw accountChangedError();
    }
    return current;
  }

  function isAllowedPublicBucket(bucket) {
    return Boolean(mediaOrigin && bucket !== QUESTION_ASSET_BUCKET && publicBucketAllowlist.has(bucket));
  }

  function publicKey(bucket, path) {
    const normalizedBucket = normalizeAssetBucket(bucket);
    const normalizedPath = normalizeAssetPath(path);
    // Require a stable decoded path: do not decode percent escapes a second time.
    if (!normalizedBucket || !normalizedPath || normalizeAssetPath(normalizedPath) !== normalizedPath) return "";
    return `${normalizedBucket}/${normalizedPath}`;
  }

  function legacyPublicReference(value) {
    const reference = parsePublicRouteReference(value, supabaseOrigin, "/storage/v1/object/public/");
    if (!reference || !isAllowedPublicBucket(reference.bucket)) return null;
    // Preserve queries (including empty '?'), fragments, and noncanonical/encoded aliases.
    if (value !== canonicalSupabasePublicUrl(supabaseOrigin, reference.bucket, reference.path)) return null;
    return publicKey(reference.bucket, reference.path) ? reference : null;
  }

  function verifiedPublicUrl(bucket, path, session) {
    const key = publicKey(bucket, path);
    return key && isAllowedPublicBucket(bucket) && isCurrentPublicSession(session) && verifiedPublicKeys.has(key)
      ? canonicalPublicUrl(mediaOrigin, bucket, path)
      : "";
  }

  function requireMediaOrigin() {
    if (!mediaOrigin) throw mediaError("新しいメディア操作には HTTPS の mediaApiUrl が必要です。");
    return mediaOrigin;
  }

  async function requireSession() {
    if (typeof getSession !== "function") throw mediaError("認証セッション取得関数が設定されていません。");
    const value = await getSession();
    const session = value?.data?.session ?? value?.session ?? value;
    const accessToken = typeof session?.access_token === "string" ? session.access_token.trim() : "";
    if (!accessToken) throw mediaError("このメディア操作にはログインが必要です。");
    if (CONTROL_CHARACTER_PATTERN.test(accessToken)) throw mediaError("認証トークンが不正です。");
    return accessToken;
  }

  async function request(url, options) {
    if (typeof fetchImpl !== "function") throw mediaError("fetch 実装が設定されていません。");
    const response = await fetchImpl(url, options);
    return response;
  }

  function resolvePublicUrl(bucket, path) {
    const normalizedBucket = normalizeAssetBucket(bucket);
    const parsedPath = parseAssetPath(path);
    if (!normalizedBucket || !parsedPath) return "";
    const session = synchronousPublicSession();
    return verifiedPublicUrl(normalizedBucket, parsedPath.path, session)
      || canonicalSupabasePublicUrl(supabaseOrigin, normalizedBucket, parsedPath.path);
  }

  /** Verify only requested public objects. Returns verified keys; omitted keys remain legacy. */
  async function preparePublicPaths(bucket, paths) {
    const normalizedBucket = normalizeAssetBucket(bucket);
    if (!normalizedBucket || !Array.isArray(paths)) throw mediaError("公開画像の bucket/paths が不正です。");
    const keys = [...new Set(paths.map((path) => {
      const key = publicKey(normalizedBucket, path);
      if (!key) throw mediaError("公開画像の path が不正です。");
      return key;
    }))];
    if (!isAllowedPublicBucket(normalizedBucket) || keys.length === 0) return [];

    const session = await requirePublicSession();
    const pendingKeys = keys.filter((key) => !verifiedPublicKeys.has(key));
    const newlyVerified = new Set();
    for (let offset = 0; offset < pendingKeys.length; offset += PUBLIC_RESOLVE_BATCH_SIZE) {
      const current = await checkPublicAccount(session);
      const batchKeys = pendingKeys.slice(offset, offset + PUBLIC_RESOLVE_BATCH_SIZE);
      const response = await request(`${mediaOrigin}/v1/resolve-public`, {
        method: "POST",
        headers: createHeaderSet(current.accessToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ keys: batchKeys }),
        redirect: "error",
        credentials: "omit",
      });
      const body = await readJsonResponse(response);
      await checkPublicAccount(session);
      if (!body || !Array.isArray(body.keys)) throw mediaError("公開画像の検証応答 keys が不正です。");
      const requested = new Set(batchKeys);
      for (const key of body.keys) {
        if (typeof key !== "string" || !requested.has(key)) {
          throw mediaError("公開画像の検証応答に要求していない key が含まれています。");
        }
        newlyVerified.add(key);
      }
    }
    await checkPublicAccount(session);
    // Commit only after all batches and account checks succeed; errors cannot promote keys.
    if (!isCurrentPublicSession(session)) throw accountChangedError();
    for (const key of newlyVerified) verifiedPublicKeys.add(key);
    return keys.filter((key) => verifiedPublicKeys.has(key));
  }

  async function uploadImage(file, options = {}) {
    const mediaApiOrigin = requireMediaOrigin();
    const bucket = normalizeAssetBucket(options.bucket);
    const rule = bucket && Object.hasOwn(MEDIA_BUCKET_RULES, bucket) ? MEDIA_BUCKET_RULES[bucket] : null;
    if (!rule) throw mediaError("bucket は comment-assets、reaction-assets、question-assets のいずれかです。");

    const contentType = typeof file?.type === "string" ? file.type.toLowerCase() : "";
    if (!MEDIA_IMAGE_TYPE_SET.has(contentType)) throw mediaError("PNG・JPEG・WebP・GIF 画像のみアップロードできます。");
    if (bucket === QUESTION_ASSET_BUCKET && contentType === "image/gif") {
      throw mediaError("question-assets では GIF を利用できません。");
    }

    const collectionHeaders = normalizeCollectionHeaders(options);
    const uploadSession = bucket !== QUESTION_ASSET_BUCKET ? await requirePublicSession() : null;
    const token = uploadSession ? null : await requireSession();
    const declaredSize = typeof file?.size === "number" && Number.isFinite(file.size) ? file.size : null;
    if (declaredSize != null && (declaredSize < 0 || declaredSize > rule.maxBytes)) {
      throw mediaError(`${bucket} の画像サイズ上限は ${rule.maxBytes / BYTES_PER_MIB}MiB です。`);
    }
    const bytes = await readFileBytes(file);
    if (bytes.byteLength > rule.maxBytes) {
      throw mediaError(`${bucket} の画像サイズ上限は ${rule.maxBytes / BYTES_PER_MIB}MiB です。`);
    }
    const digest = await sha256Hex(bytes);

    const uploadToken = uploadSession ? (await checkPublicAccount(uploadSession)).accessToken : token;
    const headers = createHeaderSet(uploadToken, {
      "Content-Type": contentType,
      "X-Asset-Bucket": bucket,
      "X-Asset-SHA256": digest,
    });
    if (collectionHeaders.shareSlug) headers["X-Collection-Slug"] = collectionHeaders.shareSlug;
    if (collectionHeaders.collectionId) headers["X-Collection-Id"] = collectionHeaders.collectionId;

    const response = await request(`${mediaApiOrigin}/v1/assets`, {
      method: "POST",
      headers,
      body: bytes,
    });
    const body = await readJsonResponse(response);
    const uploaded = normalizeUploadResponse(body, bucket, bytes, digest, mediaApiOrigin);
    if (uploadSession) {
      await checkPublicAccount(uploadSession);
      if (!isCurrentPublicSession(uploadSession)) throw accountChangedError();
      const key = publicKey(uploaded.bucket, uploaded.path);
      if (key) verifiedPublicKeys.add(key);
    }
    return uploaded;
  }

  async function removeImage(bucket, path) {
    const mediaApiOrigin = requireMediaOrigin();
    const normalizedBucket = normalizeAssetBucket(bucket);
    const normalizedPath = normalizeAssetPath(path);
    if (!normalizedBucket || !normalizedPath) throw mediaError("削除対象の bucket/path が不正です。");
    const token = await requireSession();
    const response = await request(`${mediaApiOrigin}/v1/assets`, {
      method: "DELETE",
      headers: createHeaderSet(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ bucket: normalizedBucket, path: normalizedPath }),
    });
    assertResponseOk(response);
  }

  function rewriteVerifiedPublicPayload(payload, session) {
    return mapPayloadSync(payload, (value) => {
      const reference = legacyPublicReference(value);
      if (!reference) return value;
      return verifiedPublicUrl(reference.bucket, reference.path, session) || value;
    });
  }

  function rewritePublicPayload(payload) {
    if (!mediaOrigin || !supabaseOrigin) return cloneValue(payload);
    return rewriteVerifiedPublicPayload(payload, synchronousPublicSession());
  }

  /** Async session getters should use this method; sync helpers require a live sync session. */
  async function resolvePublicPayload(payload) {
    const pathsByBucket = new Map();
    const cloned = mapPayloadSync(payload, (value) => {
      const reference = legacyPublicReference(value);
      if (reference) {
        if (!pathsByBucket.has(reference.bucket)) pathsByBucket.set(reference.bucket, new Set());
        pathsByBucket.get(reference.bucket).add(reference.path);
      }
      return value;
    });
    if (pathsByBucket.size === 0) return cloned;
    const session = await requirePublicSession();
    for (const [bucket, paths] of pathsByBucket) {
      await checkPublicAccount(session);
      await preparePublicPaths(bucket, [...paths]);
    }
    const current = await checkPublicAccount(session);
    if (!isCurrentPublicSession(current)) throw accountChangedError();
    return rewriteVerifiedPublicPayload(cloned, current);
  }

  async function externalizePayload(payload, options = {}) {
    assertNoBlobUrls(payload);
    const uploadByDataUrl = new Map();
    const normalizedOptions = {
      shareSlug: options.shareSlug,
      collectionId: options.collectionId,
    };

    return mapPayload(payload, async (value) => {
      const privateReference = parsePrivateReference(value, mediaOrigin, { allowSigned: true });
      if (privateReference) return privateReference.canonical;
      if (!isDataImageUrl(value)) return value;

      let uploadPromise = uploadByDataUrl.get(value);
      if (!uploadPromise) {
        uploadPromise = (async () => {
          const parsed = parseDataImageUrl(value);
          const file = makeEmbeddedImageFile(parsed);
          const uploaded = await uploadImage(file, {
            bucket: QUESTION_ASSET_BUCKET,
            ...normalizedOptions,
          });
          const stableSource = canonicalPrivateUrl(mediaOrigin, QUESTION_ASSET_BUCKET, uploaded.path);
          if (!stableSource) throw mediaError("question-assets の安定 URL を組み立てられません。");
          return stableSource;
        })();
        uploadByDataUrl.set(value, uploadPromise);
      }
      return uploadPromise;
    });
  }

  async function resolvePrivatePayload(payload) {
    const keys = [];
    const seenKeys = new Set();
    const cloned = await mapPayload(payload, (value) => {
      const reference = parsePrivateReference(value, mediaOrigin, { allowSigned: true });
      if (reference) {
        const key = `${reference.bucket}/${reference.path}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          keys.push(key);
        }
        return reference.canonical;
      }
      return value;
    });
    if (keys.length === 0) return cloned;

    const token = await requireSession();
    const resolvedUrls = Object.create(null);
    const mediaApiOrigin = requireMediaOrigin();
    for (let offset = 0; offset < keys.length; offset += PRIVATE_RESOLVE_BATCH_SIZE) {
      const batchKeys = keys.slice(offset, offset + PRIVATE_RESOLVE_BATCH_SIZE);
      const response = await request(`${mediaApiOrigin}/v1/resolve`, {
        method: "POST",
        headers: createHeaderSet(token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ keys: batchKeys }),
      });
      const body = await readJsonResponse(response);
      const urls = body && typeof body === "object" && body.urls && typeof body.urls === "object" ? body.urls : {};
      for (const key of batchKeys) {
        if (Object.prototype.hasOwnProperty.call(urls, key)) resolvedUrls[key] = urls[key];
      }
    }

    return mapPayload(cloned, (value) => {
      const reference = parsePrivateReference(value, mediaOrigin);
      if (!reference) return value;
      const key = `${reference.bucket}/${reference.path}`;
      const signedUrl = Object.prototype.hasOwnProperty.call(resolvedUrls, key) ? resolvedUrls[key] : null;
      if (typeof signedUrl !== "string") return value;
      const resolvedReference = parsePrivateReference(signedUrl, mediaOrigin, { allowSigned: true });
      if (
        !resolvedReference ||
        !resolvedReference.signed ||
        resolvedReference.bucket !== reference.bucket ||
        resolvedReference.path !== reference.path
      ) {
        return value;
      }
      return signedUrl;
    });
  }

  return Object.freeze({
    externalizePayload,
    preparePublicPaths,
    removeImage,
    resolvePrivatePayload,
    resolvePublicPayload,
    resolvePublicUrl,
    rewritePublicPayload,
    uploadImage,
  });
}
