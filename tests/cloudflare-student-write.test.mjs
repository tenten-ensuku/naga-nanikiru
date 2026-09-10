import test from "node:test";
import assert from "node:assert/strict";
import { WRITE_RPCS, writeRpc, writeTable } from "../cloudflare/student-write-api.mjs";
import { testD1 } from "./helpers/cloudflare-d1.mjs";

const STUDENT = { id: "student-1", is_admin: false };
const OWNER = { id: "owner-1", is_admin: false };
const EDITOR = { id: "editor-1", is_admin: false };
const OTHER = { id: "other-1", is_admin: false };

async function exec(db, sql, ...params) {
  return db.prepare(sql).bind(...params).run();
}

async function first(db, sql, ...params) {
  return db.prepare(sql).bind(...params).first();
}

async function count(db, table, where = "", ...params) {
  const row = await first(db, `SELECT COUNT(*) AS n FROM ${table}${where ? ` WHERE ${where}` : ""}`, ...params);
  return Number(row.n);
}

async function expectCode(operation, code) {
  await assert.rejects(operation, (error) => error?.code === code);
}

async function fixture() {
  const db = testD1();
  await exec(
    db,
    `INSERT INTO profiles(id,display_name) VALUES (?,?), (?,?), (?,?), (?,?)`,
    STUDENT.id,
    "Student",
    OWNER.id,
    "Owner",
    EDITOR.id,
    "Editor",
    OTHER.id,
    "Other",
  );
  await exec(
    db,
    `INSERT INTO collections
      (id,owner_id,title,description,visibility,share_slug,allow_comments,allow_contributions,published_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
    "collection-public",
    OWNER.id,
    "Public fixture",
    "local fixture",
    "public",
    "public-student",
    1,
    1,
    "2026-09-10T00:00:00.000Z",
  );
  await exec(
    db,
    `INSERT INTO collections
      (id,owner_id,title,description,visibility,share_slug,allow_comments,allow_contributions,published_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
    "collection-request",
    OWNER.id,
    "Request fixture",
    "local fixture",
    "request",
    "request-student",
    1,
    1,
    "2026-09-10T00:00:00.000Z",
  );
  await exec(
    db,
    `INSERT INTO collections
      (id,owner_id,title,description,visibility,share_slug,allow_comments,allow_contributions)
      VALUES (?,?,?,?,?,?,?,?)`,
    "collection-private",
    OWNER.id,
    "Private fixture",
    "local fixture",
    "private",
    "private-student",
    1,
    1,
  );
  await exec(
    db,
    `INSERT INTO questions
      (id,collection_id,created_by,title,legacy_key,source_kind,decision_type,payload)
      VALUES (?,?,?,?,?,?,?,?)`,
    "question-public",
    "collection-public",
    OWNER.id,
    "Public question",
    "legacy-public",
    "manual",
    "discard",
    JSON.stringify({ comments: [{ id: "payload-comment" }] }),
  );
  await exec(
    db,
    `INSERT INTO questions
      (id,collection_id,created_by,title,legacy_key,source_kind,decision_type,payload)
      VALUES (?,?,?,?,?,?,?,?)`,
    "question-private",
    "collection-private",
    OWNER.id,
    "Private question",
    "legacy-private",
    "manual",
    "discard",
    "{}",
  );
  await exec(
    db,
    `INSERT INTO collection_members(collection_id,user_id,role,status)
      VALUES (?,?,?,?)`,
    "collection-public",
    EDITOR.id,
    "editor",
    "active",
  );
  await exec(
    db,
    `INSERT INTO comments(id,collection_id,question_id,user_id,body,attachments)
      VALUES (?,?,?,?,?,?), (?,?,?,?,?,?)`,
    "comment-student",
    "collection-public",
    "question-public",
    STUDENT.id,
    "student comment",
    "[]",
    "comment-owner",
    "collection-public",
    "question-public",
    OWNER.id,
    "owner comment",
    "[]",
  );
  await exec(
    db,
    `INSERT INTO media_assets(object_key,bucket,path,owner_id,collection_id,size_bytes,sha256,content_type,state)
      VALUES (?,?,?,?,?,?,?,?,?), (?,?,?,?,?,?,?,?,?), (?,?,?,?,?,?,?,?,?)`,
    "comment-assets/student-1/comments/ok.png",
    "comment-assets",
    "student-1/comments/ok.png",
    STUDENT.id,
    "collection-public",
    128,
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "image/png",
    "ready",
    "comment-assets/other-1/comments/other.png",
    "comment-assets",
    "other-1/comments/other.png",
    OTHER.id,
    "collection-public",
    128,
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "image/png",
    "ready",
    "reaction-assets/student-1/reactions/ok.gif",
    "reaction-assets",
    "student-1/reactions/ok.gif",
    STUDENT.id,
    "collection-public",
    128,
    "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "image/gif",
    "ready",
  );
  await exec(
    db,
    `INSERT INTO collection_access_notifications
      (id,recipient_id,collection_id,actor_id,kind,payload)
      VALUES (?,?,?,?,?,?), (?,?,?,?,?,?)`,
    "notification-student",
    STUDENT.id,
    "collection-public",
    OWNER.id,
    "access_requested",
    JSON.stringify({ message: "one" }),
    "notification-other",
    OTHER.id,
    "collection-public",
    OWNER.id,
    "access_requested",
    JSON.stringify({ message: "two" }),
  );
  return db;
}

test("attempt RPC and answer_attempts table preserve actor ownership, validation, and retry idempotence", async () => {
  const db = await fixture();
  try {
    assert.ok(Object.isFrozen(WRITE_RPCS));
    assert.ok(WRITE_RPCS.includes("record_shared_attempt"));
    assert.ok(!WRITE_RPCS.includes("update_profile_display_name"));
    await expectCode(
      () => writeRpc("record_shared_attempt", { p_share_slug: "public-student", p_question_id: "question-public" }, { db, actor: null }),
      "login_required",
    );
    const args = {
      p_share_slug: "public-student",
      p_question_id: "question-public",
      p_client_attempt_id: "client-retry-1",
      p_answer: { selected: "5m", riichi: false },
      p_grade: "〇",
      p_elapsed_ms: 1200,
      p_answered_at: "2026-09-10T01:00:00.000Z",
    };
    const firstId = await writeRpc("record_shared_attempt", args, { db, actor: STUDENT });
    let duplicateAttemptUpdates = 0;
    const trackedAttemptDb = new Proxy(db, {
      get(target, property) {
        if (property === "prepare") {
          return (sql) => {
            if (/UPDATE\s+answer_attempts/i.test(sql)) duplicateAttemptUpdates += 1;
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const duplicateId = await writeRpc("record_shared_attempt", args, { db: trackedAttemptDb, actor: STUDENT });
    assert.equal(duplicateId, firstId);
    assert.equal(duplicateAttemptUpdates, 0);
    const secondId = await writeRpc(
      "record_shared_attempt",
      { ...args, p_answer: { selected: "6m" }, p_grade: "◎" },
      { db, actor: STUDENT },
    );
    assert.equal(secondId, firstId);
    assert.equal(await count(db, "answer_attempts", "user_id = ? AND client_attempt_id = ?", STUDENT.id, args.p_client_attempt_id), 1);
    const retry = await first(db, "SELECT answer,grade FROM answer_attempts WHERE id = ?", firstId);
    assert.deepEqual(JSON.parse(retry.answer), { selected: "6m" });
    assert.equal(retry.grade, "◎");
    await expectCode(
      () => writeRpc("record_shared_attempt", { ...args, p_client_attempt_id: "bad-grade", p_grade: "invalid" }, { db, actor: STUDENT }),
      "invalid_grade",
    );
    await expectCode(
      () => writeRpc("record_shared_attempt", { ...args, p_client_attempt_id: "bad-time", p_elapsed_ms: 86400001 }, { db, actor: STUDENT }),
      "invalid_elapsed_time",
    );
    await expectCode(
      () => writeRpc("record_shared_attempt", { ...args, p_question_id: "question-private", p_client_attempt_id: "private" }, { db, actor: STUDENT }),
      "shared_question_not_found",
    );

    const importedRow = {
      client_attempt_id: "import-1",
      user_id: STUDENT.id,
      question_id: "question-public",
      answer: { selected: "1m" },
      grade: "△",
      elapsed_ms: 900,
      answered_at: "2026-09-10T01:01:00.000Z",
    };
    const tableResult = await writeTable("answer_attempts", [importedRow], { db, actor: STUDENT });
    assert.deepEqual(tableResult, { upserted: 1 });
    let duplicateTableBatches = 0;
    const trackedTableDb = new Proxy(db, {
      get(target, property) {
        if (property === "batch") {
          return (statements) => {
            duplicateTableBatches += 1;
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    assert.deepEqual(
      await writeTable("answer_attempts", [importedRow], { db: trackedTableDb, actor: STUDENT }),
      { upserted: 1 },
    );
    assert.equal(duplicateTableBatches, 0);
    await expectCode(
      () => writeTable("answer_attempts", [{
        client_attempt_id: "stolen",
        user_id: OTHER.id,
        question_id: "question-public",
        answer: {},
        grade: "〇",
      }], { db, actor: STUDENT }),
      "attempt_user_mismatch",
    );
  } finally {
    db.close();
  }
});

test("comment writes enforce author/editor rules, logical deletion, and ready owned attachments", async () => {
  const db = await fixture();
  try {
    await expectCode(
      () => writeRpc("post_shared_comment", { p_share_slug: "public-student", p_body: "x", p_attachments: [] }, { db, actor: null }),
      "login_required",
    );
    const commentId = await writeRpc("post_shared_comment", {
      p_share_slug: "public-student",
      p_question_id: "question-public",
      p_body: "new student comment",
      p_attachments: [{ path: "student-1/comments/ok.png", alt: "ok" }],
    }, { db, actor: STUDENT });
    const created = await first(db, "SELECT user_id,body,attachments FROM comments WHERE id = ?", commentId);
    assert.equal(created.user_id, STUDENT.id);
    assert.deepEqual(JSON.parse(created.attachments), [{ path: "student-1/comments/ok.png", alt: "ok" }]);
    await expectCode(
      () => writeRpc("post_shared_comment", {
        p_share_slug: "public-student",
        p_question_id: "question-public",
        p_body: "bad attachment",
        p_attachments: [{ path: "student-1/comments/not-ready.png", alt: "not ready" }],
      }, { db, actor: STUDENT }),
      "comment_attachment_not_owned_or_ready",
    );
    await expectCode(
      () => writeRpc("post_shared_comment", {
        p_share_slug: "public-student",
        p_question_id: "question-public",
        p_body: "foreign attachment",
        p_attachments: [{ path: "other-1/comments/other.png", alt: "not mine" }],
      }, { db, actor: STUDENT }),
      "comment_attachments_invalid",
    );
    await writeRpc("update_shared_comment", {
      p_comment_id: commentId,
      p_body: "updated student comment",
      p_attachments: [],
    }, { db, actor: STUDENT });
    await expectCode(
      () => writeRpc("update_shared_comment", { p_comment_id: "comment-owner", p_body: "takeover", p_attachments: [] }, { db, actor: STUDENT }),
      "comment_not_editable",
    );
    const removed = await writeRpc("delete_shared_comment", { p_comment_id: commentId }, { db, actor: STUDENT });
    assert.deepEqual(removed, []);
    assert.ok((await first(db, "SELECT deleted_at FROM comments WHERE id = ?", commentId)).deleted_at);
    await expectCode(
      () => writeRpc("delete_shared_comment", { p_comment_id: commentId }, { db, actor: STUDENT }),
      "comment_not_found",
    );
    await writeRpc("delete_shared_comment", { p_comment_id: "comment-owner" }, { db, actor: EDITOR });
    assert.ok((await first(db, "SELECT deleted_at FROM comments WHERE id = 'comment-owner'")).deleted_at);
  } finally {
    db.close();
  }
});

test("question/native/payload reactions and custom reaction media checks fail closed", async () => {
  const db = await fixture();
  try {
    await expectCode(
      () => writeRpc("set_shared_question_reaction", { p_question_id: "question-public", p_reaction_key: "ari", p_active: true }, { db, actor: null }),
      "login_required",
    );
    await writeRpc("set_shared_question_reaction", { p_question_id: "question-public", p_reaction_key: "ari", p_active: true }, { db, actor: STUDENT });
    await writeRpc("set_shared_question_reaction", { p_question_id: "question-public", p_reaction_key: "ari", p_active: true }, { db, actor: STUDENT });
    await writeRpc("set_shared_question_reaction", { p_question_id: "question-public", p_reaction_key: "like", p_active: true }, { db, actor: STUDENT });
    assert.equal(await count(db, "question_reactions", "question_id = ? AND user_id = ?", "question-public", STUDENT.id), 2);
    await expectCode(
      () => writeRpc("set_shared_question_reaction", { p_question_id: "question-public", p_reaction_key: "not-valid", p_active: true }, { db, actor: STUDENT }),
      "invalid_reaction",
    );
    await writeRpc("set_shared_comment_reaction", { p_question_id: "question-public", p_comment_id: "payload-comment", p_reaction_key: "preference", p_active: true }, { db, actor: STUDENT });
    await writeRpc("set_shared_comment_reaction", { p_question_id: "question-public", p_comment_id: "comment-owner", p_reaction_key: "preference", p_active: true }, { db, actor: STUDENT });
    assert.equal(await count(db, "comment_reactions", "question_id = ? AND user_id = ?", "question-public", STUDENT.id), 2);
    await expectCode(
      () => writeRpc("set_shared_comment_reaction", { p_question_id: "question-public", p_comment_id: "missing-comment", p_reaction_key: "preference", p_active: true }, { db, actor: STUDENT }),
      "shared_comment_not_found",
    );
    const emoji = await writeRpc("create_custom_reaction", { p_label: "考え中", p_icon: "🤔", p_image_path: null }, { db, actor: STUDENT });
    assert.equal(emoji.icon_type, "emoji");
    const image = await writeRpc("create_custom_reaction", { p_label: "画像", p_icon: "", p_image_path: "student-1/reactions/ok.gif" }, { db, actor: STUDENT });
    assert.equal(image.icon_type, "image");
    await expectCode(
      () => writeRpc("create_custom_reaction", { p_label: "盗用", p_icon: "", p_image_path: "other-1/comments/other.png" }, { db, actor: STUDENT }),
      "custom_reaction_image_invalid",
    );
  } finally {
    db.close();
  }
});

test("notification marking and access requests remain actor-scoped and retry-safe", async () => {
  const db = await fixture();
  try {
    await expectCode(
      () => writeRpc("mark_collection_notifications_read", { p_notification_ids: ["notification-student"] }, { db, actor: null }),
      "login_required",
    );
    await writeRpc("mark_collection_notifications_read", { p_notification_ids: ["notification-student", "notification-other"] }, { db, actor: STUDENT });
    assert.ok((await first(db, "SELECT read_at FROM collection_access_notifications WHERE id = 'notification-student'")).read_at);
    assert.equal((await first(db, "SELECT read_at FROM collection_access_notifications WHERE id = 'notification-other'")).read_at, null);

    await expectCode(
      () => writeRpc("request_collection_access", { p_share_slug: "request-student", p_message: "please" }, { db, actor: null }),
      "login_required",
    );
    const requestArgs = { p_share_slug: "request-student", p_message: " please " };
    const firstRequest = await writeRpc("request_collection_access", requestArgs, { db, actor: STUDENT });
    const secondRequest = await writeRpc("request_collection_access", { ...requestArgs, p_message: "updated" }, { db, actor: STUDENT });
    assert.equal(secondRequest, firstRequest);
    assert.equal(await count(db, "collection_access_requests", "collection_id = ? AND requester_id = ?", "collection-request", STUDENT.id), 1);
    assert.equal(await count(db, "collection_access_notifications", "request_id = ?", firstRequest), 2);
    const profile = await writeTable("profiles", {
      id: STUDENT.id,
      display_name: " 学生 ",
      updated_at: "2026-09-10T01:02:00.000Z",
    }, { db, actor: STUDENT });
    assert.deepEqual(profile, { display_name: "学生" });
    assert.equal((await first(db, "SELECT display_name FROM profiles WHERE id = ?", STUDENT.id)).display_name, "学生");
    await expectCode(
      () => writeTable("profiles", { id: OTHER.id, display_name: "横取り" }, { db, actor: STUDENT }),
      "profile_actor_mismatch",
    );
    await expectCode(
      () => writeTable("profiles", { id: STUDENT.id, display_name: "123456" }, { db, actor: STUDENT }),
      "profile_display_name_invalid",
    );
    await expectCode(
      () => writeTable("profiles", { id: "new-user", display_name: "新規" }, { db, actor: { id: "new-user", is_admin: false } }),
      "profile_not_found",
    );
    await expectCode(
      () => writeTable("profiles", { id: STUDENT.id, display_name: "学生", discord_user_id: "spoof" }, { db, actor: STUDENT }),
      "profile_fields_not_allowed",
    );
  } finally {
    db.close();
  }
});
