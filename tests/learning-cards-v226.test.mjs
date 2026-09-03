import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlUrl = new URL("../public/index.html", import.meta.url);
const cssUrl = new URL("../public/ux-v159.css", import.meta.url);
const identityUrl = new URL("../app/lib/appIdentity.ts", import.meta.url);
const packageUrl = new URL("../package.json", import.meta.url);

test("V226 keeps settings inside a compact all-question card at every responsive size", async () => {
  const [html, css, identity, packageSource] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(cssUrl, "utf8"),
    readFile(identityUrl, "utf8"),
    readFile(packageUrl, "utf8")
  ]);

  assert.match(html, /const APP_VERSION = 226;/);
  assert.match(identity, /APP_VERSION = 226/);
  for (const asset of ["ux-v159\\.css", "library-v214\\.css", "drill-ux-v44\\.js"]) {
    assert.match(html, new RegExp(`${asset}\\?v=226`));
  }

  const allActionMarkup = html.match(/<div class="learning-all-action">[\s\S]*?<details class="learning-custom-settings"[\s\S]*?<\/details><\/div>/)?.[0] || "";
  assert.match(allActionMarkup, /renderLearningActionButtonV194\(\{ mode: "all"/);
  assert.match(allActionMarkup, /<details class="learning-custom-settings"/);

  const v225 = css.match(/\/\* V225: compact the three learning actions and make the all-question settings part of its card\. \*\/[\s\S]*$/)?.[0] || "";
  assert.ok(v225, "V225 density rules should be last in the cascade");
  assert.match(v225, /\.learning-action-card \{[\s\S]*height: 116px;[\s\S]*min-height: 116px;/);
  assert.match(v225, /\.learning-all-action \{[\s\S]*display: grid;[\s\S]*grid-template-rows: minmax\(0, 1fr\) auto;[\s\S]*height: 116px;/);
  assert.match(v225, /\.learning-all-action > \.learning-action-card \{[\s\S]*background: transparent;[\s\S]*box-shadow: none;/);
  assert.match(v225, /\.learning-all-action > \.learning-custom-settings \{[\s\S]*position: relative;[\s\S]*top: auto;[\s\S]*width: max-content;/);
  assert.match(v225, /@media \(max-width: 800px\)[\s\S]*\.learning-action-card \{[\s\S]*min-height: 66px;[\s\S]*grid-template-areas: "main cta" "description cta";/);
  assert.match(v225, /@media \(max-width: 800px\)[\s\S]*\.learning-all-action \{[\s\S]*min-height: 91px;/);
  assert.doesNotMatch(v225, /\.learning-all-action > \.learning-custom-settings \{[^}]*position: absolute;/);
  assert.match(v225, /@media \(max-width: 800px\)[\s\S]*\.learning-custom-settings\[open\] \.learning-custom-settings-body \{[\s\S]*position: static;[\s\S]*width: 100%;[\s\S]*max-height: none;/);

  const scripts = JSON.parse(packageSource).scripts;
  assert.match(scripts["test:drill"], /tests\/learning-cards-v226\.test\.mjs/);
  assert.doesNotMatch(scripts["test:drill"], /learning-settings-(?:responsive-v223|position-v224)/);
});
