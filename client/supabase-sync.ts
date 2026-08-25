import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

type RuntimeConfig = {
  supabaseUrl?: string;
  supabasePublishableKey?: string;
};

type LocalAttempt = {
  attemptId?: string;
  questionKey?: string;
  selected?: unknown;
  callDecision?: unknown;
  riichi?: unknown;
  judgeModel?: unknown;
  scoreMark?: unknown;
  responseTimeMs?: unknown;
  answeredAt?: unknown;
  serverQuestionId?: unknown;
};

type LocalState = {
  answerHistory?: LocalAttempt[];
  favorites?: string[];
  trashed?: string[];
  hidden?: string[];
  snoozed?: Record<string, unknown>;
  reviewSchedule?: Record<string, Record<string, unknown>>;
};

declare global {
  interface Window {
    NAGA_RUNTIME_CONFIG?: RuntimeConfig;
    NagaSupabase?: ReturnType<typeof buildApi>;
  }
}

const config = window.NAGA_RUNTIME_CONFIG ?? {};
const configured = Boolean(
  config.supabaseUrl?.startsWith("https://") &&
  config.supabasePublishableKey?.startsWith("sb_publishable_")
);
const client: SupabaseClient | null = configured
  ? createClient(config.supabaseUrl!, config.supabasePublishableKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

const AUTH_CALLBACK_QUERY_KEYS = ["error", "error_code", "error_description", "error_reason", "code", "state"];
const AUTH_CALLBACK_HASH_PATTERN = /(?:^|&)(?:access_token|refresh_token|code|error|error_code|state)=/;

function requireClient() {
  if (!client) throw new Error("Supabaseが未設定です。runtime-config.jsを設定してください。");
  return client;
}

function normalizeGrade(value: unknown) {
  const text = String(value ?? "");
  return (["💮", "◎", "〇", "△", "×"] as const).find((mark) => text.includes(mark)) ?? null;
}

function parseDate(value: unknown) {
  const date = new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

async function deterministicUuid(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes.slice(0, 16)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function currentSession() {
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session;
}

function dispatchSession(session: Session | null) {
  window.dispatchEvent(new CustomEvent("naga:authchange", { detail: { session, configured } }));
}

function clearAuthCallbackUrl() {
  const currentUrl = new URL(window.location.href);
  const hasAuthError = AUTH_CALLBACK_QUERY_KEYS.some((key) => currentUrl.searchParams.has(key));
  const hasAuthFragment = AUTH_CALLBACK_HASH_PATTERN.test(currentUrl.hash.slice(1));
  if (!hasAuthError && !hasAuthFragment) return false;

  for (const key of AUTH_CALLBACK_QUERY_KEYS) currentUrl.searchParams.delete(key);
  currentUrl.hash = "";
  window.history.replaceState(window.history.state, "", `${currentUrl.pathname}${currentUrl.search}` || "/");
  return hasAuthError;
}

function buildOAuthRedirectUrl() {
  const redirectTo = new URL(window.location.href);
  if (redirectTo.pathname.endsWith("/index.html")) {
    redirectTo.pathname = redirectTo.pathname.slice(0, -"index.html".length) || "/";
  }
  for (const key of AUTH_CALLBACK_QUERY_KEYS) redirectTo.searchParams.delete(key);
  redirectTo.hash = "";
  return redirectTo.toString();
}

async function signInWithDiscord() {
  const supabase = requireClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: buildOAuthRedirectUrl() },
  });
  if (error) throw error;
}

async function signOut() {
  const { error } = await requireClient().auth.signOut();
  if (error) throw error;
}

async function updateProfileDisplayName(displayName: string) {
  const normalized = displayName.trim();
  if (!normalized || Array.from(normalized).length > 5) {
    throw new Error("表示名は1〜5文字で入力してください。");
  }
  const session = await currentSession();
  if (!session?.user?.id) throw new Error("Discordログインが必要です。");
  const { data, error } = await requireClient()
    .from("profiles")
    .upsert({ id: session.user.id, display_name: normalized, updated_at: new Date().toISOString() }, { onConflict: "id" })
    .select("display_name")
    .single();
  if (error) throw error;
  return String(data?.display_name || normalized);
}

async function loadSharedCollection(shareSlug: string) {
  const supabase = requireClient();
  const [collection, questions] = await Promise.all([
    supabase.rpc("get_shared_collection", { p_share_slug: shareSlug }).maybeSingle(),
    (async () => {
      const pageSize = 500;
      const allQuestions: unknown[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const page = await supabase.rpc("get_shared_question_index", {
          p_share_slug: shareSlug,
          p_offset: offset,
          p_limit: pageSize,
        });
        if (page.error) throw page.error;
        const rows = page.data ?? [];
        allQuestions.push(...rows);
        if (rows.length < pageSize) return { rows: allQuestions, detailsDeferred: true };
      }
    })().catch(async (error) => {
      // 旧公開版のDBに軽量RPCがまだない場合だけ従来処理へ戻す。
      if (!String(error?.message || error).toLowerCase().includes("get_shared_question_index")) throw error;
      const pageSize = 1000;
      const allQuestions: unknown[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const page = await supabase.rpc("get_shared_questions_page", {
          p_share_slug: shareSlug,
          p_offset: offset,
          p_limit: pageSize,
        });
        if (page.error) throw page.error;
        const rows = page.data ?? [];
        allQuestions.push(...rows);
        if (rows.length < pageSize) return { rows: allQuestions, detailsDeferred: false };
      }
    }),
  ]);
  if (collection.error) throw collection.error;
  if (!collection.data) throw new Error("指定された問題集が見つかりません。");
  return { collection: collection.data, questions: questions.rows, detailsDeferred: questions.detailsDeferred };
}

async function loadSharedQuestionDetail(shareSlug: string, questionId: string) {
  const normalizedSlug = String(shareSlug ?? "").trim();
  const normalizedQuestionId = String(questionId ?? "").trim();
  if (!normalizedSlug || !normalizedQuestionId) throw new Error("問題を特定できませんでした。");
  const { data, error } = await requireClient().rpc("get_shared_question_detail", {
    p_share_slug: normalizedSlug,
    p_question_id: normalizedQuestionId,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

async function loadMyCollections() {
  const { data, error } = await requireClient().rpc("list_my_collections");
  if (error) throw error;
  return data ?? [];
}

async function loadCollectionDirectory() {
  const { data, error } = await requireClient().rpc("list_collection_directory");
  if (error) throw error;
  return data ?? [];
}

async function requestCollectionAccess(shareSlug: string, message = "") {
  const { data, error } = await requireClient().rpc("request_collection_access", {
    p_share_slug: shareSlug,
    p_message: message,
  });
  if (error) throw error;
  return data;
}

async function loadCollectionAccessRequests(collectionId: string) {
  const { data, error } = await requireClient().rpc("list_collection_access_requests", {
    p_collection_id: collectionId,
  });
  if (error) throw error;
  return data ?? [];
}

async function loadCollectionMembers(collectionId: string) {
  const { data, error } = await requireClient().rpc("list_collection_members", {
    p_collection_id: collectionId,
  });
  if (error) throw error;
  return data ?? [];
}

async function reviewCollectionAccess(requestId: string, approve: boolean, role = "viewer") {
  const { error } = await requireClient().rpc("review_collection_access", {
    p_request_id: requestId,
    p_approve: approve,
    p_role: role,
  });
  if (error) throw error;
}

async function revokeCollectionAccess(collectionId: string, userId: string) {
  const { error } = await requireClient().rpc("revoke_collection_access", {
    p_collection_id: collectionId,
    p_user_id: userId,
  });
  if (error) throw error;
}

async function setCollectionVisibility(collectionId: string, visibility: "private" | "request" | "public") {
  const { error } = await requireClient().rpc("set_collection_visibility", {
    p_collection_id: collectionId,
    p_visibility: visibility,
  });
  if (error) throw error;
}

async function transferCollectionOwnership(collectionId: string, userId: string) {
  const { error } = await requireClient().rpc("transfer_collection_ownership", {
    p_collection_id: collectionId,
    p_user_id: userId,
  });
  if (error) throw error;
}

async function loadCollectionNotifications(unreadOnly = false) {
  const { data, error } = await requireClient().rpc("list_collection_notifications", {
    p_unread_only: unreadOnly,
  });
  if (error) throw error;
  return data ?? [];
}

async function markCollectionNotificationsRead(notificationIds: string[] | null = null) {
  const { error } = await requireClient().rpc("mark_collection_notifications_read", {
    p_notification_ids: notificationIds,
  });
  if (error) throw error;
}

async function loadSharedComments(shareSlug: string, questionId?: string | null) {
  const { data, error } = await requireClient().rpc("get_shared_comments", {
    p_share_slug: shareSlug,
    p_question_id: questionId ?? null,
  });
  if (error) throw error;
  return data ?? [];
}

function publicCommentAssetUrl(path: string) {
  const normalized = String(path ?? "").replace(/^\/+/, "");
  if (!normalized || !config.supabaseUrl) return "";
  return `${config.supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/comment-assets/${normalized.split("/").map(encodeURIComponent).join("/")}`;
}

async function uploadCommentAttachment(file: File) {
  const session = await currentSession();
  if (!session?.user?.id) throw new Error("共有コメントの画像添付にはDiscordログインが必要です。");
  const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  if (!allowedTypes.has(file.type)) throw new Error("PNG・JPEG・WebP・GIF画像のみ添付できます。");
  if (file.size > 5 * 1024 * 1024) throw new Error("画像は1枚5MB以内にしてください。");
  const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[file.type] || "img";
  const path = `${session.user.id}/comments/${crypto.randomUUID()}.${extension}`;
  const { error } = await requireClient().storage.from("comment-assets").upload(path, file, {
    cacheControl: "31536000",
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  return { path, src: publicCommentAssetUrl(path), alt: file.name || "添付画像" };
}

async function removeCommentAttachment(path: string) {
  if (!path) return;
  const { error } = await requireClient().storage.from("comment-assets").remove([path]);
  if (error) throw error;
}

async function postSharedComment(shareSlug: string, body: string, questionId?: string | null, attachments: Array<{ path: string; alt?: string }> = []) {
  const { data, error } = await requireClient().rpc("post_shared_comment", {
    p_share_slug: shareSlug,
    p_question_id: questionId ?? null,
    p_body: body,
    p_attachments: attachments.map((attachment) => ({ path: attachment.path, alt: String(attachment.alt ?? "添付画像").slice(0, 200) })),
  });
  if (error) throw error;
  return data;
}

async function updateSharedComment(commentId: string, body: string, attachments: Array<{ path: string; alt?: string }> = []) {
  const { error } = await requireClient().rpc("update_shared_comment", {
    p_comment_id: commentId,
    p_body: body,
    p_attachments: attachments.map((attachment) => ({ path: attachment.path, alt: String(attachment.alt ?? "添付画像").slice(0, 200) })),
  });
  if (error) throw error;
}

async function deleteSharedComment(commentId: string) {
  const { data, error } = await requireClient().rpc("delete_shared_comment", { p_comment_id: commentId });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function recordSharedAttempt(input: {
  shareSlug: string;
  questionId: string;
  clientAttemptId?: string;
  answer: unknown;
  grade: string;
  elapsedMs?: number | null;
  answeredAt?: string;
}) {
  const { data, error } = await requireClient().rpc("record_shared_attempt", {
    p_share_slug: input.shareSlug,
    p_question_id: input.questionId,
    p_client_attempt_id: input.clientAttemptId ?? crypto.randomUUID(),
    p_answer: input.answer ?? {},
    p_grade: input.grade,
    p_elapsed_ms: input.elapsedMs ?? null,
    p_answered_at: input.answeredAt ?? new Date().toISOString(),
  });
  if (error) throw error;
  return data;
}

async function loadMyAttempts(limit = 500) {
  const session = await currentSession();
  if (!session?.user?.id) throw new Error("Discordログインが必要です。");
  const safeLimit = Math.min(500, Math.max(1, Math.floor(Number(limit) || 500)));
  const { data, error } = await requireClient()
    .from("answer_attempts")
    .select("client_attempt_id,question_id,answer,grade,elapsed_ms,answered_at")
    .eq("user_id", session.user.id)
    .order("answered_at", { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  return data ?? [];
}

async function loadMyAttemptsForCollection(shareSlug: string, limit = 5000) {
  const normalizedSlug = String(shareSlug ?? "").trim();
  if (!normalizedSlug) return [];
  const session = await currentSession();
  if (!session?.user?.id) throw new Error("Discordログインが必要です。");
  const safeLimit = Math.min(10000, Math.max(1, Math.floor(Number(limit) || 5000)));
  const pageSize = 5000;
  const rows: Array<Record<string, unknown>> = [];
  let offset = 0;
  while (rows.length < safeLimit) {
    const requestLimit = Math.min(pageSize, safeLimit - rows.length);
    const { data, error } = await requireClient().rpc("load_my_attempts_for_collection", {
      p_share_slug: normalizedSlug,
      p_limit: requestLimit,
      p_offset: offset,
    });
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < requestLimit) break;
    offset += page.length;
  }
  return rows;
}

async function getMyCapabilities() {
  const { data, error } = await requireClient().rpc("get_my_capabilities");
  if (error) throw error;
  return { isAdmin: Boolean(data?.[0]?.is_admin) };
}

async function createSharedQuestion(input: {
  shareSlug: string;
  title: string;
  payload: Record<string, unknown>;
  sourceKind?: "manual" | "discord" | "naga_scene" | "naga_match";
  sourceReportId?: string | null;
  sourceUrl?: string | null;
  sceneTw?: number | null;
  sceneTs?: number | null;
  sceneTv?: number | null;
  decisionType?: "discard" | "call" | "riichi" | "combined";
}) {
  const { data, error } = await requireClient().rpc("create_shared_question", {
    p_share_slug: input.shareSlug,
    p_title: input.title,
    p_payload: input.payload,
    p_source_kind: input.sourceKind ?? "manual",
    p_source_report_id: input.sourceReportId ?? null,
    p_source_url: input.sourceUrl ?? null,
    p_scene_tw: input.sceneTw ?? null,
    p_scene_ts: input.sceneTs ?? null,
    p_scene_tv: input.sceneTv ?? null,
    p_decision_type: input.decisionType ?? "discard",
  });
  if (error) throw error;
  return data as string;
}

async function updateSharedQuestion(questionId: string, title: string, payload: Record<string, unknown>) {
  const { error } = await requireClient().rpc("update_shared_question", {
    p_question_id: questionId,
    p_title: title,
    p_payload: payload,
  });
  if (error) throw error;
}

async function trashSharedQuestion(questionId: string) {
  const { error } = await requireClient().rpc("trash_question", { p_question_id: questionId });
  if (error) throw error;
}

async function restoreSharedQuestion(questionId: string) {
  const { error } = await requireClient().rpc("restore_question", { p_question_id: questionId });
  if (error) throw error;
}

async function requestQuestionDeletion(questionId: string, reason = "") {
  const { data, error } = await requireClient().rpc("request_question_deletion", {
    p_question_id: questionId,
    p_reason: reason,
  });
  if (error) throw error;
  return data as string;
}

async function resolveQuestionDeletionRequest(requestId: string, approve: boolean) {
  const { error } = await requireClient().rpc("resolve_question_deletion_request", {
    p_request_id: requestId,
    p_approve: approve,
  });
  if (error) throw error;
}

async function permanentlyDeleteQuestion(questionId: string, confirmation: string) {
  const { error } = await requireClient().rpc("permanently_delete_question", {
    p_question_id: questionId,
    p_confirmation: confirmation,
  });
  if (error) throw error;
}

async function loadQuestionPollStats(shareSlug: string, questionId: string) {
  const { data, error } = await requireClient().rpc("get_question_poll_stats", {
    p_share_slug: shareSlug,
    p_question_id: questionId,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

async function fetchNagaReport(input: Record<string, unknown>) {
  const { data, error } = await requireClient().functions.invoke("naga-report", { body: input });
  if (error) throw error;
  if (!data?.report) throw new Error("NAGAレポートを読み取れませんでした。");
  return data as { jobId: string; report: unknown };
}

async function captureNagaScene(input: {
  jobId: string;
  reportId: string;
  tw: number;
  ts: number;
  tv: number;
}) {
  const session = await currentSession();
  if (!session) throw new Error("Discordログインが必要です。");
  const response = await fetch(`${config.supabaseUrl}/functions/v1/naga-capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: config.supabasePublishableKey!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    let message = "NAGA局面画像を自動取得できませんでした。";
    try {
      const body = await response.json() as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) message = body.error;
    } catch {
      // Keep the stable fallback message when the provider returned a non-JSON error.
    }
    throw new Error(message);
  }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0] || "";
  if (!contentType.startsWith("image/")) throw new Error("自動取得した局面画像の形式が正しくありません。");
  const image = await response.blob();
  if (!image.size) throw new Error("自動取得した局面画像が空です。");
  return image;
}

async function importLocalHistory(state: LocalState) {
  const supabase = requireClient();
  const session = await currentSession();
  if (!session) throw new Error("Discordログインが必要です。");

  const attempts = Array.isArray(state.answerHistory) ? state.answerHistory : [];
  const keys = [...new Set(attempts
    .filter((item) => !item.serverQuestionId)
    .map((item) => String(item.questionKey ?? ""))
    .filter(Boolean))];
  const questionRows: Array<{ id: string; legacy_key: string | null }> = [];
  for (let index = 0; index < keys.length; index += 100) {
    const { data, error } = await supabase
      .from("questions")
      .select("id,legacy_key")
      .in("legacy_key", keys.slice(index, index + 100));
    if (error) throw error;
    questionRows.push(...(data ?? []));
  }
  const questionByKey = new Map(questionRows.map((row) => [row.legacy_key, row.id]));
  const rows = [];
  let skipped = 0;
  for (const attempt of attempts) {
    const key = String(attempt.questionKey ?? "");
    const explicitQuestionId = typeof attempt.serverQuestionId === "string" && /^[0-9a-f-]{36}$/i.test(attempt.serverQuestionId)
      ? attempt.serverQuestionId
      : null;
    const questionId = explicitQuestionId ?? questionByKey.get(key);
    const grade = normalizeGrade(attempt.scoreMark);
    if (!questionId || !grade) {
      skipped += 1;
      continue;
    }
    const attemptKey = String(attempt.attemptId ?? `${key}:${attempt.answeredAt ?? ""}:${attempt.selected ?? ""}`);
    rows.push({
      client_attempt_id: await deterministicUuid(`naga-local:${attemptKey}`),
      user_id: session.user.id,
      question_id: questionId,
      answer: {
        selected: attempt.selected ?? null,
        callDecision: attempt.callDecision ?? null,
        riichi: attempt.riichi ?? null,
        judgeModel: attempt.judgeModel ?? null,
      },
      grade,
      elapsed_ms: Number.isFinite(Number(attempt.responseTimeMs)) ? Math.max(0, Number(attempt.responseTimeMs)) : null,
      answered_at: parseDate(attempt.answeredAt),
    });
  }
  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await supabase
      .from("answer_attempts")
      .upsert(rows.slice(index, index + 100), { onConflict: "user_id,client_attempt_id" });
    if (error) throw error;
  }
  return {
    imported: rows.length,
    skipped,
    missingQuestionKeys: keys.filter((key) => !questionByKey.has(key)),
  };
}

async function loadStudentSummaries() {
  const { data, error } = await requireClient()
    .from("student_learning_summary")
    .select("*")
    .order("last_answered_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

async function loadMemberships() {
  const { data, error } = await requireClient()
    .from("workspace_members")
    .select("workspace_id,role,status")
    .eq("status", "active");
  if (error) throw error;
  return data ?? [];
}

async function loadStudentAttempts(studentUserId: string, limit = 100) {
  const { data, error } = await requireClient()
    .from("answer_attempts")
    .select("id,question_id,answer,grade,elapsed_ms,answered_at")
    .eq("user_id", studentUserId)
    .order("answered_at", { ascending: false })
    .limit(Math.min(500, Math.max(1, limit)));
  if (error) throw error;
  return data ?? [];
}

async function createCollection(input: {
  title: string;
  description?: string;
  workspaceId?: string | null;
  visibility?: "private" | "request" | "public";
  allowContributions?: boolean;
}) {
  const session = await currentSession();
  if (!session) throw new Error("Discordログインが必要です。");
  const visibility = input.visibility ?? "private";
  if (!["private", "request", "public"].includes(visibility)) {
    throw new Error("公開範囲はプライベート・承認許可制・全体公開から選択してください。");
  }
  const { data, error } = await requireClient().rpc("create_collection", {
    p_title: input.title,
    p_description: input.description ?? "",
    p_workspace_id: input.workspaceId ?? null,
    p_visibility: visibility,
    p_allow_contributions: input.allowContributions ?? true,
  });
  if (error) throw error;
  return data;
}

async function importSharedQuestion(sourceQuestionId: string, targetShareSlug: string) {
  const { data, error } = await requireClient().rpc("import_shared_question", {
    p_source_question_id: sourceQuestionId,
    p_target_share_slug: targetShareSlug,
  });
  if (error) throw error;
  return data;
}

function buildApi() {
  return {
    configured,
    client,
    currentSession,
    signInWithDiscord,
    signOut,
    updateProfileDisplayName,
    loadSharedCollection,
    loadSharedQuestionDetail,
    loadMyCollections,
    loadCollectionDirectory,
    requestCollectionAccess,
    loadCollectionAccessRequests,
    loadCollectionMembers,
    reviewCollectionAccess,
    revokeCollectionAccess,
    setCollectionVisibility,
    transferCollectionOwnership,
    loadCollectionNotifications,
    markCollectionNotificationsRead,
    loadSharedComments,
    publicCommentAssetUrl,
    uploadCommentAttachment,
    removeCommentAttachment,
    postSharedComment,
    updateSharedComment,
    deleteSharedComment,
    recordSharedAttempt,
    loadMyAttempts,
    loadMyAttemptsForCollection,
    getMyCapabilities,
    createSharedQuestion,
    updateSharedQuestion,
    trashSharedQuestion,
    restoreSharedQuestion,
    requestQuestionDeletion,
    resolveQuestionDeletionRequest,
    permanentlyDeleteQuestion,
    loadQuestionPollStats,
    fetchNagaReport,
    captureNagaScene,
    importLocalHistory,
    loadStudentSummaries,
    loadMemberships,
    loadStudentAttempts,
    createCollection,
    importSharedQuestion,
  };
}

window.NagaSupabase = buildApi();
if (client) {
  client.auth.onAuthStateChange((_event, session) => {
    const hadAuthError = clearAuthCallbackUrl();
    dispatchSession(session);
    if (hadAuthError && !session) {
      window.dispatchEvent(new CustomEvent("naga:autherror", {
        detail: { message: "認証状態を確認できませんでした。もう一度ログインしてください。" },
      }));
    }
  });
  currentSession().then((session) => {
    clearAuthCallbackUrl();
    dispatchSession(session);
  }).catch(() => {
    clearAuthCallbackUrl();
    dispatchSession(null);
    window.dispatchEvent(new CustomEvent("naga:autherror", {
      detail: { message: "認証状態を確認できませんでした。もう一度ログインしてください。" },
    }));
  });
} else {
  queueMicrotask(() => dispatchSession(null));
}
