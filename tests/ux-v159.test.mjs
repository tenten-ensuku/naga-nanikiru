import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexUrl = new URL("../public/index.html", import.meta.url);
const cssUrl = new URL("../public/ux-v159.css", import.meta.url);
const identityUrl = new URL("../app/lib/appIdentity.ts", import.meta.url);

test("V160 exposes the daily-learning shell and synchronized release assets", async () => {
  const [html, css, identity] = await Promise.all([
    readFile(indexUrl, "utf8"),
    readFile(cssUrl, "utf8"),
    readFile(identityUrl, "utf8"),
  ]);

  assert.match(html, /const APP_VERSION = 160;/);
  assert.match(identity, /APP_VERSION = 160/);
  assert.match(html, /ux-v159\.css\?v=160/);
  assert.match(html, /data-menu-view="today"/);
  assert.match(html, /今日の10問/);
  assert.match(html, /function renderTodayViewV159\(/);
  assert.match(html, /data-today-session="\$\{startMode\}"/);
  assert.match(css, /\.today-dashboard/);
  assert.match(css, /\.today-primary-action/);
  assert.doesNotMatch(css, /gradient\s*\(/i);
});

test("V160 keeps account actions compact and removes the obsolete share-copy control", async () => {
  const html = await readFile(indexUrl, "utf8");
  assert.doesNotMatch(html, /id="copyShareUrlButton"/);
  assert.doesNotMatch(html, /copyShareUrlButton/);
  assert.match(html, /data-menu-view="settings"/);
  assert.match(html, /id="discordAuthButton"/);
});

test("V160 keeps generator input and destination in a persistent staged workflow", async () => {
  const html = await readFile(indexUrl, "utf8");
  assert.match(html, /const GENERATOR_DRAFT_KEY_V159 = "naga-nanikiru-generator-draft-v159";/);
  assert.match(html, /sessionStorage\.getItem\(GENERATOR_DRAFT_KEY_V159\)/);
  assert.match(html, /sessionStorage\.setItem\(GENERATOR_DRAFT_KEY_V159, JSON\.stringify\(draft\)\)/);
  assert.match(html, /function persistGeneratorFormDraftV157\(\)/);
  assert.match(html, /generatorForm\?\.addEventListener\("input", persistGeneratorFormDraftV157\)/);
  assert.match(html, /generatorForm\?\.addEventListener\("change", persistGeneratorFormDraftV157\)/);
  assert.match(html, /generator-progress/);
  for (const label of ["URLを入力", "解析", "候補を確認", "追加完了"]) assert.match(html, new RegExp(label));
  assert.match(html, /data-generator-capture-all/);
  assert.match(html, /data-generator-add-selected/);
  const generatorView = html.match(/function renderGeneratorViewV44\(\)[\s\S]*?function generatorCandidateChoiceMarkupV158/)?.[0] || "";
  assert.doesNotMatch(generatorView, /type="file"/);
});

test("V160 displays the canonical perfect mark while accepting legacy history", async () => {
  const html = await readFile(indexUrl, "utf8");
  assert.match(html, /function normalizeScoreMarkV159\(value\)/);
  assert.match(html, /replaceAll\("💮", "◎"\)/);
  assert.match(html, /return normalizeScoreMarkV159\(value\) === "◎"/);
  assert.match(html, /直近2回連続で◎/);
});

test("V160 removes decorative outer rings while preserving result glyph styling", async () => {
  const css = await readFile(cssUrl, "utf8");
  assert.match(css, /V160: keep the result glyphs, but remove the decorative outer rings/);
  assert.match(css, /\.page\.menu-active \.menu-card-latest-mark,\s*\.page\.menu-active \.today-recent-mark \{[\s\S]*?border: 0;[\s\S]*?border-radius: 0;/);
  assert.match(css, /\.page\.menu-active \.menu-card-latest-mark\.is-excellent\s*\{[\s\S]*#ffcf5b/);
  assert.match(css, /\.page\.menu-active \.menu-card-latest-mark\.is-miss\s*\{[\s\S]*var\(--ux-coral\)/);
});
