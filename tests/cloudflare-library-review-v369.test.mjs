import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { testD1 } from "./helpers/cloudflare-d1.mjs";
import { readRpc } from "../cloudflare/read-api.mjs";
import { cssSection } from "./helpers/app-css.mjs";

test("V369 the library summary counts the latest △/× answers as weak", async t => {
  const db = testD1({ generation: true });
  t.after(() => db.close());
  db.sqlite.exec("INSERT INTO profiles(id) VALUES('author'),('reader');");
  db.sqlite.exec("INSERT INTO collections(id,owner_id,title,share_slug,visibility,published_at) VALUES('book','author','本','book','public','2026-11-01T00:00:00Z');");
  const insert = db.sqlite.prepare("INSERT INTO questions(id,collection_id,created_by,title,sort_order,payload) VALUES(?,?,?,?,?,?)");
  for (const n of [1, 2, 3, 4, 5]) insert.run("q" + n, "book", "author", "問題" + n, n, "{}");
  const attempt = (id, q, grade, at) => db.sqlite.prepare("INSERT INTO answer_attempts(id,client_attempt_id,user_id,question_id,answer,grade,answered_at) VALUES(?,?,?,?,?,?,?)").run(id, id, "reader", q, JSON.stringify("1m"), grade, at);
  attempt("a1", "q1", "×", "2026-11-01T00:00:00Z");
  attempt("a2", "q2", "△", "2026-11-01T00:00:00Z");
  attempt("a3", "q3", "×", "2026-11-01T00:00:00Z");
  attempt("a4", "q3", "◎", "2026-11-02T00:00:00Z"); // fixed later: no longer weak
  attempt("a5", "q4", "〇", "2026-11-01T00:00:00Z");
  const [summary] = await readRpc("get_collection_library_summary", { p_share_slug: "book" }, { db, actor: { id: "reader" } });
  assert.equal(summary.question_count, 5);
  assert.equal(summary.answered_count, 4);
  assert.equal(summary.mastered_count, 2);
  assert.equal(summary.weak_count, 2);
});

test("V369 the shelf review opens the book, then starts the existing 苦手 session", () => {
  const html = fs.readFileSync("public/index.html", "utf8");
  assert.match(html, /onReview: slug => \{\s*if \(slug === String\(sharedCollectionV46\?\.share_slug \|\| ""\)\) startLearningSessionV189\("weak"\);\s*\}/);
  const css = cssSection("library-shelf-v361");
  assert.match(css, /\.library-review-v369 \{[^}]*min-height: 44px;[^}]*font-size: 15px;/);
  assert.match(css, /:root\[data-theme="light"\] \.library-review-v369 \{/);
});
