export const OPS_CAPACITY_RPC = "ops_capacity_status"
export const OPS_CAPACITY_BLOCKED_MESSAGE = "容量確認により重い処理は一時停止中です。しばらくしてから再試行してください。"
export const OPS_CAPACITY_UNAVAILABLE_MESSAGE = "容量確認を完了できないため、重い処理を一時保留しています。しばらくしてから再試行してください。"
export const OPS_CAPACITY_TIMEOUT_MS = 5_000

export type OpsCapacityStatus = {
  blocked: boolean
  reason: string
  checkedAt: string | null
}

export type OpsCapacityDecision =
  | { kind: "allowed"; status: OpsCapacityStatus }
  | { kind: "blocked"; status: OpsCapacityStatus; message: string }
  | { kind: "unavailable"; message: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function normalizeOpsCapacityStatus(value: unknown): OpsCapacityStatus | null {
  if (!isRecord(value) || typeof value.blocked !== "boolean" || typeof value.reason !== "string") return null
  if (!("checkedAt" in value)) return null

  // The RPC intentionally does not expose the private controller's `armed`
  // key; its armed/stale decision is already resolved into `blocked`.
  const checkedAtValue = value.checkedAt
  if (!(checkedAtValue === null || typeof checkedAtValue === "string")) return null
  const checkedAt: string | null = checkedAtValue === null ? null : checkedAtValue as string
  return {
    blocked: value.blocked,
    reason: value.reason.slice(0, 500),
    checkedAt,
  }
}

function unavailable(): OpsCapacityDecision {
  return { kind: "unavailable", message: OPS_CAPACITY_UNAVAILABLE_MESSAGE }
}

async function discardResponseBody(response: Response) {
  try {
    await response.body?.cancel()
  } catch {
    // The capacity decision is already unavailable; do not expose transport details.
  }
}

export async function checkOpsCapacity({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl = fetch,
}: {
  supabaseUrl: string
  serviceRoleKey?: string | null
  fetchImpl?: typeof fetch
}): Promise<OpsCapacityDecision> {
  const baseUrl = String(supabaseUrl || "").trim().replace(/\/+$/, "")
  const key = String(serviceRoleKey || "").trim()
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(baseUrl) || !key) return unavailable()

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OPS_CAPACITY_TIMEOUT_MS)
  try {
    // This is a single service_role-only RPC check. It intentionally has no retry loop.
    const response = await fetchImpl(`${baseUrl}/rest/v1/rpc/${OPS_CAPACITY_RPC}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: controller.signal,
    })
    if (!response.ok) {
      await discardResponseBody(response)
      return unavailable()
    }
    const status = normalizeOpsCapacityStatus(await response.json())
    if (!status) return unavailable()
    if (status.blocked) return { kind: "blocked", status, message: OPS_CAPACITY_BLOCKED_MESSAGE }
    return { kind: "allowed", status }
  } catch {
    return unavailable()
  } finally {
    clearTimeout(timeout)
  }
}
