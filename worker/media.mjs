// Dedicated image service. Never proxy image bytes through Supabase.
const PUBLIC_BUCKETS = new Set(["naga-question-assets", "comment-assets", "reaction-assets"]);
const LIMITS = { "naga-question-assets": 10485760, "question-assets": 10485760, "comment-assets": 5242880, "reaction-assets": 1048576 };
const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("");
class MediaError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

export function validKey(key) {
  if (typeof key !== "string" || key.length > 1200 || /[\\%?#\x00-\x1f]/.test(key)) return false;
  const [bucket, ...segments] = key.split("/");
  return Boolean(LIMITS[bucket] && segments.length && segments.every(x => x && x !== "." && x !== ".."));
}
export function imageType(bytes) {
  const x = new Uint8Array(bytes);
  if (x.length >= 8 && x[0] === 137 && x[1] === 80 && x[2] === 78 && x[3] === 71 && x[4] === 13 && x[5] === 10 && x[6] === 26 && x[7] === 10) return "image/png";
  if (x.length >= 3 && x[0] === 255 && x[1] === 216 && x[2] === 255) return "image/jpeg";
  const matches = (offset, text) => x.length >= offset + text.length && [...text].every((c,i) => x[offset+i] === c.charCodeAt(0));
  if (matches(0,"GIF87a") || matches(0,"GIF89a")) return "image/gif";
  // RIFF length bytes are binary, not UTF-8. Compare the two signatures at byte offsets.
  if (matches(0,"RIFF") && matches(8,"WEBP")) return "image/webp";
  return "";
}
async function boundedBody(request, limit) {
  const stated = Number(request.headers.get("content-length"));
  if (stated > limit) throw new MediaError("画像の容量上限を超えています。", 413);
  if (!request.body) throw new MediaError("画像がありません。");
  const reader = request.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new MediaError("画像の容量上限を超えています。", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
async function equalSecret(a, b) {
  if (!a || !b) return false;
  const hashes = await Promise.all([a, b].map(x => crypto.subtle.digest("SHA-256", encoder.encode(x))));
  let diff = 0;
  const left = new Uint8Array(hashes[0]), right = new Uint8Array(hashes[1]);
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}
async function sign(key, expires, secret) {
  if (!secret || secret.length < 32) throw new MediaError("画像配信の設定が未完了です。", 503);
  const signingKey = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", signingKey, encoder.encode(key + "\n" + expires)));
}
function canonicalUrl(base, key) {
  const bucket = key.split("/")[0];
  return base + "/v1/" + (PUBLIC_BUCKETS.has(bucket) ? "public/" : "private/") + key.split("/").map(encodeURIComponent).join("/");
}
function imageCacheRequest(url) {
  return new Request(url.origin + url.pathname + "?media-cache=v230-mime", { method: "GET" });
}
function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const allowed = String(env.ALLOWED_ORIGINS || "https://tenten-ensuku.github.io").split(",").map(x => x.trim());
  const headers = new Headers({ "X-Content-Type-Options": "nosniff", Vary: "Origin" });
  if (origin && allowed.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, HEAD, POST, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Asset-Bucket, X-Collection-Slug, X-Collection-Id, X-Asset-SHA256, X-Asset-Key");
    headers.set("Access-Control-Expose-Headers", "ETag, Content-Length");
  }
  return headers;
}
export function createMediaWorker({ fetchImpl = fetch, cache = null, now = () => Date.now() } = {}) {
  async function api(env, route, { token, body, method = "POST", service = false } = {}) {
    const apiKey = service ? env.SUPABASE_SECRET_KEY : env.SUPABASE_PUBLISHABLE_KEY;
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(env.SUPABASE_URL || "") || !apiKey) throw new MediaError("画像保存の設定が未完了です。", 503);
    const response = await fetchImpl(env.SUPABASE_URL + route, {
      method, headers: { apikey: apiKey, Authorization: "Bearer " + (service ? apiKey : token), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12000)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = String(data?.message || data?.error || "");
      if (response.status === 402) throw new MediaError("保存サービスは利用制限中です。自動再試行は行いません。", 402);
      if (message.includes("media_storage_limit")) throw new MediaError("保存容量の安全上限に達しました。", 507);
      if (message.includes("media_upload_rate_limit")) throw new MediaError("画像追加が集中しています。時間をおいてください。", 429);
      if (/media_asset_in_use|media_key_(conflict|retired)/.test(message)) throw new MediaError("参照中または処理済みの画像は変更できません。", 409);
      throw new MediaError("画像の操作を確認できませんでした。", response.status === 401 ? 401 : response.status === 403 || data?.code === "42501" ? 403 : 503);
    }
    return data;
  }
  const rpc = (env, name, body, token, service = false) => api(env, "/rest/v1/rpc/" + name, { body, token, service });
  async function user(request, env) {
    const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) throw new MediaError("Discordログインが必要です。", 401);
    const principal = await api(env, "/auth/v1/user", { method: "GET", token });
    if (!UUID.test(principal?.id || "")) throw new MediaError("ログインを確認できませんでした。", 401);
    return { id: principal.id, token };
  }
  async function upload(request, env, url, bot) {
    if (env.UPLOADS_ENABLED !== "true") throw new MediaError("画像の移行準備中です。", 503);
    let bucket, path, ownerId, collectionId;
    const collectionHeader = request.headers.get("x-collection-id");
    if (collectionHeader && !UUID.test(collectionHeader)) throw new MediaError("問題集の指定が不正です。");
    if (bot) {
      const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
      if (!await equalSecret(token, env.MEDIA_BOT_TOKEN)) throw new MediaError("認証が必要です。", 401);
      if (!String(env.BOT_COLLECTION_IDS || "").split(",").map(x => x.trim()).includes(collectionHeader)) throw new MediaError("対象外の問題集です。", 403);
      const key = request.headers.get("x-asset-key");
      if (!validKey(key) || !key.startsWith("naga-question-assets/" + collectionHeader + "/")) throw new MediaError("画像の保存先が不正です。");
      bucket = "naga-question-assets";
      path = key.slice(bucket.length + 1);
      const rows = await api(env, "/rest/v1/collections?id=eq." + collectionHeader + "&select=owner_id", { method: "GET", service: true });
      ownerId = rows?.[0]?.owner_id; collectionId = collectionHeader;
      if (!UUID.test(ownerId || "")) throw new MediaError("問題集を確認できません。", 403);
    } else {
      bucket = request.headers.get("x-asset-bucket");
      if (!["comment-assets","reaction-assets","question-assets"].includes(bucket)) throw new MediaError("画像の種類が不正です。");
      const principal = await user(request, env);
      const authorization = await rpc(env, "authorize_media_upload", {
        p_bucket: bucket, p_collection_id: collectionHeader || null,
        p_share_slug: request.headers.get("x-collection-slug") || null
      }, principal.token);
      if (authorization?.owner_id !== principal.id) throw new MediaError("保存権限を確認できません。", 403);
      ownerId = principal.id; collectionId = authorization.collection_id;
    }
    const bytes = await boundedBody(request, LIMITS[bucket]);
    const type = imageType(bytes);
    if (!type || request.headers.get("content-type")?.split(";")[0] !== type || (bucket === "question-assets" && type === "image/gif")) throw new MediaError("画像の実際の形式と指定が一致しません。", 415);
    const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
    if (request.headers.get("x-asset-sha256") !== sha256) throw new MediaError("画像の整合性を確認できません。", 422);
    if (bot && path !== collectionId + "/" + sha256 + "." + EXT[type]) throw new MediaError("画像名と内容が一致しません。", 422);
    path ||= ownerId + "/" + (bucket === "comment-assets" ? "comments/" : bucket === "reaction-assets" ? "reactions/" : "questions/" + collectionId + "/") + sha256 + "." + EXT[type];
    const key = bucket + "/" + path;
    if (!validKey(key)) throw new MediaError("画像の保存先が不正です。");
    await rpc(env, "reserve_media_asset", { p_bucket: bucket, p_path: path, p_owner_id: ownerId,
      p_collection_id: collectionId || null, p_size_bytes: bytes.length, p_sha256: sha256, p_content_type: type }, null, true);
    const existing = await env.IMAGES.head(key);
    if (existing && (existing.size !== bytes.length || existing.customMetadata?.sha256 !== sha256)) throw new MediaError("保存先の画像が一致しません。", 409);
    if (!existing) {
      const stored = await env.IMAGES.put(key, bytes, { sha256, httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" },
        customMetadata: { sha256 }, storageClass: "Standard", onlyIf: { etagDoesNotMatch: "*" } });
      const confirmed = stored || await env.IMAGES.head(key);
      if (!confirmed || confirmed.size !== bytes.length || confirmed.customMetadata?.sha256 !== sha256) {
        throw new MediaError("画像の保存完了を確認できません。", 409);
      }
    }
    await rpc(env, "complete_media_asset", { p_key: key, p_sha256: sha256 }, null, true);
    return { bucket, path, src: canonicalUrl(url.origin, key), size: bytes.length, sha256, reused: Boolean(existing) };
  }
  async function serve(request, env, ctx, url, isPrivate) {
    const prefix = isPrivate ? "/v1/private/" : "/v1/public/";
    let key;
    try { key = decodeURIComponent(url.pathname.slice(prefix.length)); } catch { throw new MediaError("画像URLが不正です。"); }
    if (!validKey(key) || (isPrivate ? !key.startsWith("question-assets/") : !PUBLIC_BUCKETS.has(key.split("/")[0]))) throw new MediaError("画像が見つかりません。", 404);
    if (isPrivate) {
      const expires = Number(url.searchParams.get("expires"));
      if (!Number.isSafeInteger(expires) || expires < Math.floor(now()/1000) || expires > Math.floor(now()/1000) + 900) throw new MediaError("画像の表示期限が切れました。", 403);
      const expected = await sign(key, expires, env.MEDIA_SIGNING_KEY);
      if (!await equalSecret(expected, url.searchParams.get("signature"))) throw new MediaError("画像の表示権限がありません。", 403);
    }
    const cacheRequest = imageCacheRequest(url);
    const useCache = !isPrivate && request.method === "GET" && !request.headers.has("if-none-match") && !request.headers.has("range") && !/no-cache|no-store/.test(request.headers.get("cache-control") || "");
    if (useCache && cache) {
      const hit = await cache.match(cacheRequest);
      if (hit) return hit;
    }
    const object = request.method === "HEAD" ? await env.IMAGES.head(key) : await env.IMAGES.get(key, { onlyIf: request.headers });
    if (!object) throw new MediaError("画像が見つかりません。", 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    if (!EXT[headers.get("content-type")]) throw new MediaError("配信対象外のファイルです。", 415);
    headers.set("ETag", object.httpEtag);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", isPrivate ? "private, no-store" : "public, max-age=86400");
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
    if (request.method === "GET" && !object.body) return new Response(null, { status: 304, headers });
    headers.set("Content-Length", String(object.size));
    const response = new Response(request.method === "HEAD" ? null : object.body, { headers });
    if (useCache && cache) ctx.waitUntil(cache.put(cacheRequest, response.clone()));
    return response;
  }
  return {
    async fetch(request, env, ctx) {
      const headers = corsHeaders(request, env);
      try {
        if (!env.IMAGES) throw new MediaError("画像の移行準備中です。", 503);
        const url = new URL(request.url);
        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
        const json = value => new Response(JSON.stringify(value), { headers: { ...Object.fromEntries(headers), "Content-Type": "application/json", "Cache-Control": "no-store" } });
        if (["GET","HEAD"].includes(request.method) && (url.pathname.startsWith("/v1/public/") || url.pathname.startsWith("/v1/private/"))) {
          const result = await serve(request, env, ctx, url, url.pathname.startsWith("/v1/private/"));
          const outgoing = new Response(result.body, result);
          headers.forEach((value,key) => outgoing.headers.set(key,value));
          return outgoing;
        }
        if (request.method === "POST" && ["/v1/assets","/v1/bot/assets"].includes(url.pathname)) return json(await upload(request, env, url, url.pathname.includes("/bot/")));
        if (request.method === "POST" && url.pathname === "/v1/resolve-public") {
          const principal = await user(request, env);
          const { keys } = JSON.parse(new TextDecoder().decode(await boundedBody(request, 32768)));
          if (!Array.isArray(keys) || !keys.length || keys.length > 32 || keys.some(key => !validKey(key) || !PUBLIC_BUCKETS.has(key.split("/")[0]))) throw new MediaError("画像の指定が不正です。");
          const unique = [...new Set(keys)];
          const rows = await rpc(env,"resolve_public_media",{p_keys:unique},principal.token);
          if (!Array.isArray(rows) || rows.some(row => !unique.includes(row.object_key))) throw new MediaError("画像台帳の確認に失敗しました。",503);
          return json({keys:[...new Set(rows.map(row => row.object_key))]});
        }
        if (request.method === "POST" && url.pathname === "/v1/resolve") {
          const principal = await user(request, env);
          const { keys } = JSON.parse(new TextDecoder().decode(await boundedBody(request, 32768)));
          if (!Array.isArray(keys) || !keys.length || keys.length > 32 || keys.some(key => !validKey(key) || !key.startsWith("question-assets/"))) throw new MediaError("画像の指定が不正です。");
          const unique = [...new Set(keys)];
          const rows = await rpc(env, "resolve_private_media", { p_keys: unique }, principal.token);
          const authorizedKeys = new Set((Array.isArray(rows) ? rows : []).map(row => row.object_key));
          if (authorizedKeys.size !== unique.length || unique.some(key => !authorizedKeys.has(key))) throw new MediaError("画像の表示権限がありません。", 403);
          const expires = Math.floor(now()/1000) + 900;
          const urls = {};
          for (const key of unique) urls[key] = canonicalUrl(url.origin,key) + "?expires=" + expires + "&signature=" + await sign(key, expires, env.MEDIA_SIGNING_KEY);
          return json({ urls });
        }
        if (request.method === "DELETE" && url.pathname === "/v1/assets") {
          const principal = await user(request, env);
          const { bucket, path } = JSON.parse(new TextDecoder().decode(await boundedBody(request, 4096)));
          const key = bucket + "/" + path;
          if (!validKey(key) || !path.startsWith(principal.id + "/")) throw new MediaError("画像の削除権限がありません。", 403);
          const claimed = await rpc(env,"begin_media_asset_delete",{p_key:key,p_owner_id:principal.id},null,true);
          if (claimed) {
            try { await env.IMAGES.delete(key); }
            catch (error) { await rpc(env,"finish_media_asset_delete",{p_key:key,p_success:false},null,true); throw error; }
            await rpc(env,"finish_media_asset_delete",{p_key:key,p_success:true},null,true);
            if (cache) ctx.waitUntil(cache.delete(imageCacheRequest(new URL(canonicalUrl(url.origin,key)))));
          }
          return json({ deleted: Boolean(claimed) });
        }
        throw new MediaError("操作が見つかりません。", 404);
      } catch (error) {
        return new Response(JSON.stringify({ error: error instanceof MediaError ? error.message : "画像サービスでエラーが発生しました。" }),
          { status: error instanceof MediaError ? error.status : 503,
            headers: { ...Object.fromEntries(headers), "Content-Type": "application/json", "Cache-Control": "no-store" } });
      }
    },
    async scheduled(_event, env, ctx) {
      ctx.waitUntil((async () => {
        try {
          let cursor, bytes = 0, pages = 0;
          do {
            const page = await env.IMAGES.list({ cursor, limit: 1000 });
            bytes += page.objects.reduce((sum, object) => sum + object.size, 0);
            cursor = page.truncated ? page.cursor : undefined;
            if (++pages > 100) throw new Error("inventory_page_limit");
          } while (cursor);
          const usage = await rpc(env,"media_usage_snapshot",{p_actual_r2_bytes:bytes,p_inventory_error:null},null,true);
          console.log(JSON.stringify({ event: "media_daily_usage", ...usage }));
        } catch {
          // Do not present unknown usage as zero or repeatedly fetch object bodies.
          console.error(JSON.stringify({ event: "media_daily_usage", state: "unknown" }));
          await rpc(env,"media_usage_snapshot",{p_actual_r2_bytes:null,p_inventory_error:"inventory_unavailable"},null,true).catch(() => {});
        }
      })());
    }
  };
}
export default {
  fetch(request,env,ctx) { return createMediaWorker({ cache: globalThis.caches?.default }).fetch(request,env,ctx); },
  scheduled(event,env,ctx) { return createMediaWorker().scheduled(event,env,ctx); }
};
