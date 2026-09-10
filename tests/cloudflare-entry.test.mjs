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
const transferPath = path.join(repoRoot, "public", "legacy-transfer-v232.js");
const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";

function loadTransferApi() {
  return fs.readFile(transferPath, "utf8").then(source => {
    const window = {};
    vm.runInNewContext(source, { window, console });
    return window.NagaLegacyTransferV232;
  });
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    dump(key) { return values.get(key); },
    keys() { return [...values.keys()]; }
  };
}

test("GitHub entry is static, responsive, and contains no authenticated request hook", async () => {
  const html = await fs.readFile(entryPath, "utf8");
  assert.match(html, /https:\/\/minkiru\.naga-study\.workers\.dev/);
  assert.match(html, /\/naga-nanikiru\/assets\/min-kiru-header\.png/);
  assert.match(html, /\/naga-nanikiru\/icons\/favicon-32\.png/);
  assert.doesNotMatch(html, /supabase/i);
  assert.doesNotMatch(html, /fetch\s*\(/i);
  assert.doesNotMatch(html, /XMLHttpRequest|Authorization|access_token|refresh_token/i);
  assert.match(html, /<script defer src="\/naga-nanikiru\/legacy-transfer-v232\.js/);
  assert.match(html, /id="legacyExportButton"/);
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

test("export payload contains only current UUID scopes and library order, never tokens or excluded state", async () => {
  const api = await loadTransferApi();
  const payload = api.buildExportPayload({
    userId,
    state: {
      favorites: ["legacy-unscoped"],
      archived: ["legacy-unscoped"],
      answerHistory: [{ token: "secret" }],
      localComments: { q1: "private" },
      collectionPersonal: {
        [`${userId}::collection-a`]: { favorites: ["q1", "q1"], archived: ["q2"], initialized: true },
        [`${otherUserId}::collection-b`]: { favorites: ["other"], archived: [] },
        "guest::collection-c": { favorites: ["guest"], archived: [] }
      }
    },
    libraryOrder: ["collection-a", "collection-a", "collection-b"]
  });
  assert.deepEqual(JSON.parse(JSON.stringify(payload.collectionPersonal)), { [`${userId}::collection-a`]: { favorites: ["q1"], archived: ["q2"] } });
  assert.deepEqual(JSON.parse(JSON.stringify(payload.libraryOrder)), ["collection-a", "collection-b"]);
  assert.equal("answerHistory" in payload, false);
  assert.equal("localComments" in payload, false);
  assert.doesNotMatch(JSON.stringify(payload), /secret|private|legacy-unscoped|other|guest/i);
});

test("import rejects another UUID and unscoped markers", async () => {
  const api = await loadTransferApi();
  const base = { format: "naga-nanikiru-legacy-transfer", version: 232, userId, collectionPersonal: {}, libraryOrder: [] };
  assert.throws(() => api.validateImportPayload({ ...base, userId: otherUserId }, userId), /別のユーザー/);
  assert.throws(() => api.validateImportPayload({ ...base, favorites: ["legacy"] }, userId), /未スコープ/);
  assert.throws(() => api.validateImportPayload({ ...base, collectionPersonal: { "guest::collection": { favorites: [], archived: [] } } }, userId), /未スコープ/);
  assert.throws(() => api.validateImportPayload({ ...base, collectionPersonal: { [`${otherUserId}::collection`]: { favorites: [], archived: [] } } }, userId), /別のユーザー/);
});

test("import unions markers and preserves existing local order and unrelated state", async () => {
  const api = await loadTransferApi();
  const storage = memoryStorage({
    "naga-nanikiru:user-state-v1": JSON.stringify({
      answerHistory: [{ id: "legacy-global" }],
      localComments: { q: "legacy-global" },
      collectionPersonal: {
        [`${userId}::collection-a`]: { favorites: ["legacy-global"], archived: [], initialized: true },
        [`${otherUserId}::collection-b`]: { favorites: ["other"], archived: [] }
      }
    }),
    [`naga-nanikiru:user-state-v1:cloudflare:${userId}`]: JSON.stringify({
      answerHistory: [{ id: "keep" }],
      localComments: { q: "keep" },
      collectionPersonal: {
        [`${userId}::collection-a`]: { favorites: ["newer-favorite"], archived: ["local-archive"], initialized: true },
        [`${otherUserId}::collection-b`]: { favorites: ["other"], archived: [] }
      }
    }),
    [`naga-nanikiru:library-order-v215:${userId}`]: JSON.stringify(["local-first", "shared"])
  });
  const payload = api.validateImportPayload({
    format: "naga-nanikiru-legacy-transfer",
    version: 232,
    userId,
    collectionPersonal: { [`${userId}::collection-a`]: { favorites: ["imported-favorite"], archived: ["imported-archive"] } },
    libraryOrder: ["imported-first", "shared"]
  }, userId);
  const result = api.mergeImportedData({ storage, userId, payload });
  const state = JSON.parse(storage.dump(`naga-nanikiru:user-state-v1:cloudflare:${userId}`));
  assert.equal(result.scopeCount, 1);
  assert.deepEqual(state.collectionPersonal[`${userId}::collection-a`].favorites, ["newer-favorite", "imported-favorite"]);
  assert.deepEqual(state.collectionPersonal[`${userId}::collection-a`].archived, ["local-archive", "imported-archive"]);
  assert.deepEqual(JSON.parse(storage.dump(`naga-nanikiru:library-order-v215:${userId}`)), ["local-first", "shared", "imported-first"]);
  assert.deepEqual(state.answerHistory, [{ id: "keep" }]);
  assert.deepEqual(state.localComments, { q: "keep" });
  assert.deepEqual(state.collectionPersonal[`${otherUserId}::collection-b`], { favorites: ["other"], archived: [] });
  assert.deepEqual(JSON.parse(storage.dump("naga-nanikiru:user-state-v1")).answerHistory, [{ id: "legacy-global" }]);
});

test("import file metadata is bounded to JSON and 512KB", async () => {
  const api = await loadTransferApi();
  assert.equal(api.validateFileMetadata({ size: 12, type: "application/json", name: "transfer.json" }), true);
  assert.throws(() => api.validateFileMetadata({ size: 12, type: "text/plain", name: "transfer.json" }), /JSON/);
  assert.throws(() => api.validateFileMetadata({ size: 12, type: "application/json", name: "transfer.txt" }), /JSON/);
  assert.throws(() => api.validateFileMetadata({ size: 512 * 1024 + 1, type: "application/json", name: "transfer.json" }), /512KB/);
});

test('static legacy entrance exports without login and imports only the logged-in account',async()=>{
  const api=await loadTransferApi();
  const storage=memoryStorage({
    'naga-nanikiru:user-state-v1':JSON.stringify({answerHistory:[{private:'do-not-transfer'}],access_token:'secret',collectionPersonal:{
      [`${userId}::one`]:{favorites:['q1'],archived:[]},[`${otherUserId}::two`]:{favorites:['q2'],archived:[]},
    }}),
    [`naga-nanikiru:library-order-v215:${userId}`]:JSON.stringify(['one']),
    'sb-project-auth-token':'secret-token',
  });
  const before=storage.dump('naga-nanikiru:user-state-v1');
  const bundle=api.buildStaticExport(storage);
  assert.equal(bundle.users.length,2);assert.doesNotMatch(JSON.stringify(bundle),/secret|do-not-transfer|auth-token/);
  const selected=api.validateImportPayload(bundle,userId);
  assert.deepEqual(Object.keys(selected.scopes),[`${userId}::one`]);
  assert.throws(()=>api.validateImportPayload(bundle,'33333333-3333-4333-8333-333333333333'),/本人/);
  assert.equal(storage.dump('naga-nanikiru:user-state-v1'),before);
});
