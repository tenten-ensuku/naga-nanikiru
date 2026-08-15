import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`https://tenten-ensuku.github.io${pathname}`, {
      headers: { accept: "text/html", host: "tenten-ensuku.github.io" },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the NAGA drill shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>NAGA局面ドリル/);
  assert.match(html, /src="\/naga-nanikiru\/index\.html"/);
  assert.match(html, /title="NAGA局面ドリル｜スクリーンショットベース"/);
});

test("wires v65 learning UX, generator, Supabase bridge, metadata, and social image", async () => {
  const [index, page, layout] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    access(new URL("../public/og-v44.png", import.meta.url)),
  ]);
  assert.match(index, /const APP_VERSION = 91/);
  assert.match(index, /supabase-sync-v48\.js/);
  assert.match(index, /drill-ux-v44\.js/);
  assert.match(index, /naga-generator-v44\.js/);
  assert.match(index, /今日の10問/);
  assert.match(index, /NAGA URLから問題生成/);
  assert.match(index, /property="og:image" content="https:\/\/tenten-ensuku\.github\.io\/naga-nanikiru\/og-v44\.png"/);
  assert.match(page, /src=\{`\$\{APP_BASE_PATH\}index\.html`\}/);
  assert.match(layout, /generateMetadata/);
  assert.match(layout, /og-v44\.png/);
});
