import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const botSourcePath = path.resolve(repoRoot, "..", "..", "outputs", "naga-thread-bot", "src", "supabase-sync.mjs");
const reportSourcePath = path.join(repoRoot, "supabase", "functions", "naga-report", "index.ts");
const captureSourcePath = path.join(repoRoot, "supabase", "functions", "naga-capture", "index.ts");
const capacitySourcePath = path.join(repoRoot, "supabase", "functions", "_shared", "ops-capacity.ts");
const migrationPath = path.join(repoRoot, "supabase", "migrations", "20260907103038_ops_capacity_v1.sql");

const [reportSource, captureSource, capacitySource, migration] = await Promise.all([
  readFile(reportSourcePath, "utf8"),
  readFile(captureSourcePath, "utf8"),
  readFile(capacitySourcePath, "utf8"),
  readFile(migrationPath, "utf8"),
]);
// The Bot is a separate local project, not published in the Pages repository.
const bot = await import(pathToFileURL(botSourcePath).href).catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});

function assertHeavyGuardOrdering(source, heavyMarker) {
  const authIndex = source.indexOf("supabase.auth.getUser()");
  const guardIndex = source.indexOf("checkOpsCapacity(");
  const heavyIndex = source.indexOf(heavyMarker);
  assert.ok(authIndex >= 0, "user authentication must remain present");
  assert.ok(guardIndex > authIndex, "capacity check must follow user authentication");
  assert.ok(heavyIndex > guardIndex, "capacity check must precede the heavy upstream call");
  assert.match(source, /serviceRoleKey:\s*Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/);
  assert.match(source, /return jsonResponse\(\{ error: capacity\.message \}, 503\)/);
  assert.doesNotMatch(source, /supabase\.rpc\(["']ops_capacity_status/);
}

test("heavy Edge Functions guard external work after authentication", () => {
  assert.match(reportSource, /\.\.\/_shared\/ops-capacity\.ts/);
  assert.match(captureSource, /\.\.\/_shared\/ops-capacity\.ts/);
  assertHeavyGuardOrdering(reportSource, "fetch(`https://naga.dmv.nico/reports/");
  assertHeavyGuardOrdering(captureSource, "fetch(endpoint");
});

test("capacity RPC contract is service-role-only and transport failure is bounded", () => {
  assert.match(capacitySource, /OPS_CAPACITY_RPC\s*=\s*["']ops_capacity_status["']/);
  assert.match(capacitySource, /method:\s*["']POST["']/);
  assert.match(capacitySource, /apikey:\s*key/);
  assert.match(capacitySource, /Authorization:\s*`Bearer \$\{key\}`/);
  assert.match(capacitySource, /AbortController/);
  assert.match(capacitySource, /OPS_CAPACITY_TIMEOUT_MS/);
  assert.match(capacitySource, /if \(status\.blocked\)/);
  assert.match(capacitySource, /OPS_CAPACITY_UNAVAILABLE_MESSAGE/);

  assert.match(migration, /armed\s+boolean\s+not null\s+default\s+false/i);
  assert.match(migration, /revoke\s+all\s+on\s+function\s+public\.ops_capacity_status\(\)\s+from\s+public,\s*anon,\s*authenticated/i);
  assert.match(migration, /grant\s+execute\s+on\s+function\s+public\.ops_capacity_status\(\)\s+to\s+service_role/i);
  assert.doesNotMatch(migration, /grant\s+execute\s+on\s+function\s+public\.ops_capacity_status\(\)\s+to\s+authenticated/i);
});

test("Bot checks the RPC once with the service-role key and honors unarmed default", {skip:!bot&&'Separate Bot checkout is not present; run its local suite'}, async () => {
  const calls = [];
  const result = await bot.checkOpsCapacity({
    supabaseUrl: "https://guard-test.supabase.co",
    secretKey: "sb_secret_test-only",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ blocked: false, reason: "operator-only", checkedAt: null });
    },
  });

  assert.equal(result.kind, "allowed");
  assert.equal("armed" in result.status, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://guard-test.supabase.co/rest/v1/rpc/ops_capacity_status");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.body, "{}");
  assert.equal(calls[0].options.headers.apikey, "sb_secret_test-only");
  assert.equal(calls[0].options.headers.Authorization, "Bearer sb_secret_test-only");
});

test("Bot holds unprocessed questions in the existing manifest circuit on capacity failure", {skip:!bot&&'Separate Bot checkout is not present; run its local suite'}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "naga-ops-capacity-"));
  const questionsPath = path.join(root, "questions.json");
  const manifestPath = path.join(root, "sync-manifest.json");
  const question = {
    threadUrl: "https://discord.com/channels/guild/channel/thread-capacity",
    title: "容量ガード試験",
    comments: [],
  };
  await writeFile(questionsPath, JSON.stringify([question]), "utf8");

  const baseOptions = {
    collectionId: "88c9cb70-6958-42b6-a433-5518388bc158",
    ownerId: "c574d471-7e7e-4d9d-b79f-930fc0bde839",
    supabaseUrl: "https://guard-test.supabase.co",
    secretKey: "sb_secret_test-only",
    questionsPath,
    assetRoot: root,
    manifestPath,
    assetProvider: "supabase",
    uploadAssets: true,
    fetchImpl: async () => Response.json({
      blocked: true,
      reason: "operator-only detail must not be persisted",
      checkedAt: new Date().toISOString(),
    }),
  };

  await assert.rejects(
    () => bot.syncQuestions(baseOptions),
    (error) => {
      assert.equal(error.code, "SYNC_CAPACITY_503");
      assert.equal(error.status, 503);
      assert.match(error.message, /重い同期/);
      assert.doesNotMatch(error.message, /operator-only/);
      return true;
    },
  );

  const saved = JSON.parse(await readFile(manifestPath, "utf8"));
  const legacyKey = "nima-thread-thread-capacity";
  assert.equal(saved.circuit.status, "paused");
  assert.equal(saved.circuit.httpStatus, 503);
  assert.equal(saved.circuit.operation, bot.OPS_CAPACITY_OPERATION);
  assert.equal(saved.questions[legacyKey].status, "pending");
  assert.equal(saved.queue.find((entry) => entry.key === legacyKey).status, "pending");
  assert.doesNotMatch(JSON.stringify(saved), /operator-only detail/);

  let resumedWithoutExplicitResume = 0;
  await assert.rejects(
    () => bot.syncQuestions({
      ...baseOptions,
      fetchImpl: async () => {
        resumedWithoutExplicitResume += 1;
        throw new Error("must not be reached while capacity circuit is paused");
      },
      resume: false,
    }),
    (error) => {
      assert.equal(error.code, "SYNC_CAPACITY_503");
      assert.equal(error.status, 503);
      return true;
    },
  );
  assert.equal(resumedWithoutExplicitResume, 0);
});

test("Bot treats a failed capacity confirmation as unavailable after one call", {skip:!bot&&'Separate Bot checkout is not present; run its local suite'}, async () => {
  let calls = 0;
  const result = await bot.checkOpsCapacity({
    supabaseUrl: "https://guard-test.supabase.co",
    secretKey: "sb_secret_test-only",
    fetchImpl: async () => {
      calls += 1;
      throw new Error("transport detail must stay out of the result");
    },
  });
  assert.equal(result.kind, "unavailable");
  assert.equal(calls, 1);
  assert.match(result.message, /容量確認/);
  assert.doesNotMatch(result.message, /transport detail/);
});
