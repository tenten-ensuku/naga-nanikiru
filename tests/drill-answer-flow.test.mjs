import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../public/index.html", import.meta.url);

async function source() {
  return readFile(sourceUrl, "utf8");
}

function functionBody(html, name, nextName) {
  const pattern = new RegExp(`function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n      function ${nextName}\\(`);
  const match = pattern.exec(html);
  assert.ok(match, `${name} should be present before ${nextName}`);
  return match[1];
}

test("requires explicit confirmation before revealing or recording an answer", async () => {
  const html = await source();
  assert.match(html, /id="confirmAnswerButton"[^>]*>この回答で確定<\/button>/);

  const callBody = functionBody(html, "selectCallV16", "selectTileV16");
  assert.doesNotMatch(callBody, /state\.revealed\s*=\s*true/);
  assert.doesNotMatch(callBody, /recordAnswerV16\(\)/);

  const tileBody = functionBody(html, "selectTileV16", "toggleRiichiV16");
  assert.doesNotMatch(tileBody, /state\.revealed\s*=\s*true/);
  assert.doesNotMatch(tileBody, /recordAnswerV16\(\)/);

  const confirmBody = functionBody(html, "confirmAnswerV41", "resetV16");
  assert.match(confirmBody, /state\.revealed\s*=\s*true/);
  assert.match(confirmBody, /recordAnswerV16\(\)/);
});

test("records answer timing and exposes the synchronized drill version", async () => {
  const html = await source();
  assert.match(html, /const APP_VERSION = 41;/);
  assert.match(html, /responseTimeMs:\s*Math\.max\(0, confirmedAt - startedAt\)/);
  assert.match(html, /startedAt:\s*new Date\(startedAt\)\.toISOString\(\)/);
  assert.match(html, /const historicalCard = SCENE\.actualDiscard \?/);
});
