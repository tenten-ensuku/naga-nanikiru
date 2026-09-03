import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(testDir, "..");
const read = relativePath => fs.readFileSync(path.join(repoDir, relativePath), "utf8");
const html = read("public/index.html");
const css = read("public/ux-v159.css");

const addedReactions = [
  ["アリ！", "⭕"],
  ["好みで", "🎨"],
  ["ふむふむ", "🤓"],
  ["なるほど！", "🙌"],
  ["基礎講義", "📚"],
  ["オリ", "🛡️"],
  ["押し", "💪"],
  ["お好み焼き", "🥞"]
];

test("V221 adds the requested curated reactions in the requested order", () => {
  assert.match(html, /const APP_VERSION = 225;/);
  let previousIndex = html.indexOf('id: "question"');
  assert.ok(previousIndex >= 0);
  for (const [label, icon] of addedReactions) {
    const labelIndex = html.indexOf(`label: "${label}"`);
    assert.ok(labelIndex > previousIndex, `定番リアクションの順番が不正: ${label}`);
    assert.match(html, new RegExp(`label: "${label}", icon: "${icon}"`));
    previousIndex = labelIndex;
  }
});

test("V221 adds personal favorites and recent-history tabs without nested buttons", () => {
  assert.match(html, /data-reaction-tab="favorites"/);
  assert.match(html, /data-reaction-tab="history"/);
  assert.match(html, /data-reaction-tab="standard"[\s\S]*data-reaction-tab="tiles"[\s\S]*data-reaction-tab="custom"/);
  assert.match(html, /reactionPickerFavoritesPanelV221/);
  assert.match(html, /reactionPickerHistoryPanelV221/);
  assert.match(html, /reactionPickerFavoritesCountV221/);
  assert.match(html, /data-reaction-favorite-toggle/);
  assert.match(html, /function toggleReactionFavoriteV221\(/);
  assert.match(html, /function rememberReactionHistoryV221\(/);
  assert.match(html, /if \(active\) rememberReactionHistoryV221\(definition\.id\)/);
  assert.match(html, /reaction-picker-select-v221/);
  assert.match(html, /reactionPreferencesV221/);
  assert.match(html, /localStorage\.getItem\(`\$\{REACTION_PREFERENCES_STORAGE_KEY_V221\}:\$\{scope\}`/);
});

test("V221 keeps the picker compact at desktop and mobile widths", () => {
  assert.match(css, /\.reaction-picker-tabs-v221\s*\{[\s\S]*grid-template-columns: repeat\(5/);
  assert.match(css, /\.reaction-picker-option-v221\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.reaction-picker-favorite-v221/);
  assert.match(css, /@media \(max-width: 800px\)[\s\S]*\.reaction-picker-options-v221\s*\{[\s\S]*grid-template-columns: repeat\(2/);
  assert.match(css, /\.reaction-picker-option-v221\.is-tile/);
});
