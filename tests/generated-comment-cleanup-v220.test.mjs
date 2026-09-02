import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexUrl = new URL("../public/index.html", import.meta.url);
const migrationUrl = new URL("../supabase/migrations/20260903090000_remove_generated_question_comments_v220.sql", import.meta.url);

async function cleanupHelpers() {
  const html = await readFile(indexUrl, "utf8");
  const start = html.indexOf("      const GENERATED_QUESTION_COMMENT_CONTENTS_V220");
  const end = html.indexOf("      let userStateV16 = loadUserStateV16();", start);
  assert.ok(start >= 0 && end > start, "V220 comment cleanup helpers should be present");
  return new Function(`${html.slice(start, end)}\nreturn { isLegacyGeneratedQuestionCommentV220, stripLegacyGeneratedQuestionCommentsV220 };`)();
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
  const cleaned = stripLegacyGeneratedQuestionCommentsV220({
    comments: [
      { id: "generated-123", author: "問題生成", content: "NAGA URLから作成した問題です。", attachments: [] },
      userComment
    ]
  });
  assert.deepEqual(cleaned.comments, [userComment]);
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
