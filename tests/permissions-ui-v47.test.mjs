import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexUrl = new URL("../public/index.html", import.meta.url);

async function source() {
  return readFile(indexUrl, "utf8");
}

test("exposes v65 ownership-aware problem management controls", async () => {
  const html = await source();
  assert.match(html, /const APP_VERSION = 71;/);
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
  assert.match(html, /共有問題集を利用している全員に反映/);
  assert.match(html, /他の利用者が作成した共有問題は直接ゴミ箱へ移動できません/);
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
  assert.match(html, /confirmSharedImpactV47\("add"/);
  assert.match(html, /共有問題集の保存APIが未接続です/);
});
