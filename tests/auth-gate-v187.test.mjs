import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexUrl = new URL("../public/index.html", import.meta.url);

test("V187 removes local-history import and requires login before study", async () => {
  const html = await readFile(indexUrl, "utf8");

  assert.match(html, /const APP_VERSION = 207/);
  assert.match(html, /<body class="auth-gate-open">/);
  assert.match(html, /<main class="page" inert aria-hidden="true">/);
  assert.match(html, /class="auth-gate" id="authGate"/);
  assert.match(html, /id="authGateLoginButton"/);
  assert.doesNotMatch(html, /importHistoryButton/);
  assert.match(html, /function requireLoginForPlayV187\(\)/);
  assert.match(html, /function syncAuthGateForSessionV187\(session = null\)/);
  assert.match(html, /page\.toggleAttribute\("inert", !authenticated\)/);
  assert.match(html, /if \(!gate\.contains\(document\.activeElement\) \|\| event\.key === "Tab"\)/);
  assert.match(html, /authButton\.addEventListener\("click", handleDiscordAuthV187\)/);
  assert.match(html, /authGateLoginButton"\)\?\.addEventListener\("click", handleDiscordAuthV187\)/);

  for (const functionName of [
    "recordAnswerV16",
    "selectCallV16",
    "selectTileV16",
    "toggleRiichiV16",
    "confirmAnswerV41",
    "startSessionV44",
    "startRangeSessionV61",
    "advanceQuestionV44",
    "openQuestionV16"
  ]) {
    const functionBody = html.match(new RegExp(`function ${functionName}\\([\\s\\S]*?\\n      function `))?.[0]
      || html.match(new RegExp(`async function ${functionName}\\([\\s\\S]*?\\n      function `))?.[0]
      || "";
    assert.match(functionBody, /requireLoginForPlayV187\(\)/, `${functionName} must require login`);
  }

  assert.match(html, /pendingExistingQuestionIdV187 = requestedExistingQuestionId/);
  assert.match(html, /await openRequestedQuestionAfterAuthV187\(\)/);
  assert.match(html, /cleanUrl\.searchParams\.delete\("existing_question"\)/);
  assert.match(html, /supabase-sync-v48\.js\?v=207/);
  assert.match(html, /drill-ux-v44\.js\?v=207/);
});
