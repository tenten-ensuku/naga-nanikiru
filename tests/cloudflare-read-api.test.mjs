import test from "node:test";
import assert from "node:assert/strict";
import { readRpc, readTable, READ_RPCS } from "../cloudflare/read-api.mjs";
import { testD1 } from "./helpers/cloudflare-d1.mjs";

const ACTOR = { id: "user-owner", is_admin: false };
const OTHER = { id: "user-student", is_admin: false };

test('authenticated-only reads reject anonymous calls before querying D1', async () => {
  const db={prepare(){throw Error('Anonymous query reached D1');}};
  for (const name of ['get_shared_reaction_summary','get_shared_comment_changes','list_my_collections','list_collection_directory','list_collection_members','list_collection_notifications','load_my_attempts_for_collection','list_custom_reactions','get_question_poll_stats']) {
    await assert.rejects(readRpc(name,{}, {db,actor:null}), error=>error.status===401);
  }
});

async function exec(db, sql, ...params) {
  return db.prepare(sql).bind(...params).run();
}

function countedDb(db) {
  let queryCount = 0;
  return {
    get queryCount() {
      return queryCount;
    },
    prepare(sql) {
      queryCount += 1;
      return db.prepare(sql);
    },
    batch(statements) {
      return db.batch(statements);
    },
  };
}

async function fixture() {
  const db = testD1();
  await exec(db, "INSERT INTO profiles(id,display_name) VALUES (?,?), (?,?)", "user-owner", "Owner", "user-student", "Student");
  await exec(
    db,
    `INSERT INTO workspaces(id,owner_id,name) VALUES (?,?,?)`,
    "workspace-fixture",
    ACTOR.id,
    "Fixture workspace",
  );
  await exec(
    db,
    `INSERT INTO collections
      (id,owner_id,title,description,visibility,share_slug,allow_comments,allow_contributions,published_at,series_key)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
    "collection-public",
    ACTOR.id,
    "Public fixture",
    "Fixture only",
    "public",
    "public-fixture",
    0,
    1,
    "2026-09-10T00:00:00.000Z",
    null,
  );
  await exec(
    db,
    `INSERT INTO collections
      (id,owner_id,title,description,visibility,share_slug,published_at)
      VALUES (?,?,?,?,?,?,?)`,
    "collection-private",
    OTHER.id,
    "Private fixture",
    "Fixture only",
    "private",
    "private-fixture",
    null,
  );
  await exec(
    db,
    `INSERT INTO questions
      (id,collection_id,created_by,title,legacy_key,sort_order,source_kind,decision_type,payload,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    "question-public",
    "collection-public",
    ACTOR.id,
    "Question fixture",
    "legacy-public",
    1,
    "manual",
    "discard",
    JSON.stringify({ number: "7", reach: [0, 1], comments: [{ id: "payload-comment" }] }),
    "2026-09-10T00:00:00.000Z",
    "2026-09-10T00:00:01.000Z",
  );
  await exec(
    db,
    `INSERT INTO questions
      (id,collection_id,created_by,title,legacy_key,sort_order,source_kind,decision_type,payload,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    "question-private",
    "collection-private",
    OTHER.id,
    "Private question",
    "legacy-private",
    1,
    "manual",
    "discard",
    JSON.stringify({ number: 8 }),
    "2026-09-10T00:00:00.000Z",
    "2026-09-10T00:00:01.000Z",
  );
  await exec(
    db,
    `INSERT INTO comments(id,collection_id,question_id,user_id,body,attachments,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)`,
    "comment-public",
    "collection-public",
    "question-public",
    OTHER.id,
    "fixture comment",
    JSON.stringify([{ path: "fixture/comment.png", alt: "fixture" }]),
    "2026-09-10T00:01:00.000Z",
    "2026-09-10T00:01:00.000Z",
  );
  await exec(
    db,
    `INSERT INTO answer_attempts(client_attempt_id,user_id,question_id,answer,grade,elapsed_ms,answered_at)
      VALUES (?,?,?,?,?,?,?)`,
    "attempt-owner",
    ACTOR.id,
    "question-public",
    JSON.stringify({ selected: "5m", riichi: true }),
    "◎",
    2500,
    "2026-09-10T00:02:00.000Z",
  );
  await exec(
    db,
    `INSERT INTO answer_attempts(client_attempt_id,user_id,question_id,answer,grade,elapsed_ms,answered_at)
      VALUES (?,?,?,?,?,?,?)`,
    "attempt-student",
    OTHER.id,
    "question-public",
    JSON.stringify({ selected: "3m", riichi: false }),
    "△",
    3500,
    "2026-09-10T00:03:00.000Z",
  );
  await exec(
    db,
    `INSERT INTO question_reactions(question_id,user_id,reaction_key)
      VALUES (?,?,?)`,
    "question-public",
    ACTOR.id,
    "👍",
  );
  await exec(
    db,
    `INSERT INTO comment_reactions(question_id,comment_id,user_id,reaction_key)
      VALUES (?,?,?,?)`,
    "question-public",
    "payload-comment",
    OTHER.id,
    "👏",
  );
  await exec(
    db,
    `INSERT INTO workspace_members(workspace_id,user_id,role,status)
      VALUES (?,?,?,?)`,
    "workspace-fixture",
    ACTOR.id,
    "owner",
    "active",
  );
  return db;
}

test("read RPC whitelist rejects writes and preserves lightweight index/detail split", async () => {
  const db = await fixture();
  try {
    assert.ok(READ_RPCS.includes("get_shared_question_index_page"));
    assert.ok(!READ_RPCS.includes("record_shared_attempt"));
    const rows = await readRpc(
      "get_shared_question_index_page",
      { p_share_slug: "public-fixture", p_offset: 0, p_limit: 100 },
      { db, actor: null },
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].question_number, 7);
    assert.equal(rows[0].has_riichi_judgment, true);
    assert.equal(rows[0].total_count, 1);
    assert.equal(Object.hasOwn(rows[0], "payload"), false);

    const detail = await readRpc(
      "get_shared_question_detail",
      { p_share_slug: "public-fixture", p_question_id: "question-public" },
      { db, actor: null },
    );
    assert.equal(detail.length, 1);
    assert.deepEqual(detail[0].payload, { number: "7", reach: [0, 1], comments: [{ id: "payload-comment" }] });

    await assert.rejects(
      () => readRpc("record_shared_attempt", {}, { db, actor: ACTOR }),
      (error) => error instanceof Error && error.message === "rpc_not_implemented",
    );
  } finally {
    db.close();
  }
});

test("shared collection permissions, comments, and read-only reaction summary follow live boundaries", async () => {
  const db = await fixture();
  try {
    const collection = await readRpc("get_shared_collection", { p_share_slug: "private-fixture" }, { db, actor: null });
    assert.equal(collection.can_view, false);
    assert.equal(collection.allow_comments, true);

    const privateIndex = await readRpc("get_shared_question_index", { p_share_slug: "private-fixture" }, { db, actor: ACTOR });
    assert.deepEqual(privateIndex, []);

    const directory = await readRpc("list_collection_directory", {}, { db, actor: ACTOR });
    assert.equal(directory.length, 1);
    assert.equal(directory[0].can_view, true);
    const mine = await readRpc("list_my_collections", {}, { db, actor: ACTOR });
    assert.equal(mine.length, 1);
    assert.equal(mine[0].can_manage, true);
    assert.deepEqual(
      await readRpc("get_collection_volumes", { p_share_slug: "public-fixture" }, { db, actor: ACTOR }),
      [],
    );

    const comments = await readRpc(
      "get_shared_comments",
      { p_share_slug: "public-fixture", p_question_id: "question-public" },
      { db, actor: null },
    );
    assert.equal(comments.length, 1);
    assert.deepEqual(comments[0].attachments, [{ path: "fixture/comment.png", alt: "fixture" }]);

    const changes = await readRpc(
      "get_shared_comment_changes",
      { p_share_slug: "public-fixture", p_after: null, p_after_id: "00000000-0000-0000-0000-000000000000", p_limit: 100 },
      { db, actor: ACTOR },
    );
    assert.equal(changes.rows.length, 1);
    assert.equal(changes.rows[0].body, "fixture comment");
    assert.equal(changes.cursor.id, "comment-public");

    const reactions = await readRpc(
      "get_shared_reaction_summary",
      { p_share_slug: "public-fixture", p_question_id: "question-public" },
      { db, actor: ACTOR },
    );
    assert.equal(reactions.length, 2);
    assert.equal(reactions.find((row) => row.scope === "question").reacted_by_me, true);
    assert.equal(reactions.find((row) => row.scope === "comment").reaction_count, 1);
  } finally {
    db.close();
  }
});

test("library, attempts, poll stats, and direct table reads parse JSON and booleans explicitly", async () => {
  const db = await fixture();
  try {
    const summary = await readRpc(
      "get_collection_library_summary",
      { p_share_slug: "public-fixture", p_archived_keys: [] },
      { db, actor: ACTOR },
    );
    assert.deepEqual(summary[0], {
      question_count: 1,
      answered_count: 1,
      mastered_count: 1,
      last_activity_at: "2026-09-10T00:02:00.000Z",
    });

    const attempts = await readRpc(
      "load_my_attempts_for_collection",
      { p_share_slug: "public-fixture", p_limit: 10, p_offset: 0 },
      { db, actor: ACTOR },
    );
    assert.deepEqual(attempts[0].answer, { selected: "5m", riichi: true });

    const poll = await readRpc(
      "get_question_poll_stats",
      { p_share_slug: "public-fixture", p_question_id: "question-public" },
      { db, actor: ACTOR },
    );
    assert.equal(poll[0].sample_size, 2);
    assert.equal(poll[0].average_seconds, 3);
    assert.equal(poll[0].choice_counts["5m|reach"], 1);

    const questionRows = await readTable("questions", { legacyKeys: ["legacy-public", "legacy-private"] }, { db, actor: null });
    assert.deepEqual(questionRows, [{ id: "question-public", legacy_key: "legacy-public" }]);
    const ownAttempts = await readTable("answer_attempts", { limit: 10 }, { db, actor: ACTOR });
    assert.equal(ownAttempts.length, 1);
    assert.equal(ownAttempts[0].client_attempt_id, "attempt-owner");
    const memberships = await readTable("workspace_members", {}, { db, actor: ACTOR });
    assert.deepEqual(memberships, [{ workspace_id: "workspace-fixture", role: "owner", status: "active" }]);
  } finally {
    db.close();
  }
});

test("student summary uses canViewStudent and unknown table names fail closed", async () => {
  const db = await fixture();
  try {
    const hidden = await readTable("student_learning_summary", {}, { db, actor: ACTOR });
    assert.equal(hidden.length, 1);
    assert.equal(hidden[0].user_id, ACTOR.id);
    assert.equal(hidden[0].attempt_count, 1);
    const directoryDb = countedDb(db);
    await readRpc("list_collection_directory", {}, { db: directoryDb, actor: ACTOR });
    assert.equal(directoryDb.queryCount, 1);
    const collectionsDb = countedDb(db);
    await readRpc("list_my_collections", {}, { db: collectionsDb, actor: ACTOR });
    assert.equal(collectionsDb.queryCount, 1);
    const volumesDb = countedDb(db);
    await readRpc("get_collection_volumes", { p_share_slug: "public-fixture" }, { db: volumesDb, actor: ACTOR });
    assert.ok(volumesDb.queryCount <= 4);
    await assert.rejects(
      () => readTable("profiles", {}, { db, actor: ACTOR }),
      (error) => error instanceof Error && error.message === "rpc_not_implemented",
    );
  } finally {
    db.close();
  }
});
