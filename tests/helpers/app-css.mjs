// V371: every stylesheet now lives in public/app.css, in the original cascade order.
// Each former file is a section headed "/* ===== <name> ｜ <label> ===== */"; tests read their section.
// V372: the CSS that used to sit inline in index.html is the first section, "index-inline".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE = new URL("../../public/app.css", import.meta.url);

export function cssSection(name) {
  const css = fs.readFileSync(SOURCE, "utf8");
  const marker = `/* ===== ${name} `;
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`app.css has no section ${name}`);
  const body = css.indexOf("*/", start) + 2;
  const next = css.indexOf("\n/* ===== ", body);
  return css.slice(body, next < 0 ? undefined : next);
}

// For tests that read a URL later: write the section to a temporary file.
export function cssSectionUrl(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "minkiru-css-"));
  const file = path.join(dir, `${name}.css`);
  fs.writeFileSync(file, cssSection(name));
  return pathToFileURL(file);
}

export function cssSectionOrder() {
  return [...fs.readFileSync(SOURCE, "utf8").matchAll(/\/\* ===== ([\w-]+) /g)].map(m => m[1]);
}

// The whole stylesheet, for checks that do not depend on which section a rule sits in.
export function appCss() {
  return fs.readFileSync(SOURCE, "utf8");
}
