import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexUrl = new URL("../public/index.html", import.meta.url);
const migrationUrl = new URL("../supabase/migrations/20260903090000_remove_generated_question_comments_v220.sql", import.meta.url);

async function cleanupHelpers() {
  const html = await readFile(indexUrl, "utf8");
  const constant = html.match(/const GENERATED_QUESTION_COMMENT_CONTENTS_V220 = new Set\(\[[\s\S]*?\]\);/)?.[0];
  assert.ok(constant, "V220 comment allowlist should be present");
  const helpers = ["isLegacyGeneratedQuestionCommentV220", "stripLegacyGeneratedQuestionCommentsV220"].map(name => {
    const body = html.match(new RegExp(`      function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n      \\}`))?.[0];
    assert.ok(body, `${name} should have a bounded function body`);
    return body;
  });
  // Do not evaluate unrelated navigation initialization between the allowlist and helpers.
  return new Function(`${constant}\n${helpers.join("\n")}\nreturn { isLegacyGeneratedQuestionCommentV220, stripLegacyGeneratedQuestionCommentsV220 };`)();
}

test("V220 strips only legacy automatic generator comments from local question state", async () => {
  const { isLegacyGeneratedQuestionCommentV220, stripLegacyGeneratedQuestionCommentsV220 } = await cleanupHelpers();
  assert.equal(isLegacyGeneratedQuestionCommentV220({
    id: "generated-123",
    author: "問題生成",
    content: "NAGA URLから作成した問題です。",
    attachments: []
  }), true);
  assert.equal(isLegacyGeneratedQuestionCommentV220({
    id: "comment-123",
    author: "問題生成",
    content: "NAGA URLから作成した問題です。",
    attachments: []
  }), false);
  assert.equal(isLegacyGeneratedQuestionCommentV220({
    id: "generated-456",
    author: "利用者",
    content: "NAGA URLから作成した問題です。",
    attachments: []
  }), false);

  const userComment = { id: "comment-789", author: "利用者", content: "残すコメント", attachments: [] };
  const original = {
    comments: [
      { id: "generated-123", author: "問題生成", content: "NAGA URLから作成した問題です。", attachments: [] },
      userComment
    ]
  };
  const before = structuredClone(original);
  const cleaned = stripLegacyGeneratedQuestionCommentsV220(original);
  assert.deepEqual(cleaned.comments, [userComment]);
  assert.deepEqual(original, before, "cleanup must not mutate the original question or user comments");
  const withAttachment = { id: "generated-456", author: "問題生成", content: "NAGA URLから作成した問題です。", attachments: [{ id: "keep" }] };
  assert.equal(isLegacyGeneratedQuestionCommentV220(withAttachment), false);
  assert.deepEqual(stripLegacyGeneratedQuestionCommentsV220({ comments: [withAttachment] }).comments, [withAttachment]);
});

test("V220 records the same narrow cleanup predicate for the live Supabase data", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /cm\.value->>'id' like 'generated-%'/);
  assert.match(sql, /cm\.value->>'author' = '問題生成'/);
  assert.match(sql, /NAGA URLから作成した問題です。/);
  assert.match(sql, /NAGA URLから追加した問題です。/);
  assert.match(sql, /coalesce\(cm\.value->'attachments', '\[\]'::jsonb\) = '\[\]'::jsonb/);
  assert.match(sql, /jsonb_agg\(value order by ordinality\)/);
});
