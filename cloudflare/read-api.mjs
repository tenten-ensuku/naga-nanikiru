import {
  ApiError,
  canAccessCollection,
  canManageCollection,
  canEditCollection,
  canViewStudent,
  requireActor,
} from "./access.mjs";

// This is the complete read-only surface owned by this sidecar.  Any RPC not
// listed here is rejected before it can become an arbitrary SQL entry point.
export const READ_RPCS = Object.freeze([
  "get_shared_collection",
  "get_shared_question_index_page",
  "get_shared_question_index",
  "get_shared_question_detail",
  "get_collection_volumes",
  "get_collection_volume_progress",
  "get_collection_library_summary",
  "get_shared_comments",
  "get_shared_comment_changes",
  "load_my_attempts_for_collection",
  "list_my_collections",
  "list_collection_directory",
  "list_collection_access_requests",
  "list_collection_members",
  "list_collection_notifications",
  "get_my_capabilities",
  "get_shared_reaction_summary",
  "list_custom_reactions",
  "get_question_poll_stats",
]);

const READ_TABLES = Object.freeze([
  "questions",
  "answer_attempts",
  "student_learning_summary",
  "workspace_members",
]);

const READ_RPC_SET = new Set(READ_RPCS);
// These original endpoints belonged to the authenticated role. Keep that
// boundary here too, not solely in a future HTTP router or browser UI.
const AUTHENTICATED_READ_RPCS = new Set([
  'get_collection_library_summary', 'get_shared_comment_changes',
  'load_my_attempts_for_collection', 'list_my_collections',
  'list_collection_directory', 'list_collection_access_requests',
  'list_collection_members', 'list_collection_notifications',
  'get_my_capabilities', 'get_shared_reaction_summary',
  'list_custom_reactions', 'get_question_poll_stats',
]);
const READ_TABLE_SET = new Set(READ_TABLES);
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const COLLECTION_ACCESS_EXPR = `(
  c.owner_id = actor.user_id
  OR actor.is_admin = 1
  OR (c.published_at IS NOT NULL AND c.visibility IN ('public', 'unlisted'))
  OR (
    c.visibility = 'workspace'
    AND EXISTS (
      SELECT 1 FROM workspace_members workspace_member
       WHERE workspace_member.workspace_id = c.workspace_id
         AND workspace_member.user_id = actor.user_id
         AND workspace_member.status = 'active'
    )
  )
  OR (
    c.visibility IN ('private', 'limited', 'request')
    AND EXISTS (
      SELECT 1 FROM collection_members collection_member
       WHERE collection_member.collection_id = c.id
         AND collection_member.user_id = actor.user_id
         AND collection_member.status = 'active'
    )
  )
)`;
const COLLECTION_EDIT_EXPR = `(
  c.owner_id = actor.user_id
  OR actor.is_admin = 1
  OR EXISTS (
    SELECT 1 FROM collection_members collection_member
     WHERE collection_member.collection_id = c.id
       AND collection_member.user_id = actor.user_id
       AND collection_member.status = 'active'
       AND collection_member.role = 'editor'
  )
)`;
const COLLECTION_MANAGE_EXPR = `(c.owner_id = actor.user_id OR actor.is_admin = 1)`;
const QUESTION_INDEX_COLUMNS = `
  q.id,
  q.created_by,
  q.updated_by,
  q.created_by_name,
  q.updated_by_name,
  q.title,
  q.legacy_key,
  q.sort_order,
  q.source_kind,
  q.source_report_id,
  q.source_url,
  q.scene_tw,
  q.scene_ts,
  q.scene_tv,
  q.decision_type,
  CASE
    WHEN json_type(q.payload, '$.number') IN ('text', 'integer')
      AND CAST(json_extract(q.payload, '$.number') AS TEXT) <> ''
      AND CAST(json_extract(q.payload, '$.number') AS TEXT) NOT GLOB '*[^0-9]*'
    THEN CAST(json_extract(q.payload, '$.number') AS INTEGER)
    ELSE NULL
  END AS question_number,
  CASE
    WHEN lower(CAST(COALESCE(json_extract(q.payload, '$.hasRiichiJudgment'), 'false') AS TEXT)) = 'true'
      OR json_extract(q.payload, '$.hasRiichiJudgment') = 1
      OR EXISTS (
        SELECT 1
        FROM json_each(
          CASE
            WHEN json_type(q.payload, '$.reach') = 'array' THEN json_extract(q.payload, '$.reach')
            ELSE '[]'
          END
        ) reach_item
        WHERE CAST(reach_item.value AS REAL) > 0
      )
    THEN 1
    ELSE 0
  END AS has_riichi_judgment,
  q.created_at,
  q.updated_at`;

function requireDb(ctx) {
  const db = ctx?.db;
  if (!db || typeof db.prepare !== "function") throw new TypeError("db_required");
  return db;
}

function argsObject(args) {
  return args && typeof args === "object" && !Array.isArray(args) ? args : {};
}

function textArg(args, ...names) {
  const source = argsObject(args);
  for (const name of names) {
    if (source[name] !== undefined && source[name] !== null) return String(source[name]);
  }
  return "";
}

function optionalTextArg(args, ...names) {
  const value = textArg(args, ...names);
  return value.trim() ? value : null;
}

function intArg(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
}

function limitArg(value, fallback, maximum) {
  return intArg(value, fallback, 1, maximum);
}

function offsetArg(value) {
  return intArg(value, 0, 0, 2_147_483_647);
}

function boolDb(value) {
  // D1 stores booleans as INTEGER.  Accept native booleans as well so this
  // adapter remains compatible with a D1-compatible test binding.
  return value === true || value === 1 || value === "1" || value === "true";
}

function jsonDb(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    throw new Error("invalid_json");
  }
}

function asJsonObject(value) {
  const parsed = jsonDb(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function asJsonArray(value) {
  const parsed = jsonDb(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

function isoNow() {
  return new Date().toISOString();
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rowCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function first(db, sql, params = []) {
  return (await db.prepare(sql).bind(...params).first()) ?? null;
}

async function all(db, sql, params = []) {
  const response = await db.prepare(sql).bind(...params).all();
  if (Array.isArray(response)) return response;
  return Array.isArray(response?.results) ? response.results : [];
}

async function accessCollection(db, actor, collectionId) {
  return Boolean(collectionId && await canAccessCollection(db, actor, collectionId));
}

async function findShare(db, shareSlug) {
  if (!shareSlug) return null;
  return first(
    db,
    `SELECT id, owner_id, workspace_id, title, description, visibility,
            share_slug, allow_comments, allow_contributions, published_at,
            archived_at, series_key, series_parent_id, volume_number,
            volume_start, volume_end, created_at
       FROM collections
      WHERE share_slug = ? AND archived_at IS NULL
      LIMIT 1`,
    [shareSlug],
  );
}

async function visibleShare(db, actor, shareSlug) {
  const collection = await findShare(db, shareSlug);
  if (!collection || !(await accessCollection(db, actor, collection.id))) return null;
  return collection;
}

async function rootForShare(db, actor, shareSlug) {
  const requested = await visibleShare(db, actor, shareSlug);
  if (!requested) return null;
  return {
    requested,
    rootId: requested.series_parent_id || requested.id,
  };
}

async function visibleRootCollectionIds(db, actor, rootId) {
  if (!rootId) return [];
  const rows = await all(
    db,
    `WITH actor(user_id, is_admin) AS (SELECT ?, ?)
     SELECT c.id
       FROM collections c
       CROSS JOIN actor
      WHERE c.archived_at IS NULL
        AND (c.id = ? OR c.series_parent_id = ?)
        AND ${COLLECTION_ACCESS_EXPR}`,
    [actor?.id ?? null, actor?.is_admin === true ? 1 : 0, rootId, rootId],
  );
  return rows.map((row) => row.id);
}

async function visibleCollectionIds(db, actor, collectionIds) {
  const ids = [...new Set(collectionIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const rows = await all(
    db,
    `WITH actor(user_id, is_admin) AS (SELECT ?, ?)
     SELECT c.id
       FROM collections c
       CROSS JOIN actor
      WHERE c.archived_at IS NULL
        AND c.id IN (${placeholders(ids.length)})
        AND ${COLLECTION_ACCESS_EXPR}`,
    [actor?.id ?? null, actor?.is_admin === true ? 1 : 0, ...ids],
  );
  return new Set(rows.map((row) => row.id));
}

function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(",");
}

function mapIndexRow(row, includeTotal) {
  const mapped = {
    id: row.id,
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_by_name: row.created_by_name,
    updated_by_name: row.updated_by_name,
    title: row.title,
    legacy_key: row.legacy_key,
    sort_order: row.sort_order,
    source_kind: row.source_kind,
    source_report_id: row.source_report_id,
    source_url: row.source_url,
    scene_tw: numericOrNull(row.scene_tw),
    scene_ts: numericOrNull(row.scene_ts),
    scene_tv: numericOrNull(row.scene_tv),
    decision_type: row.decision_type,
    question_number: numericOrNull(row.question_number),
    has_riichi_judgment: boolDb(row.has_riichi_judgment),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (includeTotal) mapped.total_count = rowCount(row.total_count);
  return mapped;
}

async function sharedQuestionIndex(db, actor, args, includeTotal) {
  const source = argsObject(args);
  const shareSlug = textArg(source, "p_share_slug", "shareSlug", "share_slug");
  const collection = await visibleShare(db, actor, shareSlug);
  if (!collection) return [];

  const maximum = includeTotal ? 100 : 500;
  const fallback = includeTotal ? 100 : 500;
  const limit = limitArg(source.p_limit ?? source.limit, fallback, maximum);
  const offset = offsetArg(source.p_offset ?? source.offset);
  const totalColumn = includeTotal ? ", count(*) over () AS total_count" : "";
  const rows = await all(
    db,
    `SELECT ${QUESTION_INDEX_COLUMNS}${totalColumn}
       FROM questions q
       JOIN collections c ON c.id = q.collection_id
      WHERE c.share_slug = ?
        AND c.archived_at IS NULL
        AND q.deleted_at IS NULL
      ORDER BY q.sort_order, q.created_at, q.id
      LIMIT ? OFFSET ?`,
    [shareSlug, limit, offset],
  );
  return rows.map((row) => mapIndexRow(row, includeTotal));
}

async function sharedCollection(db, actor, args) {
  const shareSlug = textArg(args, "p_share_slug", "shareSlug", "share_slug");
  if (!shareSlug) return null;
  // The live function intentionally returns the collection metadata even when
  // the caller cannot access its contents; the capability flags are the RLS
  // boundary used by the UI for private/request collections.
  const row = await first(
    db,
    `SELECT c.id, c.owner_id, c.title, c.description, c.visibility,
            c.allow_comments, c.allow_contributions, c.published_at,
            c.series_key, c.series_parent_id, c.share_slug, c.volume_number,
            c.volume_start, c.volume_end, owner_profile.display_name AS owner_name,
            parent.share_slug AS parent_share_slug, parent.title AS parent_title
       FROM collections c
       LEFT JOIN profiles owner_profile ON owner_profile.id = c.owner_id
       LEFT JOIN collections parent ON parent.id = c.series_parent_id
      WHERE c.share_slug = ? AND c.archived_at IS NULL
      LIMIT 1`,
    [shareSlug],
  );
  if (!row) return null;

  const actorId = actor?.id ?? null;
  const [member, request, canView, canEdit, canManage] = await Promise.all([
    actorId
      ? first(
        db,
        `SELECT role, status
           FROM collection_members
          WHERE collection_id = ? AND user_id = ?
          LIMIT 1`,
        [row.id, actorId],
      )
      : null,
    actorId
      ? first(
        db,
        `SELECT id, status, message
           FROM collection_access_requests
          WHERE collection_id = ? AND requester_id = ?
          ORDER BY created_at DESC
          LIMIT 1`,
        [row.id, actorId],
      )
      : null,
    canAccessCollection(db, actor, row.id),
    canEditCollection(db, actor, row.id),
    canManageCollection(db, actor, row.id),
  ]);

  const isSeriesParent = row.series_parent_id === null && row.series_key !== null;
  return {
    id: row.id,
    owner_id: row.owner_id,
    owner_name: row.owner_name,
    title: row.title,
    description: row.description,
    visibility: row.visibility,
    allow_comments: boolDb(row.allow_comments),
    allow_contributions: boolDb(row.allow_contributions),
    published_at: row.published_at,
    can_view: Boolean(canView),
    can_edit: Boolean(canEdit),
    can_manage: Boolean(canManage),
    is_owner: actorId !== null && actorId === row.owner_id,
    member_role: member?.role ?? null,
    member_status: member?.status ?? null,
    request_id: request?.id ?? null,
    request_status: request?.status ?? null,
    request_message: request?.message ?? null,
    series_key: row.series_key,
    series_parent_id: row.series_parent_id,
    series_parent_slug: isSeriesParent ? row.share_slug : row.parent_share_slug,
    series_title: isSeriesParent ? row.title : row.parent_title,
    volume_number: numericOrNull(row.volume_number),
    volume_start: numericOrNull(row.volume_start),
    volume_end: numericOrNull(row.volume_end),
    is_series_parent: isSeriesParent,
  };
}

async function sharedQuestionDetail(db, actor, args) {
  const shareSlug = textArg(args, "p_share_slug", "shareSlug", "share_slug");
  const questionId = textArg(args, "p_question_id", "questionId", "question_id");
  const requested = await visibleShare(db, actor, shareSlug);
  if (!requested || !questionId) return [];
  const rootId = requested.series_parent_id || requested.id;
  const row = await first(
    db,
    `SELECT q.*, c.id AS selected_collection_id
       FROM questions q
       JOIN collections c ON c.id = q.collection_id
      WHERE q.id = ?
        AND q.deleted_at IS NULL
        AND c.archived_at IS NULL
        AND (c.id = ? OR c.series_parent_id = ?)
      LIMIT 1`,
    [questionId, rootId, rootId],
  );
  if (!row || !(await accessCollection(db, actor, row.selected_collection_id))) return [];
  const result = { ...row };
  delete result.selected_collection_id;
  result.payload = asJsonObject(result.payload);
  return [result];
}

async function collectionVolumes(db, actor, args) {
  const shareSlug = textArg(args, "p_share_slug", "shareSlug", "share_slug");
  const context = await rootForShare(db, actor, shareSlug);
  if (!context) return [];
  const visibleIds = await visibleRootCollectionIds(db, actor, context.rootId);
  const childIds = visibleIds.filter((id) => id !== context.rootId);
  if (!childIds.length) return [];
  const rows = await all(
    db,
    `WITH actor(user_id, is_admin) AS (SELECT ?, ?)
     SELECT c.id, c.share_slug, c.title, c.description, c.owner_id,
            c.volume_number, c.volume_start, c.volume_end,
            COUNT(q.id) FILTER (WHERE q.deleted_at IS NULL) AS question_count,
            root.share_slug AS series_parent_slug,
            CASE WHEN ${COLLECTION_ACCESS_EXPR} THEN 1 ELSE 0 END AS can_view,
            CASE WHEN ${COLLECTION_EDIT_EXPR} THEN 1 ELSE 0 END AS can_edit,
            CASE WHEN ${COLLECTION_MANAGE_EXPR} THEN 1 ELSE 0 END AS can_manage
       FROM collections c
       CROSS JOIN actor
       JOIN collections root ON root.id = ?
       LEFT JOIN questions q ON q.collection_id = c.id
      WHERE c.id IN (${placeholders(childIds.length)})
        AND c.archived_at IS NULL
      GROUP BY c.id, root.share_slug
      ORDER BY c.volume_number`,
    [actor?.id ?? null, actor?.is_admin === true ? 1 : 0, context.rootId, ...childIds],
  );
  return rows.map((row) => ({
      id: row.id,
      share_slug: row.share_slug,
      title: row.title,
      description: row.description,
      owner_id: row.owner_id,
      volume_number: numericOrNull(row.volume_number),
      volume_start: numericOrNull(row.volume_start),
      volume_end: numericOrNull(row.volume_end),
      question_count: rowCount(row.question_count),
      can_view: boolDb(row.can_view),
      can_edit: boolDb(row.can_edit),
      can_manage: boolDb(row.can_manage),
      series_parent_slug: row.series_parent_slug,
    }));
}

async function collectionVolumeProgress(db, actor, args) {
  const shareSlug = textArg(args, "p_share_slug", "shareSlug", "share_slug");
  const context = await rootForShare(db, actor, shareSlug);
  if (!context) return [];
  const visibleIds = (await visibleRootCollectionIds(db, actor, context.rootId))
    .filter((id) => id !== context.rootId);
  if (!visibleIds.length) return [];
  const volumes = await all(
    db,
    `SELECT id, volume_number, volume_start, volume_end
       FROM collections
      WHERE id IN (${placeholders(visibleIds.length)})
        AND archived_at IS NULL
      ORDER BY volume_number`,
    visibleIds,
  );
  const questions = await all(
    db,
    `SELECT id, collection_id
       FROM questions
      WHERE collection_id IN (${placeholders(visibleIds.length)})
        AND deleted_at IS NULL`,
    visibleIds,
  );
  const latestByQuestion = new Map();
  if (actor?.id && questions.length) {
    const attempts = await all(
      db,
      `SELECT a.question_id, a.grade
         FROM answer_attempts a
         JOIN questions q ON q.id = a.question_id
        WHERE a.user_id = ?
          AND q.collection_id IN (${placeholders(visibleIds.length)})
          AND q.deleted_at IS NULL
        ORDER BY a.question_id, a.answered_at DESC, a.id DESC`,
      [actor.id, ...visibleIds],
    );
    for (const attempt of attempts) {
      if (!latestByQuestion.has(attempt.question_id)) latestByQuestion.set(attempt.question_id, attempt.grade);
    }
  }
  return volumes.map((volume) => {
    const volumeQuestions = questions.filter((question) => question.collection_id === volume.id);
    let answered = 0;
    let mastered = 0;
    for (const question of volumeQuestions) {
      const grade = latestByQuestion.get(question.id);
      if (grade !== undefined) {
        answered += 1;
        if (["◎", "〇", "💮"].includes(grade)) mastered += 1;
      }
    }
    return {
      volume_number: numericOrNull(volume.volume_number),
      volume_start: numericOrNull(volume.volume_start),
      volume_end: numericOrNull(volume.volume_end),
      question_count: volumeQuestions.length,
      answered_count: answered,
      mastered_count: mastered,
    };
  });
}

async function collectionLibrarySummary(db, actor, args) {
  const authenticated = requireActor(actor);
  const source = argsObject(args);
  const shareSlug = textArg(source, "p_share_slug", "shareSlug", "share_slug");
  const rawArchived = source.p_archived_keys ?? source.archivedKeys ?? [];
  const archivedKeys = Array.isArray(rawArchived) ? rawArchived.map(String) : [];
  if (archivedKeys.length > 20_000) throw new ApiError("too_many_archive_keys", 422);
  const collection = await first(
    db,
    `SELECT c.id
       FROM collections c
      WHERE c.share_slug = ?
        AND c.archived_at IS NULL
        AND (c.series_parent_id IS NULL OR EXISTS (
          SELECT 1 FROM collections parent_collection
           WHERE parent_collection.id = c.series_parent_id
             AND parent_collection.archived_at IS NULL
        ))
      LIMIT 1`,
    [shareSlug],
  );
  if (!collection || !(await accessCollection(db, authenticated, collection.id))) {
    throw new ApiError("collection_not_found_or_access_denied", 403);
  }
  const rows = await all(
    db,
    `SELECT q.id, q.updated_at,
            (SELECT a.grade
               FROM answer_attempts a
              WHERE a.question_id = q.id AND a.user_id = ?
              ORDER BY a.answered_at DESC, a.id DESC
              LIMIT 1) AS latest_grade,
            (SELECT a.answered_at
               FROM answer_attempts a
              WHERE a.question_id = q.id AND a.user_id = ?
              ORDER BY a.answered_at DESC, a.id DESC
              LIMIT 1) AS latest_answered_at
       FROM questions q
      WHERE q.collection_id = ? AND q.deleted_at IS NULL`,
    [authenticated.id, authenticated.id, collection.id],
  );
  const archiveSet = new Set(archivedKeys);
  let answeredCount = 0;
  let masteredCount = 0;
  let lastActivityAt = null;
  for (const row of rows) {
    const archived = archiveSet.has(String(row.id));
    if (row.latest_answered_at !== null || archived) answeredCount += 1;
    if (["〇", "◎", "💮"].includes(row.latest_grade) || archived) masteredCount += 1;
    const candidate = row.latest_answered_at && row.latest_answered_at > row.updated_at
      ? row.latest_answered_at
      : row.updated_at;
    if (candidate && (!lastActivityAt || candidate > lastActivityAt)) lastActivityAt = candidate;
  }
  return [{
    question_count: rows.length,
    answered_count: answeredCount,
    mastered_count: masteredCount,
    last_activity_at: lastActivityAt,
  }];
}

async function sharedComments(db, actor, args) {
  const source = argsObject(args);
  const shareSlug = textArg(source, "p_share_slug", "shareSlug", "share_slug");
  const questionId = optionalTextArg(source, "p_question_id", "questionId", "question_id");
  const context = await rootForShare(db, actor, shareSlug);
  if (!context) return [];
  const visibleIds = await visibleRootCollectionIds(db, actor, context.rootId);
  if (!visibleIds.length) return [];
  const rows = await all(
    db,
    `SELECT cm.id, cm.question_id, cm.user_id AS author_id,
            p.display_name AS author_name, p.avatar_url AS author_avatar_url,
            cm.body, cm.attachments, cm.created_at, cm.updated_at,
            cm.collection_id
       FROM comments cm
       JOIN collections c ON c.id = cm.collection_id
       JOIN profiles p ON p.id = cm.user_id
      WHERE cm.collection_id IN (${placeholders(visibleIds.length)})
        AND c.archived_at IS NULL
        AND cm.deleted_at IS NULL
        AND (? IS NULL OR cm.question_id = ?)
      ORDER BY cm.created_at`,
    [...visibleIds, questionId, questionId],
  );
  return rows.map((row) => ({
    id: row.id,
    question_id: row.question_id,
    author_id: row.author_id,
    author_name: row.author_name,
    author_avatar_url: row.author_avatar_url,
    body: row.body,
    attachments: asJsonArray(row.attachments),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

async function sharedCommentChanges(db, actor, args) {
  const source = argsObject(args);
  const shareSlug = textArg(source, "p_share_slug", "shareSlug", "share_slug");
  const after = optionalTextArg(source, "p_after", "after");
  const afterId = textArg(source, "p_after_id", "afterId") || ZERO_UUID;
  const limit = limitArg(source.p_limit ?? source.limit, 100, 100);
  const emptyCursor = { updatedAt: after ?? isoNow(), id: afterId };
  if (!actor?.id) return { rows: [], cursor: emptyCursor };
  const collection = await findShare(db, shareSlug);
  if (!collection || !(await accessCollection(db, actor, collection.id))) {
    return { rows: [], cursor: emptyCursor };
  }
  const comparison = after
    ? `AND (c.updated_at > ? OR (c.updated_at = ? AND c.id > ?))`
    : "";
  const params = after
    ? [shareSlug, after, after, afterId, limit]
    : [shareSlug, limit];
  const rows = await all(
    db,
    `SELECT c.id, c.question_id, c.user_id AS author_id,
            p.display_name AS author_name,
            CASE WHEN c.deleted_at IS NULL THEN substr(c.body, 1, 160) ELSE '' END AS body,
            c.created_at, c.updated_at, c.deleted_at
       FROM comments c
       JOIN collections col ON col.id = c.collection_id
       JOIN profiles p ON p.id = c.user_id
      WHERE col.share_slug = ?
        AND ${comparison ? comparison.slice(4) : "1=1"}
        AND col.archived_at IS NULL
      ORDER BY ${after ? "c.updated_at, c.id" : "c.updated_at DESC, c.id DESC"}
      LIMIT ?`,
    params,
  );
  const ordered = after ? rows : [...rows].reverse();
  const mapped = ordered.map((row) => ({
    id: row.id,
    question_id: row.question_id,
    author_id: row.author_id,
    author_name: row.author_name,
    body: row.body,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  }));
  const last = mapped[mapped.length - 1];
  return {
    rows: mapped,
    cursor: last
      ? { updatedAt: last.updated_at, id: last.id }
      : emptyCursor,
  };
}

async function myAttemptsForCollection(db, actor, args) {
  const source = argsObject(args);
  const shareSlug = textArg(source, "p_share_slug", "shareSlug", "share_slug");
  const context = await rootForShare(db, actor, shareSlug);
  if (!context || !actor?.id) return [];
  const visibleIds = await visibleRootCollectionIds(db, actor, context.rootId);
  if (!visibleIds.length) return [];
  const limit = limitArg(source.p_limit ?? source.limit, 5000, 5000);
  const offset = offsetArg(source.p_offset ?? source.offset);
  const rows = await all(
    db,
    `SELECT a.client_attempt_id, a.question_id, a.answer, a.grade,
            a.elapsed_ms, a.answered_at
       FROM answer_attempts a
       JOIN questions q ON q.id = a.question_id
      WHERE a.user_id = ?
        AND q.collection_id IN (${placeholders(visibleIds.length)})
        AND q.deleted_at IS NULL
      ORDER BY a.answered_at DESC, a.id DESC
      LIMIT ? OFFSET ?`,
    [actor.id, ...visibleIds, limit, offset],
  );
  return rows.map((row) => ({
    client_attempt_id: row.client_attempt_id,
    question_id: row.question_id,
    answer: asJsonObject(row.answer),
    grade: row.grade,
    elapsed_ms: numericOrNull(row.elapsed_ms),
    answered_at: row.answered_at,
  }));
}

async function myCollections(db, actor) {
  const rows = await all(
    db,
    `WITH actor(user_id, is_admin) AS (SELECT ?, ?)
     SELECT c.id, c.share_slug, c.title, c.description, c.visibility,
            c.owner_id, c.created_at,
            (SELECT cm.role FROM collection_members cm
              WHERE cm.collection_id = c.id AND cm.user_id = actor.user_id
              LIMIT 1) AS member_role,
            (SELECT cm.status FROM collection_members cm
              WHERE cm.collection_id = c.id AND cm.user_id = actor.user_id
              LIMIT 1) AS member_status,
            CASE WHEN ${COLLECTION_ACCESS_EXPR} THEN 1 ELSE 0 END AS can_view,
            CASE WHEN ${COLLECTION_EDIT_EXPR} THEN 1 ELSE 0 END AS can_edit,
            CASE WHEN ${COLLECTION_MANAGE_EXPR} THEN 1 ELSE 0 END AS can_manage
       FROM collections c
       CROSS JOIN actor
      WHERE c.archived_at IS NULL
        AND c.series_parent_id IS NULL
        AND ${COLLECTION_ACCESS_EXPR}
      ORDER BY c.created_at DESC`,
    [actor?.id ?? null, actor?.is_admin === true ? 1 : 0],
  );
  return rows.map((row) => ({
      id: row.id,
      share_slug: row.share_slug,
      title: row.title,
      description: row.description,
      visibility: row.visibility,
      owner_id: row.owner_id,
      member_role: row.member_role,
      member_status: row.member_status,
      can_view: boolDb(row.can_view),
      can_edit: boolDb(row.can_edit),
      can_manage: boolDb(row.can_manage),
      created_at: row.created_at,
    }));
}

async function collectionDirectory(db, actor) {
  const rows = await all(
    db,
    `WITH actor(user_id, is_admin) AS (SELECT ?, ?)
     SELECT c.id, c.share_slug, c.title, c.description, c.visibility,
            c.owner_id, owner_profile.display_name AS owner_name,
            c.created_at, c.series_key, c.series_parent_id,
            (SELECT ar.id
               FROM collection_access_requests ar
              WHERE ar.collection_id = c.id AND ar.requester_id = actor.user_id
              ORDER BY ar.created_at DESC LIMIT 1) AS request_id,
            (SELECT ar.status
               FROM collection_access_requests ar
              WHERE ar.collection_id = c.id AND ar.requester_id = actor.user_id
              ORDER BY ar.created_at DESC LIMIT 1) AS request_status,
            (SELECT COUNT(*) FROM collections child
              WHERE child.series_parent_id = c.id AND child.archived_at IS NULL) AS volume_count,
            CASE WHEN ${COLLECTION_ACCESS_EXPR} THEN 1 ELSE 0 END AS can_view,
            CASE WHEN ${COLLECTION_EDIT_EXPR} THEN 1 ELSE 0 END AS can_edit,
            CASE WHEN ${COLLECTION_MANAGE_EXPR} THEN 1 ELSE 0 END AS can_manage
       FROM collections c
       CROSS JOIN actor
       LEFT JOIN profiles owner_profile ON owner_profile.id = c.owner_id
      WHERE c.archived_at IS NULL
        AND c.published_at IS NOT NULL
        AND c.visibility IN ('public', 'request', 'unlisted')
        AND c.series_parent_id IS NULL
      ORDER BY c.created_at DESC`,
    [actor?.id ?? null, actor?.is_admin === true ? 1 : 0],
  );
  return rows.map((row) => ({
      id: row.id,
      share_slug: row.share_slug,
      title: row.title,
      description: row.description,
      visibility: row.visibility,
      owner_id: row.owner_id,
      owner_name: row.owner_name,
      created_at: row.created_at,
      can_view: boolDb(row.can_view),
      can_edit: boolDb(row.can_edit),
      can_manage: boolDb(row.can_manage),
      request_id: row.request_id,
      request_status: row.request_status,
      series_key: row.series_key,
      is_series_parent: row.series_parent_id === null && row.series_key !== null,
      volume_count: rowCount(row.volume_count),
    }));
}

async function collectionAccessRequests(db, actor, args) {
  const collectionId = textArg(args, "p_collection_id", "collectionId", "collection_id");
  if (!collectionId || !(await canManageCollection(db, actor, collectionId))) return [];
  const rows = await all(
    db,
    `SELECT r.id, r.collection_id, r.requester_id,
            p.display_name AS requester_name, r.requested_role,
            r.status, r.message, r.created_at, r.reviewed_at
       FROM collection_access_requests r
       JOIN profiles p ON p.id = r.requester_id
      WHERE r.collection_id = ?
      ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END,
               r.created_at DESC`,
    [collectionId],
  );
  return rows.map((row) => ({ ...row }));
}

async function collectionMembers(db, actor, args) {
  const collectionId = textArg(args, "p_collection_id", "collectionId", "collection_id");
  if (!collectionId || !(await canManageCollection(db, actor, collectionId))) return [];
  const rows = await all(
    db,
    `SELECT cm.user_id, p.display_name, cm.role, cm.status, cm.granted_at
       FROM collection_members cm
       LEFT JOIN profiles p ON p.id = cm.user_id
      WHERE cm.collection_id = ?
      ORDER BY cm.status, cm.granted_at DESC`,
    [collectionId],
  );
  return rows.map((row) => ({ ...row }));
}

async function collectionNotifications(db, actor, args) {
  if (!actor?.id) return [];
  const unreadOnly = boolDb(argsObject(args).p_unread_only ?? argsObject(args).unreadOnly);
  const rows = await all(
    db,
    `SELECT id, collection_id, request_id, kind, payload, created_at, read_at
       FROM collection_access_notifications
      WHERE recipient_id = ?
        AND (? = 0 OR read_at IS NULL)
      ORDER BY created_at DESC`,
    [actor.id, unreadOnly ? 1 : 0],
  );
  return rows.map((row) => ({
    id: row.id,
    collection_id: row.collection_id,
    request_id: row.request_id,
    kind: row.kind,
    payload: asJsonObject(row.payload),
    created_at: row.created_at,
    read_at: row.read_at,
  }));
}

async function sharedReactionSummary(db, actor, args) {
  const source = argsObject(args);
  const shareSlug = textArg(source, "p_share_slug", "shareSlug", "share_slug");
  const questionId = textArg(source, "p_question_id", "questionId", "question_id");
  if (!shareSlug || !questionId) return [];
  const question = await first(
    db,
    `SELECT q.id, q.collection_id, q.payload
       FROM questions q
       JOIN collections c ON c.id = q.collection_id
      WHERE q.id = ? AND q.deleted_at IS NULL
        AND c.share_slug = ? AND c.archived_at IS NULL
      LIMIT 1`,
    [questionId, shareSlug],
  );
  if (!question || !(await accessCollection(db, actor, question.collection_id))) return [];

  const [questionRows, commentRows, actualComments, payloadComments] = await Promise.all([
    all(
      db,
      `SELECT 'question' AS scope, qr.question_id AS target_id,
              qr.reaction_key, qr.user_id, qr.created_at,
              p.display_name, p.avatar_url
         FROM question_reactions qr
         JOIN profiles p ON p.id = qr.user_id
        WHERE qr.question_id = ?`,
      [questionId],
    ),
    all(
      db,
      `SELECT 'comment' AS scope, cr.comment_id AS target_id,
              cr.reaction_key, cr.user_id, cr.created_at,
              p.display_name, p.avatar_url
         FROM comment_reactions cr
         JOIN profiles p ON p.id = cr.user_id
        WHERE cr.question_id = ?`,
      [questionId],
    ),
    all(
      db,
      `SELECT id FROM comments
        WHERE question_id = ? AND deleted_at IS NULL`,
      [questionId],
    ),
    all(
      db,
      `SELECT COALESCE(json_extract(comment_row.value, '$.id'),
                      json_extract(comment_row.value, '$.messageId')) AS comment_id
         FROM questions q,
              json_each(
                CASE
                  WHEN json_type(q.payload, '$.comments') = 'array'
                    THEN json_extract(q.payload, '$.comments')
                  ELSE '[]'
                END
              ) comment_row
        WHERE q.id = ?`,
      [questionId],
    ),
  ]);
  const commentIds = new Set([
    ...actualComments.map((row) => String(row.id)),
    ...payloadComments.filter((row) => row.comment_id !== null).map((row) => String(row.comment_id)),
  ]);
  const rows = [
    ...questionRows,
    ...commentRows.filter((row) => commentIds.has(String(row.target_id))),
  ].sort((left, right) => (
    String(left.scope).localeCompare(String(right.scope))
      || String(left.target_id).localeCompare(String(right.target_id))
      || String(left.reaction_key).localeCompare(String(right.reaction_key))
      || String(left.created_at).localeCompare(String(right.created_at))
      || String(left.user_id).localeCompare(String(right.user_id))
  ));
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.scope}\u0000${row.target_id}\u0000${row.reaction_key}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        scope: row.scope,
        target_id: row.target_id,
        reaction_key: row.reaction_key,
        reactors: [],
        reacted_by_me: false,
      };
      groups.set(key, group);
    }
    group.reactors.push({
      userId: row.user_id,
      displayName: row.display_name ?? "プレイヤー",
      avatarUrl: row.avatar_url ?? null,
    });
    if (actor?.id && row.user_id === actor.id) group.reacted_by_me = true;
  }
  return [...groups.values()].map((group) => ({
    scope: group.scope,
    target_id: group.target_id,
    reaction_key: group.reaction_key,
    reaction_count: group.reactors.length,
    reactors: group.reactors,
    reacted_by_me: group.reacted_by_me,
  }));
}

async function customReactions(db, actor) {
  if (!actor?.id) return [];
  const rows = await all(
    db,
    `SELECT cr.reaction_key, cr.label, cr.icon, cr.image_path, cr.icon_type,
            cr.creator_user_id, p.display_name AS creator_display_name,
            cr.created_at
       FROM custom_reactions cr
       LEFT JOIN profiles p ON p.id = cr.creator_user_id
      ORDER BY cr.created_at ASC, cr.reaction_key ASC`,
  );
  return rows.map((row) => ({
    reaction_key: row.reaction_key,
    label: row.label,
    icon: row.icon,
    image_path: row.image_path,
    icon_type: row.icon_type,
    creator_user_id: row.creator_user_id,
    creator_display_name: row.creator_display_name ?? "プレイヤー",
    created_at: row.created_at,
  }));
}

function pollChoice(answer) {
  const selected = answer.selected;
  if (selected !== null && selected !== undefined && String(selected) !== "") {
    const riichi = String(answer.riichi ?? "false").toLowerCase() === "true";
    return `${selected}|${riichi ? "reach" : "no-reach"}`;
  }
  const callDecision = String(answer.callDecision ?? "").toLowerCase();
  if (["kan", "call:kan"].includes(callDecision)) return "call:kan";
  if (["true", "call:yes"].includes(callDecision)) return "call:yes";
  if (["false", "call:no"].includes(callDecision)) return "call:no";
  return "unknown";
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}

async function questionPollStats(db, actor, args) {
  if (!actor?.id) return [];
  const source = argsObject(args);
  const shareSlug = textArg(source, "p_share_slug", "shareSlug", "share_slug");
  const questionId = textArg(source, "p_question_id", "questionId", "question_id");
  const question = await first(
    db,
    `SELECT q.id, q.collection_id
       FROM questions q
       JOIN collections c ON c.id = q.collection_id
      WHERE q.id = ? AND q.deleted_at IS NULL
        AND c.share_slug = ? AND c.archived_at IS NULL
      LIMIT 1`,
    [questionId, shareSlug],
  );
  if (!question || !(await accessCollection(db, actor, question.collection_id))) return [];
  const attempts = await all(
    db,
    `SELECT answer, grade, elapsed_ms, user_id
       FROM answer_attempts
      WHERE question_id = ?`,
    [questionId],
  );
  if (!attempts.some((row) => row.user_id === actor.id) || attempts.length === 0) return [];
  const correct = attempts.filter((row) => ["💮", "◎", "〇"].includes(row.grade)).length;
  const elapsed = attempts
    .map((row) => numericOrNull(row.elapsed_ms))
    .filter((value) => value !== null);
  const choices = {};
  const grades = {};
  for (const row of attempts) {
    const answer = asJsonObject(row.answer);
    const choice = pollChoice(answer);
    choices[choice] = (choices[choice] ?? 0) + 1;
    grades[row.grade] = (grades[row.grade] ?? 0) + 1;
  }
  return [{
    sample_size: attempts.length,
    correct_rate: roundOne((100 * correct) / attempts.length),
    average_seconds: elapsed.length
      ? roundOne(elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length / 1000)
      : null,
    choice_counts: choices,
    grade_counts: grades,
  }];
}

async function legacyQuestions(db, actor, args) {
  const source = argsObject(args);
  const values = source.legacyKeys ?? source.p_legacy_keys ?? source.keys ?? source.legacy_keys ?? [];
  const legacyKeys = Array.isArray(values)
    ? [...new Set(values.map((value) => String(value)).filter(Boolean))]
    : [];
  if (!legacyKeys.length) return [];
  if (legacyKeys.length > 100) throw new Error("too_many_legacy_keys");
  const rows = await all(
    db,
    `SELECT q.id, q.legacy_key, q.collection_id
       FROM questions q
      WHERE q.deleted_at IS NULL
        AND q.legacy_key IN (${placeholders(legacyKeys.length)})
      ORDER BY q.legacy_key, q.id`,
    legacyKeys,
  );
  const visible = await visibleCollectionIds(db, actor, rows.map((row) => row.collection_id));
  return rows
    .filter((row) => visible.has(row.collection_id))
    .map((row) => ({ id: row.id, legacy_key: row.legacy_key }));
}

async function attemptsTable(db, actor, args) {
  if (!actor?.id) return [];
  const source = argsObject(args);
  const requestedStudent = optionalTextArg(source, "studentUserId", "userId", "p_user_id", "user_id");
  const studentId = requestedStudent ?? actor.id;
  if (studentId !== actor.id && !(await canViewStudent(db, actor, studentId))) return [];
  const limit = limitArg(source.limit ?? source.p_limit, 100, 500);
  // Own-history requests explicitly include user_id too. Always retain the
  // idempotency key; dropping it makes a restored history look like new answers.
  const fields = studentId === actor.id
    ? "id, client_attempt_id, question_id, answer, grade, elapsed_ms, answered_at"
    : "id, question_id, answer, grade, elapsed_ms, answered_at";
  const rows = await all(
    db,
    `SELECT ${fields}
       FROM answer_attempts
      WHERE user_id = ?
      ORDER BY answered_at DESC, id DESC
      LIMIT ?`,
    [studentId, limit],
  );
  return rows.map((row) => {
    const mapped = { ...row, answer: asJsonObject(row.answer), elapsed_ms: numericOrNull(row.elapsed_ms) };
    return mapped;
  });
}

async function studentLearningSummary(db, actor) {
  if (!actor?.id) return [];
  const rows = await all(
    db,
    `WITH actor(user_id, is_admin) AS (SELECT ?, ?)
     SELECT a.user_id, p.display_name,
            COUNT(*) AS attempt_count,
            COUNT(DISTINCT a.question_id) AS answered_questions,
            AVG(a.elapsed_ms) AS average_elapsed_ms,
            SUM(CASE WHEN a.grade IN ('💮', '◎', '〇') THEN 1 ELSE 0 END) AS safe_count,
            SUM(CASE WHEN a.grade IN ('△', '×') THEN 1 ELSE 0 END) AS weak_count,
            MAX(a.answered_at) AS last_answered_at
       FROM answer_attempts a
       JOIN profiles p ON p.id = a.user_id
       CROSS JOIN actor
      WHERE a.user_id = actor.user_id
         OR (
           actor.is_admin = 1
           AND EXISTS (
             SELECT 1
               FROM workspace_members owner_member
               JOIN workspace_members student_member
                 ON student_member.workspace_id = owner_member.workspace_id
              WHERE owner_member.user_id = actor.user_id
                AND owner_member.role = 'owner'
                AND owner_member.status = 'active'
                AND student_member.user_id = a.user_id
                AND student_member.role = 'student'
                AND student_member.status = 'active'
           )
         )
      GROUP BY a.user_id, p.display_name
      ORDER BY last_answered_at DESC`,
    [actor.id, actor.is_admin === true ? 1 : 0],
  );
  return rows.map((row) => ({
      user_id: row.user_id,
      display_name: row.display_name,
      attempt_count: rowCount(row.attempt_count),
      answered_questions: rowCount(row.answered_questions),
      average_seconds: row.average_elapsed_ms === null || row.average_elapsed_ms === undefined
        ? null
        : roundOne(Number(row.average_elapsed_ms) / 1000),
      safe_count: rowCount(row.safe_count),
      weak_count: rowCount(row.weak_count),
      last_answered_at: row.last_answered_at,
    }));
}

async function workspaceMembers(db, actor) {
  if (!actor?.id) return [];
  // This is the exact workspace_members SELECT policy: own rows or all active
  // rows in workspaces where the actor is an active owner/teacher.
  const rows = await all(
    db,
    `SELECT wm.workspace_id, wm.role, wm.status
       FROM workspace_members wm
      WHERE wm.status = 'active'
        AND (
          wm.user_id = ?
          OR EXISTS (
            SELECT 1 FROM workspace_members viewer
             WHERE viewer.workspace_id = wm.workspace_id
               AND viewer.user_id = ?
               AND viewer.status = 'active'
               AND viewer.role IN ('owner', 'teacher')
          )
        )
      ORDER BY wm.workspace_id, wm.user_id`,
    [actor.id, actor.id],
  );
  return rows.map((row) => ({
    workspace_id: row.workspace_id,
    role: row.role,
    status: row.status,
  }));
}

export async function readTable(name, args = {}, ctx = {}) {
  if (!READ_TABLE_SET.has(name)) throw new Error("rpc_not_implemented");
  const db = requireDb(ctx);
  switch (name) {
    case "questions":
      return legacyQuestions(db, ctx.actor ?? null, args);
    case "answer_attempts":
      return attemptsTable(db, ctx.actor ?? null, args);
    case "student_learning_summary":
      return studentLearningSummary(db, ctx.actor ?? null);
    case "workspace_members":
      return workspaceMembers(db, ctx.actor ?? null);
    default:
      throw new Error("rpc_not_implemented");
  }
}

export async function readRpc(name, args = {}, ctx = {}) {
  if (!READ_RPC_SET.has(name)) throw new Error("rpc_not_implemented");
  if (AUTHENTICATED_READ_RPCS.has(name)) requireActor(ctx.actor);
  const db = requireDb(ctx);
  const actor = ctx.actor ?? null;
  switch (name) {
    case "get_shared_collection":
      return sharedCollection(db, actor, args);
    case "get_shared_question_index_page":
      return sharedQuestionIndex(db, actor, args, true);
    case "get_shared_question_index":
      return sharedQuestionIndex(db, actor, args, false);
    case "get_shared_question_detail":
      return sharedQuestionDetail(db, actor, args);
    case "get_collection_volumes":
      return collectionVolumes(db, actor, args);
    case "get_collection_volume_progress":
      return collectionVolumeProgress(db, actor, args);
    case "get_collection_library_summary":
      return collectionLibrarySummary(db, actor, args);
    case "get_shared_comments":
      return sharedComments(db, actor, args);
    case "get_shared_comment_changes":
      return sharedCommentChanges(db, actor, args);
    case "load_my_attempts_for_collection":
      return myAttemptsForCollection(db, actor, args);
    case "list_my_collections":
      return myCollections(db, actor);
    case "list_collection_directory":
      return collectionDirectory(db, actor);
    case "list_collection_access_requests":
      return collectionAccessRequests(db, actor, args);
    case "list_collection_members":
      return collectionMembers(db, actor, args);
    case "list_collection_notifications":
      return collectionNotifications(db, actor, args);
    case "get_my_capabilities":
      return [{ is_admin: actor?.is_admin === true }];
    case "get_shared_reaction_summary":
      return sharedReactionSummary(db, actor, args);
    case "list_custom_reactions":
      return customReactions(db, actor);
    case "get_question_poll_stats":
      return questionPollStats(db, actor, args);
    default:
      throw new Error("rpc_not_implemented");
  }
}
