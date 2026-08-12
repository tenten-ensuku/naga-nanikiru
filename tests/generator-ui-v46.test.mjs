import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexUrl = new URL("../public/index.html", import.meta.url);

test("renders the v56 scene and half-game generator controls", async () => {
  const html = await readFile(indexUrl, "utf8");
  assert.match(html, /const APP_VERSION = 56/);
  assert.match(html, /width: min\(850px, 100%\)/);
  assert.match(html, /aspect-ratio: 14 \/ 13/);
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
  assert.match(html, /captureGeneratorCandidateV51/);
  assert.match(html, /data-generator-capture/);
  assert.match(html, /captureNagaScene/);
  assert.match(html, /問題候補が完成しました/);
  assert.doesNotMatch(html, /id="surroundingsToggle"/);
  assert.doesNotMatch(html, /SCENE_IMAGES/);
  assert.doesNotMatch(html, /images: \{ off: candidate\._imageData, open: candidate\._imageData \}/);
});

test("renders NAGA-like inset probability bars with a dynamic judge highlight", async () => {
  const html = await readFile(indexUrl, "utf8");
  assert.match(html, /--nishiki: #9b78ff/);
  assert.match(html, /--hihikari: #f1c457/);
  assert.match(html, /--kagashi: #4aa8ff/);
  assert.match(html, /--omega: #f39a3f/);
  assert.match(html, /--gamma: #55d59b/);
  assert.match(html, /\.probability-stack \{[^}]*left: 2px;[^}]*width: calc\(100% - 4px\);[^}]*background: transparent/);
  assert.match(html, /\.probability-mini-track \{[^}]*flex: 1 1 0;/);
  assert.match(html, /\.probability-mini-fill \{[^}]*left: 50%;[^}]*width: 3px;[^}]*background: #68735b/);
  assert.match(html, /\.probability-mini-fill\.is-judge-model \{[^}]*width: 7px;/);
  assert.match(html, /\.probability-mini-fill\.is-judge-model \{[^}]*width: 7px;[^}]*background: var\(--nishiki\)/);
  assert.match(html, /data-bar-count="\$\{entries\.length\}"/);
  assert.match(html, /is-judge-model/);
  assert.match(html, /is-reference-model/);
  assert.doesNotMatch(html, /--bar-slot/);
});
