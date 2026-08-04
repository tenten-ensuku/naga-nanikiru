import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexUrl = new URL("../public/index.html", import.meta.url);

test("renders the v49 scene and half-game generator controls", async () => {
  const html = await readFile(indexUrl, "utf8");
  assert.match(html, /const APP_VERSION = 49/);
  assert.match(html, /name="generatorMode"/);
  assert.match(html, /value="scene"/);
  assert.match(html, /value="match"/);
  assert.match(html, /id="generatorSeat"/);
  assert.match(html, /player_info\?\.name/);
  assert.match(html, /id="generatorThreshold"[^>]+min="0\.1"[^>]+max="50"/);
  assert.match(html, /id="generatorDecisionType"/);
  assert.match(html, /value="discard"/);
  assert.match(html, /value="call"/);
  assert.match(html, /value="reach"/);
  assert.match(html, /id="generatorModelMode"/);
  assert.match(html, /value="all">全モデルで悪手/);
  assert.match(html, /id="generatorMaxCandidates"[^>]+max="500"/);
  assert.match(html, /局面URLではURLにtsとtvの両方が必要です/);
  assert.match(html, /ts: null, tv: null/);
  assert.match(html, /extractBadMoves\(report, seat, \{ \.\.\.extraction, reportId: spec\.reportId \}\)/);
});
