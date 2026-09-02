import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const identity = await readFile(new URL("../app/lib/appIdentity.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20260903090000_comment_avatar_backfill_v222.sql", import.meta.url), "utf8");

test("V222のDiscordリンクは有効な転送元だけを表示する", () => {
  assert.match(identity, /APP_VERSION = 222/);
  assert.match(html, /const APP_VERSION = 222/);
  assert.match(html, /function normalizeDiscordThreadUrlV222\(value\)/);
  assert.match(html, /if \(!raw \|\| raw === "#"\) return ""/);
  assert.match(html, /link\.hidden = !href/);
  assert.match(html, /syncThreadLinkV222\(SCENE\)/);
  assert.match(html, /threadUrl: normalizeDiscordThreadUrlV222\(candidate\.threadUrl\)/);
  assert.doesNotMatch(html, /id="threadLink" href="https:\/\/discord\.com/);
});

test("共有コメントはDiscordプロフィールのアイコンを受け取り、埋め込みコメントも補完する", () => {
  assert.match(html, /message\?\.author\?\.avatar_url/);
  assert.match(html, /message\?\.user\?\.avatar_url/);
  assert.match(html, /avatarUrl: commentAvatarUrlV198\(comment\)/);
  assert.match(migration, /jsonb_build_object\('avatarUrl', matched\.avatar_url\)/);
  assert.match(migration, /'垣崎にま'/);
  assert.match(migration, /'marlboro0908'/);
});
