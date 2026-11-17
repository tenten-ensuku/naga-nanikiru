import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { testD1 } from "./helpers/cloudflare-d1.mjs";
import { readRpc } from "../cloudflare/read-api.mjs";
import { appCss } from "./helpers/app-css.mjs";

const html = fs.readFileSync("public/index.html", "utf8");

function checker() {
  const start = html.indexOf("function othersPrivateBookV367(");
  const end = html.indexOf("window.MinkiruPrivateBookV367", start);
  assert.ok(start > 0 && end > start, "private-book check exists");
  const sandbox = { sharedCollectionV46: null, supabaseSessionV46: null };
  vm.runInNewContext(`${html.slice(start, end)}; this.check = othersPrivateBookV367;`, sandbox);
  return sandbox.check;
}

test("V367 warns only for someone else's private book that the viewer is not a member of", () => {
  const check = checker();
  const book = { owner_id: "author", visibility: "private", is_owner: false, member_role: null, member_status: null };
  assert.equal(check(book, "admin"), true);
  assert.equal(check({ ...book, owner_id: "admin", is_owner: true }, "admin"), false, "own book");
  assert.equal(check({ ...book, visibility: "public" }, "admin"), false, "public book");
  assert.equal(check({ ...book, visibility: "request" }, "admin"), false, "request book");
  assert.equal(check({ ...book, member_status: "active", member_role: "member" }, "admin"), false, "invited member");
  assert.equal(check({ ...book, member_role: "manager" }, "admin"), false, "manager");
  assert.equal(check(book, null), false, "signed out");
  assert.equal(check(null, "admin"), false, "no book");
  // A volume follows its series' setting.
  assert.equal(check({ ...book, visibility: "public", parent_visibility: "private" }, "admin"), true);
  assert.equal(check({ ...book, visibility: "private", parent_visibility: "public" }, "admin"), false);
});

test("V367 the comment panel and composer carry the note, and the welcome text hides with it", () => {
  const notes = html.match(/<p class="private-book-note-v367[^"]*" data-private-book-note role="note" hidden>[^<]+<\/p>/g) || [];
  assert.equal(notes.length, 2);
  assert.match(notes[0], /作成者が非公開にしている本です。コメントする前に確認してください。/);
  assert.match(notes[1], /非公開の本にコメントしようとしています/);
  assert.ok(html.indexOf(notes[1]) > html.indexOf('<form class="comment-form" id="commentForm"'));
  assert.ok(html.indexOf(notes[1]) < html.indexOf('<div class="comment-compose-actions-v316">'));
  const render = html.slice(html.indexOf("function renderComments("), html.indexOf("function openCommentImage("));
  assert.match(render, /window\.MinkiruPrivateBookV367\?\.active\(\) === true/);
  assert.match(render, /note\.hidden = !privateBookV367/);
  assert.match(render, /welcomeV367\.hidden = privateBookV367/);
  assert.match(appCss(), /\.private-book-note-v367:not\(\[hidden\]\) \{ display: flex;/);
});

test("V367 get_shared_collection reports the series visibility for a volume", async t => {
  const db = testD1({ generation: true });
  t.after(() => db.close());
  db.sqlite.exec("INSERT INTO profiles(id) VALUES('author'),('reader');");
  db.sqlite.exec(`INSERT INTO collections(id,owner_id,title,share_slug,visibility,series_key)
    VALUES('series','author','シリーズ','series','private','series');`);
  db.sqlite.exec(`INSERT INTO collections(id,owner_id,title,share_slug,visibility,series_key,series_parent_id,volume_number)
    VALUES('vol1','author','シリーズ 第1巻','vol1','public','series','series',1);`);
  const ctx = { db, actor: { id: "reader" } };
  const volume = await readRpc("get_shared_collection", { p_share_slug: "vol1" }, ctx);
  assert.equal(volume.visibility, "public");
  assert.equal(volume.parent_visibility, "private");
  const parent = await readRpc("get_shared_collection", { p_share_slug: "series" }, ctx);
  assert.equal(parent.parent_visibility, null);
});
