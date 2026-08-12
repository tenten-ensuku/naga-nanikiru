import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "@supabase/supabase-js"

const REPORT_ID_PATTERN = /^[A-Za-z0-9_]{20,160}$/
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
}

type CaptureRequest = {
  jobId?: unknown
  reportId?: unknown
  tw?: unknown
  ts?: unknown
  tv?: unknown
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { ...CORS_HEADERS, "cache-control": "private, no-store" },
  })
}

function integerInRange(value: unknown, minimum: number, maximum: number) {
  const number = Number(value)
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : null
}

function canonicalSceneUrl(reportId: string, tw: number, ts: number, tv: number) {
  const url = new URL("https://naga.dmv.nico/htmls/report_viewer.html")
  url.searchParams.set("report_id", reportId)
  url.searchParams.set("tw", String(tw))
  url.searchParams.set("ts", String(ts))
  url.searchParams.set("tv", String(tv))
  return url.href
}

function decodeBase64(value: string) {
  const normalized = value.replace(/^data:[^,]+,/, "").replace(/\s+/g, "")
  const binary = atob(normalized)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function decodeBrowserlessJson(value: unknown) {
  const payload = value && typeof value === "object" && "data" in value
    ? (value as { data?: unknown }).data
    : value
  if (typeof payload === "string") return decodeBase64(payload)
  if (Array.isArray(payload) && payload.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return Uint8Array.from(payload)
  }
  if (payload && typeof payload === "object" && "data" in payload) {
    const bytes = (payload as { data?: unknown }).data
    if (Array.isArray(bytes) && bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      return Uint8Array.from(bytes)
    }
  }
  return null
}

function detectImageType(bytes: Uint8Array) {
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    return "image/webp"
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png"
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }
  return null
}

const CAPTURE_FUNCTION = String.raw`
export default async ({ page, context }) => {
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto(context.sceneUrl, { waitUntil: "networkidle2", timeout: 30000 });
  await page.waitForSelector(".column.is-three-quarter img", { visible: true, timeout: 30000 });
  const hideElement = await page.$('input[type="checkbox"][data-off-label="伏牌"]');
  if (!hideElement) throw new Error("NAGA hidden-hand control was not found");

  const setOtherHandsHidden = async (hidden) => {
    const previousSource = await page.$eval(".column.is-three-quarter img", (image) => image.src);
    const changed = await page.evaluate((checkbox, next) => {
      if (checkbox.checked === next) return false;
      checkbox.click();
      return true;
    }, hideElement, hidden);
    if (changed && hidden) {
      await page.waitForFunction(
        (before) => document.querySelector(".column.is-three-quarter img")?.src !== before,
        { timeout: 10000 },
        previousSource
      );
    }
    await page.waitForFunction(
      (expected) => {
        const checkbox = document.querySelector('input[type="checkbox"][data-off-label="伏牌"]');
        return checkbox?.checked === expected;
      },
      { timeout: 10000 },
      hidden
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
  };

  // Force a full redraw, then finish in the only supported state: 伏牌 ON.
  // The redraw prevents an initial open-hand frame from being copied before Vue updates the board.
  await setOtherHandsHidden(false);
  await setOtherHandsHidden(true);
  const source = await page.$eval(".column.is-three-quarter img", (image) => image.src);
  if (!source || !source.startsWith("data:image/png;base64,")) {
    throw new Error("NAGA board image was not generated");
  }
  await page.setViewport({ width: 1400, height: 1300, deviceScaleFactor: 1 });
  await page.setContent(
    '<!doctype html><html><head><style>html,body{margin:0;width:1400px;height:1300px;overflow:hidden;background:#075b91}img{display:block;width:1400px;height:1300px}</style></head><body><img id="scene" src="' + source + '"></body></html>',
    { waitUntil: "load" }
  );
  await page.waitForSelector("#scene", { visible: true, timeout: 10000 });
  return await page.screenshot({
    type: "webp",
    quality: 86,
    clip: { x: 0, y: 0, width: 1400, height: 1300 }
  });
};`

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (request.method !== "POST") return jsonResponse({ error: "POSTリクエストを使用してください。" }, 405)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")
  const browserlessToken = Deno.env.get("BROWSERLESS_API_TOKEN")
  const browserlessEndpoint = (Deno.env.get("BROWSERLESS_ENDPOINT") || "https://production-sfo.browserless.io").replace(/\/+$/, "")
  const authorization = request.headers.get("authorization")
  if (!supabaseUrl || !supabaseAnonKey) return jsonResponse({ error: "サーバー設定が不足しています。" }, 500)
  if (!browserlessToken) return jsonResponse({ error: "自動撮影サービスは現在準備中です。手動画像を使用してください。" }, 503)
  if (!authorization) return jsonResponse({ error: "Discordログインが必要です。" }, 401)
  if (!browserlessEndpoint.startsWith("https://")) return jsonResponse({ error: "自動撮影サービスの接続先が正しくありません。" }, 500)

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return jsonResponse({ error: "ログイン情報を確認できません。" }, 401)

  let input: CaptureRequest
  try {
    input = await request.json() as CaptureRequest
  } catch {
    return jsonResponse({ error: "JSON形式のリクエストが必要です。" }, 400)
  }

  const jobId = typeof input.jobId === "string" ? input.jobId.trim() : ""
  const reportId = typeof input.reportId === "string" ? input.reportId.trim() : ""
  const tw = integerInRange(input.tw, 0, 3)
  const ts = integerInRange(input.ts, 0, 999)
  const tv = integerInRange(input.tv, 0, 9999)
  if (!JOB_ID_PATTERN.test(jobId) || !REPORT_ID_PATTERN.test(reportId) || tw == null || ts == null || tv == null) {
    return jsonResponse({ error: "局面指定が正しくありません。" }, 400)
  }

  const { data: job, error: jobError } = await supabase
    .from("generation_jobs")
    .select("id,status,source_report_id,requested_by")
    .eq("id", jobId)
    .eq("requested_by", authData.user.id)
    .eq("source_report_id", reportId)
    .maybeSingle()
  if (jobError) return jsonResponse({ error: "生成ジョブを確認できませんでした。" }, 500)
  if (!job || job.status !== "completed") return jsonResponse({ error: "先にNAGA局面を解析してください。" }, 403)

  try {
    const endpoint = new URL(`${browserlessEndpoint}/function`)
    endpoint.searchParams.set("token", browserlessToken)
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "cache-control": "no-cache" },
      body: JSON.stringify({
        code: CAPTURE_FUNCTION,
        context: { sceneUrl: canonicalSceneUrl(reportId, tw, ts, tv) },
      }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!upstream.ok) {
      const details = (await upstream.text()).slice(0, 300)
      console.error("Browserless capture failed", upstream.status, details)
      return jsonResponse({ error: "NAGA局面画像を自動取得できませんでした。手動画像を使用してください。" }, 502)
    }
    const upstreamContentType = upstream.headers.get("content-type")?.split(";", 1)[0] || ""
    const upstreamBody = new Uint8Array(await upstream.arrayBuffer())
    if (!upstreamBody.byteLength || upstreamBody.byteLength > MAX_IMAGE_BYTES) {
      return jsonResponse({ error: "自動取得した局面画像のサイズが正しくありません。" }, 502)
    }
    let image = upstreamBody
    if (upstreamContentType === "application/json") {
      try {
        const decoded = decodeBrowserlessJson(JSON.parse(new TextDecoder().decode(upstreamBody)))
        if (decoded) image = decoded
      } catch (error) {
        console.error("Browserless JSON image decode failed", error instanceof Error ? error.message : error)
      }
    }
    const contentType = detectImageType(image)
    if (!contentType) {
      console.error("Browserless returned an unexpected image payload", upstreamContentType, image.byteLength)
      return jsonResponse({ error: "自動取得した局面画像の形式が正しくありません。" }, 502)
    }
    if (image.byteLength > MAX_IMAGE_BYTES) {
      return jsonResponse({ error: "自動取得した局面画像のサイズが正しくありません。" }, 502)
    }
    return new Response(image, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "content-type": contentType,
        "content-length": String(image.byteLength),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    })
  } catch (error) {
    console.error("NAGA capture error", error instanceof Error ? error.message : error)
    return jsonResponse({ error: "NAGA局面画像の自動取得に失敗しました。手動画像を使用してください。" }, 502)
  }
})
