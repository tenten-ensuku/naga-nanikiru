const REPORT_ID_PATTERN = /^[A-Za-z0-9_]{20,160}$/;
const MAX_REPORT_BYTES = 32 * 1024 * 1024;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const reportId = new URL(request.url).searchParams.get("report_id")?.trim() ?? "";
  if (!REPORT_ID_PATTERN.test(reportId)) return jsonError("NAGAレポートIDが正しくありません。", 400);

  try {
    const response = await fetch(`https://naga.dmv.nico/reports/${reportId}.json`, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      const status = response.status === 404 ? 404 : 502;
      return jsonError(status === 404 ? "NAGAレポートが見つかりません。" : "NAGAレポートを取得できませんでした。", status);
    }

    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_REPORT_BYTES) return jsonError("NAGAレポートのサイズが大きすぎます。", 413);
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_REPORT_BYTES) return jsonError("NAGAレポートのサイズが大きすぎます。", 413);

    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=300, s-maxage=3600",
      },
    });
  } catch {
    return jsonError("NAGAレポートとの通信に失敗しました。", 502);
  }
}
