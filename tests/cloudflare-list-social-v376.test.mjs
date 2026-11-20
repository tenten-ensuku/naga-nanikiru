import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { testD1 } from "./helpers/cloudflare-d1.mjs";
import { readRpc } from "../cloudflare/read-api.mjs";
import { cssSection } from "./helpers/app-css.mjs";

const html = fs.readFileSync("public/index.html", "utf8");

test("V376 the question list reports visible comments and per-key reaction counts", async t => {
  const db = testD1({ generation: true });
  t.after(() => db.close());
  db.sqlite.exec("INSERT INTO profiles(id) VALUES('author'),('a'),('b'),('c');");
  db.sqlite.exec("INSERT INTO collections(id,owner_id,title,share_slug,visibility,published_at) VALUES('book','author','本','book','public','2026-11-01T00:00:00Z');");
  const payload = JSON.stringify({ comments: [
    { id: "old-1", content: "旧コメント" },
    { id: "old-2", content: "非表示", showInComments: false },
    { id: "old-3", content: "", attachments: [] },
  ] });
  const insert = db.sqlite.prepare("INSERT INTO questions(id,collection_id,created_by,title,sort_order,payload) VALUES(?,?,?,?,?,?)");
  insert.run("q1", "book", "author", "問題1", 1, payload);
  insert.run("q2", "book", "author", "問題2", 2, "{}");
  const comment = db.sqlite.prepare("INSERT INTO comments(id,collection_id,question_id,user_id,body,deleted_at) VALUES(?,?,?,?,?,?)");
  comment.run("c1", "book", "q1", "a", "見える", null);
  comment.run("c2", "book", "q1", "b", "消した", "2026-11-02T00:00:00Z");
  const qr = db.sqlite.prepare("INSERT INTO question_reactions(question_id,user_id,reaction_key) VALUES(?,?,?)");
  qr.run("q1", "a", "like"); qr.run("q1", "b", "like"); qr.run("q1", "c", "hmm");
  const cr = db.sqlite.prepare("INSERT INTO comment_reactions(question_id,comment_id,user_id,reaction_key) VALUES(?,?,?,?)");
  cr.run("q1", "c1", "b", "like");        // counts: visible native comment
  cr.run("q1", "old-1", "c", "important"); // counts: visible legacy comment
  cr.run("q1", "c2", "c", "like");        // ignored: deleted comment

  const rows = await readRpc("get_shared_question_index_page", { p_share_slug: "book", p_limit: 10 }, { db, actor: { id: "a" } });
  const [q1, q2] = rows;
  assert.equal(q1.comment_count, 2, "one native + one visible legacy comment");
  assert.deepEqual(q1.reaction_counts, [["like", 3], ["hmm", 1], ["important", 1]]);
  assert.equal(q2.comment_count, 0);
  assert.deepEqual(q2.reaction_counts, []);
});

function socialMarkup(question, definitions = {}) {
  const start = html.indexOf("function questionSocialMarkupV376(");
  let depth = 0, i = html.indexOf("{", start);
  for (; i < html.length; i++) { if (html[i] === "{") depth++; else if (html[i] === "}" && --depth === 0) break; }
  const context = {
    escapeHtml: value => String(value).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
    reactionDefinitionByKeyV211: key => definitions[key] || null,
    reactionAccessibleLabelV211: definition => definition.label,
    reactionIconMarkupV213: (definition, className) => `<span class="${className}">${definition.icon}</span>`,
  };
  vm.runInNewContext(html.slice(start, i + 1) + "; this.render = questionSocialMarkupV376;", context);
  return context.render(question);
}

test("V376 the 反応 cell shows the comment count, the top three reactions and the total", () => {
  const defs = { like: { label: "いいね！", icon: "👍" }, hmm: { label: "うーん", icon: "🤔" }, important: { label: "重要だね！", icon: "💡" }, agree: { label: "そーだね！", icon: "✅" } };
  const out = socialMarkup({ commentCountV376: 3, reactionCountsV376: [["hmm", 1], ["like", 4], ["agree", 1], ["important", 2]] }, defs);
  assert.match(out, /aria-label="コメント3件・リアクション8件（いいね！ 4、重要だね！ 2、うーん 1、そーだね！ 1）"/);
  assert.equal((out.match(/social-reaction-icon-v376/g) || []).length, 3, "only the top three icons");
  assert.ok(out.indexOf("👍") < out.indexOf("💡"), "sorted by count");
  assert.match(out, /<b>8<\/b>/);
  const empty = socialMarkup({ commentCountV376: 0, reactionCountsV376: [] }, defs);
  assert.match(empty, /menu-card-social-v376 is-empty-v376/);
  assert.match(empty, /social-comments-v376 is-zero/);
  assert.doesNotMatch(empty, /social-reactions-v376/);
});

test("V376 list wiring: header cell, row column, live sync and layout", () => {
  assert.match(html, /<span title="コメント数と、多いリアクション上位3つ・合計" data-social-head-v376 hidden>反応<\/span>/);
  assert.match(html, /const socialV376 = menuViewV16 === "my" \? questionSocialMarkupV376\(question\) : "";/);
  assert.match(html, /<\/button>\$\{socialV376\}<span class="menu-card-latest/);
  assert.match(html, /commentCountV376: Number\.isSafeInteger\(row\?\.comment_count\)/);
  assert.match(html, /window\.syncQuestionCommentCountV376\?\.\(state\.reactionQuestionId, messages\.length\);/);
  assert.match(html, /question\.reactionCountsV376=reactionCounts;/);
  const css = cssSection("list-social-v376");
  assert.match(css, /:is\(\.menu-list-header, \.menu-card\)\.has-social-v376 \{ grid-template-columns: minmax\(0, 1fr\) 128px 180px 92px; \}/);
  assert.match(css, /\.menu-card-social-v376 \{ grid-column: 2; grid-row: 1; \}/);
  assert.match(css, /@media \(max-width: 800px\) \{[\s\S]*?\.menu-card-social-v376 \{ grid-column: 1; grid-row: 2; flex-direction: row;/);
  assert.match(css, /\.menu-card-social-v376\.is-empty-v376 \{ display: none; \}/);
});
