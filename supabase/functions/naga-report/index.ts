import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "@supabase/supabase-js"

const REPORT_ID_PATTERN = /^[A-Za-z0-9_]{20,160}$/
const MAX_REPORT_BYTES = 32 * 1024 * 1024
const MAX_REQUESTS_PER_MINUTE = 20
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
}

type RequestBody = {
  reportId?: unknown
  sourceKind?: unknown
  sourceUrl?: unknown
  targetPlayerSeat?: unknown
  targetPlayerName?: unknown
  extractionPreset?: unknown
  extractionConfig?: unknown
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : ""
}

function normalizeSeat(value: unknown) {
  const seat = Number(value)
  return Number.isInteger(seat) && seat >= 0 && seat <= 3 ? seat : null
}

function normalizeExtractionConfig(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const threshold = Number(source.thresholdPercent)
  const maximum = Number(source.maxCandidates)
  const allowedDecisions = new Set(["discard", "call", "riichi"])
  const decisionTypes = Array.isArray(source.decisionTypes)
    ? source.decisionTypes.filter((item): item is string => typeof item === "string" && allowedDecisions.has(item))
    : []
  return {
    thresholdPercent: Number.isFinite(threshold) ? Math.min(50, Math.max(0.1, threshold)) : 5,
    decisionTypes: decisionTypes.length ? [...new Set(decisionTypes)] : ["discard", "call", "riichi"],
    modelRule: source.modelRule === "all" ? "all" : "any",
    maxCandidates: Number.isInteger(maximum) ? Math.min(300, Math.max(1, maximum)) : 100,
  }
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: { ...CORS_HEADERS, "cache-control": "private, no-store" },
  })
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (request.method !== "POST") return jsonResponse({ error: "POSTリクエストを使用してください。" }, 405)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")
  const authorization = request.headers.get("authorization")
  if (!supabaseUrl || !supabaseAnonKey) return jsonResponse({ error: "サーバー設定が不足しています。" }, 500)
  if (!authorization) return jsonResponse({ error: "ログインが必要です。" }, 401)

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData.user) return jsonResponse({ error: "ログイン情報を確認できません。" }, 401)

  let input: RequestBody
  try {
    input = await request.json() as RequestBody
  } catch {
    return jsonResponse({ error: "JSON形式のリクエストが必要です。" }, 400)
  }

  const reportId = cleanText(input.reportId, 160)
  if (!REPORT_ID_PATTERN.test(reportId)) return jsonResponse({ error: "NAGAレポートIDが正しくありません。" }, 400)

  const sourceKind = input.sourceKind === "naga_scene" ? "naga_scene" : "naga_match"
  const sourceUrl = cleanText(input.sourceUrl, 2000) || `https://naga.dmv.nico/htmls/report_viewer.html?report_id=${reportId}`
  const targetPlayerSeat = normalizeSeat(input.targetPlayerSeat)
  const targetPlayerName = cleanText(input.targetPlayerName, 80) || null
  const extractionPreset = input.extractionPreset === "custom" ? "custom" : "bad_moves"
  const extractionConfig = normalizeExtractionConfig(input.extractionConfig)

  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString()
  const { count, error: countError } = await supabase
    .from("generation_jobs")
    .select("id", { count: "exact", head: true })
    .eq("requested_by", authData.user.id)
    .gte("created_at", oneMinuteAgo)
  if (countError) return jsonResponse({ error: "利用回数を確認できませんでした。" }, 500)
  if ((count ?? 0) >= MAX_REQUESTS_PER_MINUTE) {
    return jsonResponse({ error: "短時間の解析回数が上限に達しました。少し待ってから再試行してください。" }, 429)
  }

  const { data: job, error: jobError } = await supabase
    .from("generation_jobs")
    .insert({
      requested_by: authData.user.id,
      source_kind: sourceKind,
      source_url: sourceUrl,
      source_report_id: reportId,
      target_player_seat: targetPlayerSeat,
      target_player_name: targetPlayerName,
      extraction_preset: extractionPreset,
      extraction_config: extractionConfig,
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  if (jobError || !job) return jsonResponse({ error: "解析ジョブを作成できませんでした。" }, 500)

  try {
    const upstream = await fetch(`https://naga.dmv.nico/reports/${reportId}.json`, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(25_000),
    })
    if (!upstream.ok) {
      const status = upstream.status === 404 ? 404 : 502
      const message = status === 404 ? "NAGAレポートが見つかりません。" : "NAGAレポートを取得できませんでした。"
      throw Object.assign(new Error(message), { status })
    }

    const declaredSize = Number(upstream.headers.get("content-length") || 0)
    if (declaredSize > MAX_REPORT_BYTES) throw Object.assign(new Error("NAGAレポートのサイズが大きすぎます。"), { status: 413 })
    const bytes = await upstream.arrayBuffer()
    if (bytes.byteLength > MAX_REPORT_BYTES) throw Object.assign(new Error("NAGAレポートのサイズが大きすぎます。"), { status: 413 })

    let report: unknown
    try {
      report = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      throw Object.assign(new Error("NAGAレポートのJSONを読み取れませんでした。"), { status: 502 })
    }

    await supabase
      .from("generation_jobs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", job.id)

    return jsonResponse({ jobId: job.id, report })
  } catch (error) {
    const message = error instanceof Error ? error.message : "NAGAレポートとの通信に失敗しました。"
    const status = typeof error === "object" && error && "status" in error && Number.isInteger(Number(error.status))
      ? Number(error.status)
      : 502
    await supabase
      .from("generation_jobs")
      .update({ status: "failed", error_message: message.slice(0, 1000), completed_at: new Date().toISOString() })
      .eq("id", job.id)
    return jsonResponse({ error: message }, status)
  }
})
