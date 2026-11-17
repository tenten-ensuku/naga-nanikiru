import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { appCss, cssSectionOrder } from "./helpers/app-css.mjs";

const html = fs.readFileSync("public/index.html", "utf8");
const css = appCss();

test("V372 all app styles live in app.css; index.html keeps only the startup shell CSS", () => {
  const styles = html.match(/<style[^>]*>/g) || [];
  assert.deepEqual(styles.filter(tag => tag !== "<style>" || false), ['<style id="startupCriticalV236">']);
  assert.equal((html.match(/<style>/g) || []).length, 1, "only the <noscript> one-liner remains");
  assert.match(html, /<noscript><style>#startupStatusV236\{display:none\}<\/style>/);
  assert.equal((html.match(/rel="stylesheet"/g) || []).length, 1);
  assert.ok(html.indexOf('<style id="startupCriticalV236">') < html.indexOf('<link rel="stylesheet" href="app.css'));
});

test("V372 app.css opens with a contents list and every section is labelled", () => {
  const order = cssSectionOrder();
  assert.equal(order[0], "index-inline");
  assert.ok(css.startsWith("/* みん切る app styles"));
  for (const name of order) {
    assert.match(css, new RegExp(`/\\* ===== ${name} ｜ [^=]+ ===== \\*/`), name);
    assert.match(css.slice(0, css.indexOf("*/")), new RegExp(`（${name}）`), `contents lists ${name}`);
  }
});

test("V372 removed rules for markup the app no longer renders", () => {
  for (const gone of [".riichi-bar-value", ".vertical-bar-model", ".today-primary-action", ".source-url", ".library-rail-actions", ".quick-start-card"]) {
    assert.ok(!css.includes(gone + " ") && !css.includes(gone + "{") && !css.includes(gone + ","), gone);
  }
});
