// V371: every stylesheet now lives in public/app.css, in the original cascade order.
// Each former file is a section headed "/* ===== <name> ===== */"; tests read their section.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE = new URL("../../public/app.css", import.meta.url);

export function cssSection(name) {
  const css = fs.readFileSync(SOURCE, "utf8");
  const marker = `/* ===== ${name} ===== */`;
  const start = css.indexOf(marker);
  if (start < 0) throw new Error(`app.css has no section ${name}`);
  const next = css.indexOf("\n/* ===== ", start + marker.length);
  return css.slice(start + marker.length, next < 0 ? undefined : next);
}

// For tests that read a URL later: write the section to a temporary file.
export function cssSectionUrl(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "minkiru-css-"));
  const file = path.join(dir, `${name}.css`);
  fs.writeFileSync(file, cssSection(name));
  return pathToFileURL(file);
}

export function cssSectionOrder() {
  return [...fs.readFileSync(SOURCE, "utf8").matchAll(/\/\* ===== ([\w-]+) ===== \*\//g)].map(m => m[1]);
}
