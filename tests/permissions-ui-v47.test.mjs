import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexUrl = new URL("../public/index.html", import.meta.url);

async function source() {
  return readFile(indexUrl, "utf8");
}

test("exposes v65 ownership-aware problem management controls", async () => {
  const html = await source();
  assert.match(html, /const APP_VERSION = 234;/);
  assert.match(html, /id="questionManageEditForm"/);
  assert.match(html, /id="questionManageProposeDeleteButton"[^>]*data-manage-action="propose-delete"/);
  assert.match(html, /id="questionManageDeleteButton"[^>]*data-manage-action="delete"/);
  assert.match(html, /function questionProvenanceV47\(/);
  assert.match(html, /作成：/);
  assert.match(html, /更新：/);
});

test("keeps shared mutations behind explicit scope confirmation and permission branches", async () => {
  const html = await source();
  assert.match(html, /function isSharedQuestionV47\(/);
  assert.match(html, /function canEditQuestionV47\(/);
  assert.match(html, /function canTrashQuestionV47\(/);
  assert.match(html, /function canDeleteQuestionV47\(/);
  assert.match(html, /function canManageQuestionLifecycleV107\(/);
  assert.match(html, /function canAddQuestionV107\(/);
  assert.match(html, /問題集の編集メンバー以上の権限が必要です/);
  assert.match(html, /共有問題集を利用している全員に反映/);
  assert.match(html, /共有問題集の問題を整理できるのは、編集メンバー以上です/);
  assert.match(html, /削除を提案/);
  assert.match(html, /invokeSharedMutationV47\("edit"/);
  assert.match(html, /invokeSharedMutationV47\("trash"/);
  assert.match(html, /invokeSharedMutationV47\("delete"/);
});

test("records local ownership metadata and makes shared generator scope explicit", async () => {
  const html = await source();
  assert.match(html, /createdByName: creatorName/);
  assert.match(html, /updatedByName: creatorName/);
  assert.match(html, /共有問題集へ追加/);
  assert.match(html, /編集権限が必要/);
  assert.match(html, /保存先問題集/);
  assert.match(html, /transferCollectionOwnership/);
  const singleAdd = html.match(/async function addGeneratedQuestionV44\([\s\S]*?\n      function bindGeneratorV44/)?.[0] || "";
  const batchAdd = html.match(/async function addSelectedGeneratorQuestionsV158\([\s\S]*?\n      async function addGeneratedQuestionV44/)?.[0] || "";
  for (const add of [singleAdd, batchAdd]) {
    assert.match(add, /const destination = currentGeneratorDestinationV130\(\)/);
    assert.match(add, /if \(!canAddGeneratedQuestionV130\(\)\)/);
    assert.match(add, /window\.confirm\(`保存先「\$\{destination\.label\}」/);
    assert.match(add, /この問題集の利用者に反映されます。/);
    assert.match(add, /この端末だけに保存されます。/);
    assert.doesNotMatch(add, /confirmSharedImpactV47\("add"/);
  }
  assert.match(singleAdd, /if \(!skipConfirm && !window\.confirm\([^\n]+\)\) return false;/);
  assert.match(batchAdd, /if \(!window\.confirm\([^\n]+\)\) return;/);
  assert.match(html, /共有問題集の保存APIが未接続です/);
});

test("V234 book management rejects viewers and editors without falling back to another owned book", async () => {
  const html = await source();
  const helpers = ["collectionManagementCanManageV197", "collectionManagementTargetV197"].map(name => {
    const body = html.match(new RegExp(`      function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n      \\}`))?.[0];
    assert.ok(body, `${name} should have a bounded function body`);
    return body;
  });
  const target = new Function("supabaseSessionV46", "isQuestionAdminV47", "menuViewV16", "sharedCollectionV46", "ownedCollectionOptionsV197",
    `${helpers.join("\n")}\nreturn collectionManagementTargetV197();`);
  const noFallback = () => { assert.fail("book management must not select an unrelated owned book"); };
  for (const role of ["viewer", "editor"]) {
    const book = { share_slug: "current-book", owner_id: "other-user", member_role: role, can_view: true, can_edit: role === "editor", can_manage: false };
    assert.equal(target({ user: { id: "current-user" } }, () => false, "book-settings", book, noFallback), null, role);
  }
  const owned = { share_slug: "current-book", owner_id: "current-user" };
  assert.equal(target({ user: { id: "current-user" } }, () => false, "book-settings", owned, noFallback), owned);
  const managed = { share_slug: "current-book", owner_id: "other-user", can_manage: true };
  assert.equal(target({ user: { id: "current-user" } }, () => false, "book-settings", managed, noFallback), managed);
  assert.equal(target(null, () => false, "book-settings", null, noFallback), null);
});

test("limits comment editing to the original poster", async () => {
  const html = await source();
  assert.match(html, /function canEditCommentV75\(message\)/);
  assert.match(html, /const authorId = String\(message\?\.authorId \|\| ""\)/);
  assert.match(html, /authorId === currentUserId/);
  assert.match(html, /message\.authorId = session\.user\.id/);
  assert.match(html, /コメントの編集は投稿者本人だけが行えます/);
  assert.match(html, /data-comment-action="edit"/);
});
