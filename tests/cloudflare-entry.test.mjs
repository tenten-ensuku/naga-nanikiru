import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { parseCloudflareEntryArgs, prepareCloudflareEntry } from "../scripts/prepare-cloudflare-entry.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entryPath = path.join(repoRoot, "cloudflare", "github-entry.html");
test("GitHub entry is static, responsive, and contains no authenticated request hook", async () => {
  const html = await fs.readFile(entryPath, "utf8");
  assert.match(html, /https:\/\/minkiru\.naga-study\.workers\.dev/);
  assert.match(html, /\/naga-nanikiru\/assets\/min-kiru-header\.png/);
  assert.match(html, /\/naga-nanikiru\/icons\/favicon-32\.png/);
  assert.doesNotMatch(html, /supabase/i);
  assert.doesNotMatch(html, /fetch\s*\(/i);
  assert.doesNotMatch(html, /XMLHttpRequest|Authorization|access_token|refresh_token/i);
  assert.doesNotMatch(html, /<script[^>]+legacy-transfer|id="legacyExportButton"|旧サイトの設定を引き継ぐ/);
});

test("GitHub entry keeps only approved URL parameters and drops hash", async () => {
  const html = await fs.readFile(entryPath, "utf8");
  const inline = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/i)?.[1];
  assert.ok(inline);
  const link = { href: "" };
  const window = { location: { href: "https://tenten-ensuku.github.io/naga-nanikiru/?collection=abc%2F1&existing_question=q-1&token=secret#access_token=secret" } };
  const document = { getElementById(id) { return id === "canonicalLink" ? link : { textContent: "" }; } };
  vm.runInNewContext(inline, { window, document, URL, URLSearchParams });
  assert.equal(link.href, "https://minkiru.naga-study.workers.dev/?collection=abc%2F1&existing_question=q-1");
  assert.doesNotMatch(link.href, /token|access_token|#/i);
});

test("entry preparation requires an explicit CI or staging output", async () => {
  assert.throws(() => parseCloudflareEntryArgs([]), /output-dir/i);
  assert.throws(() => parseCloudflareEntryArgs(["--output-dir", "public"]), /mode/i);
  assert.throws(() => parseCloudflareEntryArgs(["--output-dir", "public", "--mode", "local"]), /ci|staging/i);
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "naga-entry-"));
  const outputFile = path.join(outputDir, "index.html");
  await fs.writeFile(outputFile, "old output", "utf8");
  const result = await prepareCloudflareEntry({ outputDir, mode: "staging", sourceFile: entryPath });
  assert.equal(result.outputFile, outputFile);
  assert.equal(await fs.readFile(outputFile, "utf8"), await fs.readFile(entryPath, "utf8"));
});
