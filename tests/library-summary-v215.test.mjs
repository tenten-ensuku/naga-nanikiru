import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const client = await readFile(new URL('../client/supabase-sync.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260901000500_collection_library_summary_v215.sql', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

function clientApi(result) {
  const start = client.indexOf('async function loadCollectionLibrarySummary(');
  const end = client.indexOf('async function loadSharedQuestionPage(', start);
  assert.ok(start >= 0 && end > start);
  const source = ts.transpileModule(client.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = [];
  const sandbox = { requireClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return result; } }) };
  vm.runInNewContext(source + '\nthis.api = loadCollectionLibrarySummary;', sandbox);
  return { api: sandbox.api, calls };
}

test('V215 collection preview RPC is authenticated, access-scoped and read-only', () => {
  assert.match(migration, /v_user_id uuid := \(select auth\.uid\(\)\)/);
  assert.match(migration, /if v_user_id is null/);
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /private\.can_access_collection\(c\.id\)/);
  assert.match(migration, /c\.archived_at is null/);
  assert.match(migration, /q\.collection_id = v_collection_id\s+and q\.deleted_at is null/);
  assert.match(migration, /a\.user_id = v_user_id/);
  assert.match(migration, /from public, anon, authenticated, service_role/);
  assert.match(migration, /grant execute[\s\S]*to authenticated/);
  assert.doesNotMatch(migration, /\b(insert into|update public|delete from|alter table)\b/i);
});

test('V215 preview returns four aggregates, using latest grades and only in-scope archive ids', () => {
  const contract = migration.slice(migration.indexOf('returns table ('), migration.indexOf('language plpgsql'));
  for (const field of ['question_count', 'answered_count', 'mastered_count', 'last_activity_at']) assert.match(contract, new RegExp(field));
  assert.doesNotMatch(contract, /payload|user_id|question_id|answer json/);
  assert.match(migration, /a\.answered_at desc, a\.id desc\s+limit 1/);
  assert.match(migration, /latest\.grade in \('〇', '◎', '💮'\)/);
  assert.match(migration, /q\.id::text = any\(coalesce\(p_archived_keys/);
  assert.match(migration, /cardinality\(p_archived_keys\).*20000/);
});

test('V215 client normalizes archive ids and uses a single aggregate request', async () => {
  const { api, calls } = clientApi({ data: [{ question_count: 89, answered_count: 2, mastered_count: 1 }], error: null });
  const id = '12345678-1234-1234-ABCD-1234567890AB';
  const result = await api(' book ', [id, id.toLowerCase(), null, {}, 'not-a-uuid']);
  assert.equal(result.question_count, 89);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'get_collection_library_summary');
  assert.equal(calls[0].args.p_share_slug, 'book');
  assert.deepEqual(Array.from(calls[0].args.p_archived_keys), [id.toLowerCase()]);
});

test('V215 client bounds archive input and does not reinterpret a denied request as zero', async () => {
  const { api, calls } = clientApi({ data: [{ question_count: 0 }], error: null });
  const ids = Array.from({ length: 20005 }, (_, i) => '00000000-0000-0000-0000-' + i.toString(16).padStart(12, '0'));
  await api('book', ids);
  assert.equal(calls[0].args.p_archived_keys.length, 20000);
  const denied = new Error('denied');
  await assert.rejects(clientApi({ error: denied }).api('book'), error => error === denied);
  await assert.rejects(clientApi({ data: [], error: null }).api('book'), /取得できません/);
  await assert.rejects(api(' '), /問題集を選択/);
});

test('V215 adapter reuses the current account and series archive scope without modifying its state', () => {
  const section = html.slice(html.indexOf('loadSummary: async (slug'), html.indexOf('loadSeries: async slug'));
  assert.match(section, /supabaseSessionV46\?\.user\?\.id/);
  assert.match(section, /parentSlug \|\| slug/);
  assert.match(section, /userStateV16\.collectionPersonal\?\.\[scopeKey\]\?\.archived/);
  assert.doesNotMatch(section, /saveUserState|setItem|push\(/);
  assert.match(html, /library-order-v215\.js\?v=224/);
});
