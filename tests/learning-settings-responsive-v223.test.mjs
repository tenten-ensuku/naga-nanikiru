import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlUrl = new URL("../public/index.html", import.meta.url);
const cssUrl = new URL("../public/ux-v159.css", import.meta.url);
const identityUrl = new URL("../app/lib/appIdentity.ts", import.meta.url);
const packageUrl = new URL("../package.json", import.meta.url);

test("V223 keeps the all-question settings inside the card on vertical layouts", async () => {
  const [html, css, identity, packageSource] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(cssUrl, "utf8"),
    readFile(identityUrl, "utf8"),
    readFile(packageUrl, "utf8")
  ]);

  assert.match(html, /const APP_VERSION = 223;/);
  assert.match(identity, /APP_VERSION = 223/);
  for (const asset of ["ux-v159\\.css", "library-v214\\.css", "drill-ux-v44\\.js"]) {
    assert.match(html, new RegExp(`${asset}\\?v=223`));
  }

  const responsivePatch = css.match(/\/\* V223: keep the all-question settings inside the card on vertical layouts\. \*\/[\s\S]*$/)?.[0] || "";
  assert.ok(responsivePatch, "V223 responsive rules should be present at the end of the cascade");
  assert.match(responsivePatch, /@media \(max-width: 800px\)/);
  assert.match(responsivePatch, /\.learning-all-action \{[\s\S]*position: relative;[\s\S]*min-height: 118px;/);
  assert.match(responsivePatch, /\.learning-all-action > \.learning-action-card \{[\s\S]*padding-bottom: 51px;[\s\S]*grid-template-areas: "main cta" "description cta";/);
  assert.match(responsivePatch, /\.learning-all-action > \.learning-custom-settings \{[\s\S]*position: absolute;[\s\S]*right: 10px;[\s\S]*bottom: 8px;[\s\S]*left: 10px;/);
  assert.match(responsivePatch, /\.learning-all-action > \.learning-custom-settings\[open\] \.learning-custom-settings-body \{[\s\S]*position: absolute;[\s\S]*max-height: min\(64vh, 480px\);/);
  assert.match(html, /class="learning-all-action"/);

  const scripts = JSON.parse(packageSource).scripts;
  assert.match(scripts["test:drill"], /tests\/learning-settings-responsive-v223\.test\.mjs/);
});
