import {
  ApiError,
  canAccessCollection,
  canEditCollection,
  requireActor,
} from "./access.mjs";

// These are the authenticated write RPCs currently called by client/supabase-sync.ts.
// Profile display-name editing stays in the table surface because the client
// performs a direct profiles.upsert, not an RPC.
export const WRITE_RPCS = Object.freeze([
  "record_shared_attempt",
  "post_shared_comment",
  "update_shared_comment",
  "delete_shared_comment",
  "set_shared_question_reaction",
  "set_shared_comment_reaction",
  "create_custom_reaction",
  "mark_collection_notifications_read",
  "request_collection_access",
]);

const WRITE_RPC_SET = new Set(WRITE_RPCS);
const WRITE_TABLES = new Set(["answer_attempts", "profiles"]);
const GRADES = new Set(["💮", "◎", "〇", "△", "×"]);
const MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const COMMENT_MEDIA_LIMIT = 5 * 1024 * 1024;
const REACTION_MEDIA_LIMIT = 1 * 1024 * 1024;
const BUILTIN_REACTIONS = new Set([
  // Keep the live SQL/public standard and tile keys during the cutover.
  "like", "agree", "difficult", "good_question", "important", "hmm",
  "strategy", "mistake", "big_difference", "small_difference", "memo",
  "theory", "basic_order", "call", "riichi", "pass", "silent", "kan",
  "exclaim", "question",
  "tile_man1", "tile_man2", "tile_man3", "tile_man4", "tile_man5", "tile_man6", "tile_man7", "tile_man8", "tile_man9",
  "tile_pin1", "tile_pin2", "tile_pin3", "tile_pin4", "tile_pin5", "tile_pin6", "tile_pin7", "tile_pin8", "tile_pin9",
  "tile_sou1", "tile_sou2", "tile_sou3", "tile_sou4", "tile_sou5", "tile_sou6", "tile_sou7", "tile_sou8", "tile_sou9",
  "tile_ji1", "tile_ji2", "tile_ji3", "tile_ji4", "tile_ji5", "tile_ji6", "tile_ji7",
  "tile_aka1", "tile_aka2", "tile_aka3",
  // These eight are present in the current public reaction definitions.
  "ari",
  "preference",
  "humu_humu",
  "understood",
  "basic_lesson",
  "fold",
  "push",
  "okonomiyaki",
]);

function fail(code, status = 400) {
  throw new ApiError(code, status);
}

function requireDb(ctx) {
  const db = ctx?.db;
  if (!db || typeof db.prepare !== "function") throw new TypeError("db_required");
  return db;
}

function objectArgs(args) {
  return args && typeof args === "object" && !Array.isArray(args) ? args : {};
}

function requiredText(value, code, max = 1024) {
  if (value === null || value === undefined) fail(code);
  const text = String(value);
  if (!text || text.length > max) fail(code);
  return text;
}

function textValue(value) {
  return value === null || value === undefined ? "" : String(value);
}

function unicodeLength(value) {
  return Array.from(String(value)).length;
}

function normalizeTimestamp(value) {
  const date = value === null || value === undefined || value === ""
    ? new Date()
    : new Date(String(value));
  if (!Number.isFinite(date.getTime())) fail("invalid_timestamp");
  return date.toISOString();
}

function jsonText(value, fallback) {
  const source = value === null || value === undefined ? fallback : value;
  try {
    const serialized = JSON.stringify(source);
    if (serialized === undefined) fail("invalid_json");
    JSON.parse(serialized);
    return serialized;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail("invalid_json");
  }
}

function jsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    fail("invalid_json");
  }
}

function jsonArray(value) {
  const parsed = jsonValue(value, []);
  if (!Array.isArray(parsed)) fail("invalid_json");
  return parsed;
}

function dbBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function inputBoolean(value, code = "invalid_boolean") {
  if (value === true || value === 1 || value === "true") return true;
  if (value === false || value === 0 || value === "false" || value === null || value === undefined) return false;
  fail(code);
}

function uniqueStrings(values, code, max = 1000) {
  if (!Array.isArray(values)) fail(code);
  if (values.length > max) fail(code, 422);
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const text = requiredText(value, code, 200);
    if (!seen.has(text)) {
      seen.add(text);
      result.push(text);
    }
  }
  return result;
}

async function first(db, sql, params = []) {
  return (await db.prepare(sql).bind(...params).first()) ?? null;
}

async function all(db, sql, params = []) {
  const response = await db.prepare(sql).bind(...params).all();
  if (Array.isArray(response)) return response;
  return Array.isArray(response?.results) ? response.results : [];
}

async function run(db, sql, params = []) {
  return db.prepare(sql).bind(...params).run();
}

function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(",");
}

function newId() {
  if (typeof globalThis.crypto?.randomUUID !== "function") fail("uuid_unavailable", 500);
  return globalThis.crypto.randomUUID();
}

function actorId(actor) {
  return requiredText(actor?.id, "login_required", 200);
}

async function findSharedQuestion(db, actor, shareSlugValue, questionIdValue) {
  const shareSlug = requiredText(shareSlugValue, "shared_question_not_found");
  const questionId = requiredText(questionIdValue, "shared_question_not_found");
  const requested = await first(
    db,
    `SELECT id, series_parent_id
       FROM collections
      WHERE share_slug = ? AND archived_at IS NULL
      LIMIT 1`,
    [shareSlug],
  );
  if (!requested || !(await canAccessCollection(db, actor, requested.id))) {
    fail("shared_question_not_found", 404);
  }
  const rootId = requested.series_parent_id || requested.id;
  const question = await first(
    db,
    `SELECT q.id, q.collection_id
       FROM questions q
       JOIN collections c ON c.id = q.collection_id
      WHERE q.id = ?
        AND q.deleted_at IS NULL
        AND c.archived_at IS NULL
        AND (c.id = ? OR c.series_parent_id = ?)
      LIMIT 1`,
    [questionId, rootId, rootId],
  );
  if (!question || !(await canAccessCollection(db, actor, question.collection_id))) {
    fail("shared_question_not_found", 404);
  }
  return question;
}

async function findDirectQuestion(db, actor, questionIdValue) {
  const questionId = requiredText(questionIdValue, "shared_question_not_found");
  const question = await first(
    db,
    `SELECT q.id, q.collection_id
       FROM questions q
       JOIN collections c ON c.id = q.collection_id
      WHERE q.id = ? AND q.deleted_at IS NULL AND c.archived_at IS NULL
      LIMIT 1`,
    [questionId],
  );
  if (!question || !(await canAccessCollection(db, actor, question.collection_id))) {
    fail("shared_question_not_found", 404);
  }
  return question;
}

function attachmentItems(value, actor, kind) {
  const attachments = value === null || value === undefined ? [] : value;
  if (!Array.isArray(attachments) || attachments.length > 4) fail("comment_attachments_invalid");
  const prefix = `${actor.id}/${kind}/`;
  return attachments.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail("comment_attachments_invalid");
    const path = textValue(item.path);
    const alt = textValue(item.alt);
    const filename = path.startsWith(prefix) ? path.slice(prefix.length) : "";
    if (!filename || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename)) fail("comment_attachments_invalid");
    if (unicodeLength(alt) > 200) fail("comment_attachments_invalid");
    return { path, alt };
  });
}

async function requireOwnedReadyMedia(db, actor, bucket, path, maxBytes, code) {
  const row = await first(
    db,
    `SELECT content_type, size_bytes
       FROM media_assets
      WHERE bucket = ?
        AND path = ?
        AND object_key = ?
        AND owner_id = ?
        AND state = 'ready'
      LIMIT 1`,
    [bucket, path, `${bucket}/${path}`, actor.id],
  );
  const size = Number(row?.size_bytes);
  if (!row || !MEDIA_TYPES.has(row.content_type) || !Number.isSafeInteger(size) || size < 1 || size > maxBytes) {
    fail(code);
  }
}

async function validateCommentAttachments(db, actor, value) {
  const attachments = attachmentItems(value, actor, "comments");
  for (const attachment of attachments) {
    await requireOwnedReadyMedia(
      db,
      actor,
      "comment-assets",
      attachment.path,
      COMMENT_MEDIA_LIMIT,
      "comment_attachment_not_owned_or_ready",
    );
  }
  return attachments;
}

async function validateCommentBody(bodyValue, attachments) {
  const body = textValue(bodyValue).trim();
  if (unicodeLength(body) > 4000 || (!body && attachments.length === 0)) fail("comment_content_invalid");
  return body;
}

async function postSharedComment(db, actor, args) {
  const source = objectArgs(args);
  const hasAttachmentsArgument = Object.prototype.hasOwnProperty.call(source, "p_attachments");
  const shareSlug = requiredText(source.p_share_slug, "shared_collection_not_found");
  const questionId = source.p_question_id === null || source.p_question_id === undefined
    ? null
    : requiredText(source.p_question_id, "question_not_in_collection");

  // The current client calls the four-argument overload.  Keep the older
  // three-argument public-only overload explicit rather than widening it.
  if (!hasAttachmentsArgument) {
    const body = textValue(source.p_body).trim();
    if (!body || unicodeLength(body) > 4000) fail("comment_content_invalid");
    const collection = await first(
      db,
      `SELECT id
         FROM collections
        WHERE share_slug = ?
          AND visibility IN ('unlisted', 'public')
          AND published_at IS NOT NULL
          AND archived_at IS NULL
          AND allow_comments = 1
        LIMIT 1`,
      [shareSlug],
    );
    if (!collection) fail("shared_collection_not_found", 404);
    if (questionId) {
      const question = await first(
        db,
        `SELECT 1 FROM questions
          WHERE id = ? AND collection_id = ?`,
        [questionId, collection.id],
      );
      if (!question) fail("question_not_in_collection", 400);
    }
    const id = newId();
    await run(
      db,
      `INSERT INTO comments(id,collection_id,question_id,user_id,body,attachments)
       VALUES (?,?,?,?,?,'[]')`,
      [id, collection.id, questionId, actor.id, body],
    );
    return id;
  }

  const collection = await first(
    db,
    `SELECT id
       FROM collections
      WHERE share_slug = ? AND archived_at IS NULL AND allow_comments = 1
      LIMIT 1`,
    [shareSlug],
  );
  if (!collection || !(await canAccessCollection(db, actor, collection.id))) fail("shared_collection_not_found", 404);
  const attachments = await validateCommentAttachments(db, actor, source.p_attachments);
  const body = await validateCommentBody(source.p_body, attachments);
  if (questionId) {
    const question = await first(
      db,
      `SELECT 1 FROM questions
        WHERE id = ? AND collection_id = ? AND deleted_at IS NULL`,
      [questionId, collection.id],
    );
    if (!question) fail("question_not_in_collection", 400);
  }
  const id = newId();
  await run(
    db,
    `INSERT INTO comments(id,collection_id,question_id,user_id,body,attachments)
     VALUES (?,?,?,?,?,?)`,
    [id, collection.id, questionId, actor.id, body, jsonText(attachments, [])],
  );
  return id;
}

async function updateSharedComment(db, actor, args) {
  const source = objectArgs(args);
  const commentId = requiredText(source.p_comment_id, "comment_not_editable", 200);
  const row = await first(
    db,
    `SELECT id, user_id FROM comments WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [commentId],
  );
  if (!row || row.user_id !== actor.id) fail("comment_not_editable", 403);
  const attachments = await validateCommentAttachments(db, actor, source.p_attachments ?? []);
  const body = await validateCommentBody(source.p_body, attachments);
  await run(
    db,
    `UPDATE comments
        SET body = ?, attachments = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    [body, jsonText(attachments, []), new Date().toISOString(), commentId, actor.id],
  );
}

async function deleteSharedComment(db, actor, args) {
  const commentId = requiredText(objectArgs(args).p_comment_id, "comment_not_found", 200);
  const row = await first(
    db,
    `SELECT id, user_id, collection_id, attachments
       FROM comments
      WHERE id = ? AND deleted_at IS NULL
      LIMIT 1`,
    [commentId],
  );
  if (!row) fail("comment_not_found", 404);
  if (row.user_id !== actor.id && !(await canEditCollection(db, actor, row.collection_id))) {
    fail("comment_not_deletable", 403);
  }
  await run(
    db,
    `UPDATE comments SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL`,
    [new Date().toISOString(), new Date().toISOString(), commentId],
  );
  return jsonArray(row.attachments);
}

async function validReactionKey(db, keyValue) {
  const key = requiredText(keyValue, "invalid_reaction", 64);
  if (BUILTIN_REACTIONS.has(key)) return key;
  const custom = await first(db, "SELECT 1 FROM custom_reactions WHERE reaction_key = ? LIMIT 1", [key]);
  if (!custom) fail("invalid_reaction");
  return key;
}

async function setQuestionReaction(db, actor, args) {
  const source = objectArgs(args);
  const question = await findDirectQuestion(db, actor, source.p_question_id);
  const reactionKey = await validReactionKey(db, source.p_reaction_key);
  const active = inputBoolean(source.p_active);
  if (active) {
    await run(
      db,
      `INSERT OR IGNORE INTO question_reactions(question_id,user_id,reaction_key)
       VALUES (?,?,?)`,
      [question.id, actor.id, reactionKey],
    );
  } else {
    await run(
      db,
      `DELETE FROM question_reactions
        WHERE question_id = ? AND user_id = ? AND reaction_key = ?`,
      [question.id, actor.id, reactionKey],
    );
  }
}

async function reactionCommentExists(db, questionId, commentId) {
  const native = await first(
    db,
    `SELECT 1 FROM comments
      WHERE id = ? AND question_id = ? AND deleted_at IS NULL
      LIMIT 1`,
    [commentId, questionId],
  );
  if (native) return true;
  const payload = await first(
    db,
    `SELECT 1
       FROM questions q,
            json_each(
              CASE
                WHEN json_type(q.payload, '$.comments') = 'array'
                  THEN json_extract(q.payload, '$.comments')
                ELSE '[]'
              END
            ) comment_row
      WHERE q.id = ?
        AND (
          json_extract(comment_row.value, '$.id') = ?
          OR json_extract(comment_row.value, '$.messageId') = ?
        )
      LIMIT 1`,
    [questionId, commentId, commentId],
  );
  return Boolean(payload);
}

async function setCommentReaction(db, actor, args) {
  const source = objectArgs(args);
  const question = await findDirectQuestion(db, actor, source.p_question_id);
  const commentId = requiredText(source.p_comment_id, "shared_comment_not_found", 200);
  const reactionKey = await validReactionKey(db, source.p_reaction_key);
  if (!(await reactionCommentExists(db, question.id, commentId))) fail("shared_comment_not_found", 404);
  const active = inputBoolean(source.p_active);
  if (active) {
    await run(
      db,
      `INSERT OR IGNORE INTO comment_reactions(question_id,comment_id,user_id,reaction_key)
       VALUES (?,?,?,?)`,
      [question.id, commentId, actor.id, reactionKey],
    );
  } else {
    await run(
      db,
      `DELETE FROM comment_reactions
        WHERE question_id = ? AND comment_id = ? AND user_id = ? AND reaction_key = ?`,
      [question.id, commentId, actor.id, reactionKey],
    );
  }
}

async function createCustomReaction(db, actor, args) {
  const source = objectArgs(args);
  const label = textValue(source.p_label).trim();
  const icon = textValue(source.p_icon).trim();
  if (unicodeLength(label) < 1 || unicodeLength(label) > 24) fail("custom_reaction_label_invalid");
  if (unicodeLength(icon) > 8) fail("custom_reaction_icon_invalid");
  const imagePath = textValue(source.p_image_path).trim() || null;
  if (!icon && !imagePath) fail("custom_reaction_needs_icon_or_image");
  if (imagePath) {
    const prefix = `${actor.id}/reactions/`;
    const filename = imagePath.startsWith(prefix) ? imagePath.slice(prefix.length) : "";
    if (!filename || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(filename)) fail("custom_reaction_image_invalid");
    await requireOwnedReadyMedia(
      db,
      actor,
      "reaction-assets",
      imagePath,
      REACTION_MEDIA_LIMIT,
      "custom_reaction_image_not_owned_or_ready",
    );
  }
  const key = `custom_${newId().replaceAll("-", "")}`;
  await run(
    db,
    `INSERT INTO custom_reactions(reaction_key,label,icon,image_path,icon_type,creator_user_id)
     VALUES (?,?,?,?,?,?)`,
    [key, label, icon, imagePath, imagePath ? "image" : "emoji", actor.id],
  );
  return first(
    db,
    `SELECT cr.reaction_key, cr.label, cr.icon, cr.image_path, cr.icon_type,
            cr.creator_user_id, p.display_name AS creator_display_name, cr.created_at
       FROM custom_reactions cr
       LEFT JOIN profiles p ON p.id = cr.creator_user_id
      WHERE cr.reaction_key = ?`,
    [key],
  );
}

async function markNotificationsRead(db, actor, args) {
  const source = objectArgs(args);
  const rawIds = source.p_notification_ids;
  const readAt = new Date().toISOString();
  if (rawIds === null || rawIds === undefined) {
    await run(
      db,
      `UPDATE collection_access_notifications
          SET read_at = COALESCE(read_at, ?)
        WHERE recipient_id = ?`,
      [readAt, actor.id],
    );
    return;
  }
  const ids = uniqueStrings(rawIds, "invalid_notification_ids");
  if (!ids.length) return;
  await run(
    db,
    `UPDATE collection_access_notifications
        SET read_at = COALESCE(read_at, ?)
      WHERE recipient_id = ? AND id IN (${placeholders(ids.length)})`,
    [readAt, actor.id, ...ids],
  );
}

async function requestCollectionAccess(db, actor, args) {
  const source = objectArgs(args);
  const shareSlug = requiredText(source.p_share_slug, "collection_not_found");
  const message = textValue(source.p_message);
  if (unicodeLength(message) > 1000) fail("request_message_too_long");
  const normalizedMessage = message.trim();
  const collection = await first(
    db,
    `SELECT id, owner_id, visibility
       FROM collections
      WHERE share_slug = ? AND archived_at IS NULL
      LIMIT 1`,
    [shareSlug],
  );
  if (!collection) fail("collection_not_found", 404);
  if (await canAccessCollection(db, actor, collection.id)) fail("collection_access_already_granted", 409);
  if (collection.visibility !== "request") fail("access_requests_not_enabled", 409);

  const existing = await first(
    db,
    `SELECT id
       FROM collection_access_requests
      WHERE collection_id = ? AND requester_id = ? AND status = 'pending'
      LIMIT 1`,
    [collection.id, actor.id],
  );
  const requestId = existing?.id ?? newId();
  const now = new Date().toISOString();
  const notificationId = newId();
  if (typeof db.batch !== "function") fail("d1_batch_required", 500);
  const requestStatement = existing
    ? db.prepare(`UPDATE collection_access_requests
                    SET message = ?, updated_at = ?
                  WHERE id = ? AND requester_id = ? AND status = 'pending'`)
      .bind(normalizedMessage, now, requestId, actor.id)
    : db.prepare(`INSERT INTO collection_access_requests
                    (id,collection_id,requester_id,message,status,created_at,updated_at)
                  VALUES (?,?,?,?, 'pending',?,?)`)
      .bind(requestId, collection.id, actor.id, normalizedMessage, now, now);
  const notificationStatement = db.prepare(`INSERT INTO collection_access_notifications
      (id,recipient_id,collection_id,request_id,actor_id,kind,payload,created_at)
    VALUES (?,?,?,?,?,'access_requested',?,?)`)
    .bind(
      notificationId,
      collection.owner_id,
      collection.id,
      requestId,
      actor.id,
      jsonText({ message: normalizedMessage }, {}),
      now,
    );
  await db.batch([requestStatement, notificationStatement]);
  return requestId;
}

async function recordSharedAttempt(db, actor, args) {
  const source = objectArgs(args);
  const question = await findSharedQuestion(db, actor, source.p_share_slug, source.p_question_id);
  const clientAttemptId = requiredText(source.p_client_attempt_id, "invalid_client_attempt_id", 200);
  const grade = requiredText(source.p_grade, "invalid_grade", 8);
  if (!GRADES.has(grade)) fail("invalid_grade");
  const elapsed = source.p_elapsed_ms === null || source.p_elapsed_ms === undefined || source.p_elapsed_ms === ""
    ? null
    : Number(source.p_elapsed_ms);
  if (elapsed !== null && (!Number.isSafeInteger(elapsed) || elapsed < 0 || elapsed > 86400000)) fail("invalid_elapsed_time");
  const answer = jsonText(source.p_answer, {});
  const answeredAt = normalizeTimestamp(source.p_answered_at);
  const existing = await first(
    db,
    `SELECT id, answer, grade, elapsed_ms, answered_at
       FROM answer_attempts
      WHERE user_id = ? AND client_attempt_id = ?
      LIMIT 1`,
    [actor.id, clientAttemptId],
  );
  if (existing) {
    if (
      existing.answer === answer
      && existing.grade === grade
      && existing.elapsed_ms === elapsed
      && existing.answered_at === answeredAt
    ) return existing.id;
    await run(
      db,
      `UPDATE answer_attempts
          SET answer = ?, grade = ?, elapsed_ms = ?, answered_at = ?
        WHERE id = ? AND user_id = ?`,
      [answer, grade, elapsed, answeredAt, existing.id, actor.id],
    );
    return existing.id;
  }
  const id = newId();
  try {
    await run(
      db,
      `INSERT INTO answer_attempts
        (id,client_attempt_id,user_id,question_id,answer,grade,elapsed_ms,answered_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      [id, clientAttemptId, actor.id, question.id, answer, grade, elapsed, answeredAt],
    );
  } catch (error) {
    // A concurrent retry may have won the unique key between the read and
    // insert.  Re-read that exact actor/key and apply the same live upsert.
    const raced = await first(
      db,
      `SELECT id, answer, grade, elapsed_ms, answered_at
         FROM answer_attempts
        WHERE user_id = ? AND client_attempt_id = ?
        LIMIT 1`,
      [actor.id, clientAttemptId],
    );
    if (!raced) throw error;
    if (
      raced.answer === answer
      && raced.grade === grade
      && raced.elapsed_ms === elapsed
      && raced.answered_at === answeredAt
    ) return raced.id;
    await run(
      db,
      `UPDATE answer_attempts
          SET answer = ?, grade = ?, elapsed_ms = ?, answered_at = ?
        WHERE id = ? AND user_id = ?`,
      [answer, grade, elapsed, answeredAt, raced.id, actor.id],
    );
    return raced.id;
  }
  return id;
}

async function writeAttemptsTable(db, actor, rows) {
  if (!Array.isArray(rows)) fail("rows_required");
  if (rows.length > 100) fail("write_batch_too_large", 422);
  if (!rows.length) return { upserted: 0 };
  const seenAttempts = new Set();
  const normalized = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) fail("invalid_attempt_row");
    const userId = requiredText(row.user_id, "attempt_user_mismatch", 200);
    if (userId !== actor.id) fail("attempt_user_mismatch", 403);
    const clientAttemptId = requiredText(row.client_attempt_id, "invalid_client_attempt_id", 200);
    if (seenAttempts.has(clientAttemptId)) fail("duplicate_client_attempt_id");
    seenAttempts.add(clientAttemptId);
    const questionId = requiredText(row.question_id, "question_not_found", 200);
    const grade = requiredText(row.grade, "invalid_grade", 8);
    if (!GRADES.has(grade)) fail("invalid_grade");
    const elapsed = row.elapsed_ms === null || row.elapsed_ms === undefined || row.elapsed_ms === ""
      ? null
      : Number(row.elapsed_ms);
    if (elapsed !== null && (!Number.isSafeInteger(elapsed) || elapsed < 0 || elapsed > 86400000)) fail("invalid_elapsed_time");
    normalized.push({
      clientAttemptId,
      questionId,
      answer: jsonText(row.answer, {}),
      grade,
      elapsed,
      answeredAt: normalizeTimestamp(row.answered_at),
    });
  }
  const questionRows = await all(
    db,
    `SELECT id, collection_id
       FROM questions
      WHERE deleted_at IS NULL
        AND id IN (${placeholders(normalized.length)})`,
    normalized.map((row) => row.questionId),
  );
  const questionById = new Map(questionRows.map((row) => [row.id, row]));
  if (questionById.size !== new Set(normalized.map((row) => row.questionId)).size) fail("question_not_found", 404);
  const collectionIds = [...new Set(questionRows.map((row) => row.collection_id))];
  if (collectionIds.length > 32) fail("write_batch_too_large", 422);
  const allowedCollections = new Set();
  for (const collectionId of collectionIds) {
    if (await canAccessCollection(db, actor, collectionId)) allowedCollections.add(collectionId);
  }
  if (normalized.some((row) => !allowedCollections.has(questionById.get(row.questionId).collection_id))) {
    fail("question_not_accessible", 403);
  }
  const existingRows = await all(
    db,
    `SELECT client_attempt_id, answer, grade, elapsed_ms, answered_at
       FROM answer_attempts
      WHERE user_id = ?
        AND client_attempt_id IN (${placeholders(normalized.length)})`,
    [actor.id, ...normalized.map((row) => row.clientAttemptId)],
  );
  const existingByClientId = new Map(existingRows.map((row) => [row.client_attempt_id, row]));
  const pending = normalized.filter((row) => {
    const existing = existingByClientId.get(row.clientAttemptId);
    return !existing
      || existing.answer !== row.answer
      || existing.grade !== row.grade
      || existing.elapsed_ms !== row.elapsed
      || existing.answered_at !== row.answeredAt;
  });
  if (!pending.length) return { upserted: normalized.length };
  if (typeof db.batch !== "function") fail("d1_batch_required", 500);
  const statements = pending.map((row) => db.prepare(`
    INSERT INTO answer_attempts
      (client_attempt_id,user_id,question_id,answer,grade,elapsed_ms,answered_at)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(user_id,client_attempt_id) DO UPDATE SET
      answer = excluded.answer,
      grade = excluded.grade,
      elapsed_ms = excluded.elapsed_ms,
      answered_at = excluded.answered_at
    RETURNING id`)
    .bind(row.clientAttemptId, actor.id, row.questionId, row.answer, row.grade, row.elapsed, row.answeredAt));
  await db.batch(statements);
  return { upserted: normalized.length };
}

const PROFILE_WRITE_FIELDS = new Set(["id", "display_name", "updated_at"]);

function profileWriteRow(rows) {
  const row = Array.isArray(rows)
    ? (rows.length === 1 ? rows[0] : null)
    : rows;
  if (!row || typeof row !== "object" || Array.isArray(row)) fail("profile_row_invalid");
  if (Object.keys(row).some((field) => !PROFILE_WRITE_FIELDS.has(field))) {
    // In particular, do not accept identity, privilege, or creation-time
    // fields supplied by the browser through this compatibility endpoint.
    fail("profile_fields_not_allowed");
  }
  const id = requiredText(row.id, "profile_actor_mismatch", 200);
  const displayName = textValue(row.display_name).trim();
  if (unicodeLength(displayName) < 1 || unicodeLength(displayName) > 5) {
    fail("profile_display_name_invalid");
  }
  return {
    id,
    displayName,
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

async function writeProfileTable(db, actor, rows) {
  const row = profileWriteRow(rows);
  if (row.id !== actor.id) fail("profile_actor_mismatch", 403);
  const updated = await first(
    db,
    `UPDATE profiles
        SET display_name = ?, updated_at = ?
      WHERE id = ?
      RETURNING display_name`,
    [row.displayName, row.updatedAt, actor.id],
  );
  if (!updated) fail("profile_not_found", 404);
  return { display_name: updated.display_name };
}

export async function writeTable(table, rows, ctx = {}) {
  if (!WRITE_TABLES.has(table)) throw new Error("table_not_implemented");
  const db = requireDb(ctx);
  const actor = requireActor(ctx.actor ?? null);
  if (table === "answer_attempts") return writeAttemptsTable(db, actor, rows);
  if (table === "profiles") return writeProfileTable(db, actor, rows);
  throw new Error("table_not_implemented");
}

export async function writeRpc(name, args = {}, ctx = {}) {
  if (!WRITE_RPC_SET.has(name)) throw new Error("rpc_not_implemented");
  const db = requireDb(ctx);
  const actor = requireActor(ctx.actor ?? null);
  switch (name) {
    case "record_shared_attempt":
      return recordSharedAttempt(db, actor, args);
    case "post_shared_comment":
      return postSharedComment(db, actor, args);
    case "update_shared_comment":
      return updateSharedComment(db, actor, args);
    case "delete_shared_comment":
      return deleteSharedComment(db, actor, args);
    case "set_shared_question_reaction":
      return setQuestionReaction(db, actor, args);
    case "set_shared_comment_reaction":
      return setCommentReaction(db, actor, args);
    case "create_custom_reaction":
      return createCustomReaction(db, actor, args);
    case "mark_collection_notifications_read":
      return markNotificationsRead(db, actor, args);
    case "request_collection_access":
      return requestCollectionAccess(db, actor, args);
    default:
      throw new Error("rpc_not_implemented");
  }
}
