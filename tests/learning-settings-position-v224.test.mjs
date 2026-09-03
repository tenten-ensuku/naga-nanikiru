import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cssUrl = new URL("../public/ux-v159.css", import.meta.url);
const htmlUrl = new URL("../public/index.html", import.meta.url);

test("V224 removes the inherited desktop top offset from the mobile settings row", async () => {
  const [css, html] = await Promise.all([
    readFile(cssUrl, "utf8"),
    readFile(htmlUrl, "utf8")
  ]);

  const v223Index = css.indexOf("/* V223: keep the all-question settings inside the card on vertical layouts. */");
  const v224Index = css.indexOf("/* V224: clear the desktop top offset before pinning the settings row to the bottom. */");
  assert.ok(v223Index >= 0, "the original mobile card rules should remain documented");
  assert.ok(v224Index > v223Index, "the correction should win the cascade");
  const correction = css.slice(v224Index);
  assert.match(correction, /@media \(max-width: 800px\)/);
  assert.match(correction, /\.learning-all-action > \.learning-custom-settings \{[\s\S]*top: auto;/);
  assert.match(html, /const APP_VERSION = 224;/);
});
