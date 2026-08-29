import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const htmlUrl = new URL("../public/index.html", import.meta.url);
const clientUrl = new URL("../client/supabase-sync.ts", import.meta.url);
const migrationUrl = new URL("../supabase/migrations/20260828170511_pierre_collection_volumes_v180.sql", import.meta.url);
const accessContractMigrationUrl = new URL("../supabase/migrations/20260828174157_pierre_collection_access_contract_v181.sql", import.meta.url);

test("V180 defines the Pierre volume boundaries without changing question IDs", async () => {
  const [html, client, migration, accessContractMigration] = await Promise.all([
    readFile(htmlUrl, "utf8"),
    readFile(clientUrl, "utf8"),
    readFile(migrationUrl, "utf8"),
    readFile(accessContractMigrationUrl, "utf8"),
  ]);

  assert.match(html, /const APP_VERSION = 199;/);
  assert.match(migration, /\(1, 1, 200\)/);
  assert.match(migration, /\(2, 201, 400\)/);
  assert.match(migration, /\(3, 401, 600\)/);
  assert.match(migration, /\(4, 601, 800\)/);
  assert.match(migration, /\(5, 801, 1000\)/);
  assert.match(migration, /\(6, 1001, 1200\)/);
  assert.match(migration, /\(7, 1201, 1400\)/);
  assert.match(migration, /\(8, 1401, 1600\)/);
  assert.match(migration, /\(9, 1601, 1754\)/);
  assert.match(migration, /既存の問題ID・回答履歴・お気に入り状態は変更せず/);
  assert.match(migration, /update public\.questions q\s+set collection_id = volume_id/);
  assert.doesNotMatch(migration, /update public\.questions q\s+set id\s*=/i);
  assert.match(migration, /create trigger route_pierre_question_to_volume/);
  assert.match(migration, /get_collection_volumes/);
  assert.match(migration, /get_collection_volume_progress/);
  assert.match(migration, /series_parent_id is null/);
  assert.match(accessContractMigration, /can_view boolean/);
  assert.match(accessContractMigration, /owner_name text/);
  assert.match(accessContractMigration, /private\.can_access_collection\(c\.id\)/);
  assert.match(client, /is_series_parent === true/);
  assert.match(client, /loadCollectionVolumes/);
  assert.match(client, /loadCollectionVolumeProgress/);
});

test("V180 uses the parent as a lightweight entry point and scopes personal markers to the series", async () => {
  const html = await readFile(htmlUrl, "utf8");
  const chooser = html.match(/function renderCollectionChooserV165\([\s\S]*?function renderCollectionSpacePanelV100/)?.[0] || "";
  const recentView = html.match(/function renderRecentHistoryViewV180\([\s\S]*?function renderTodayViewV159/)?.[0] || "";

  assert.match(html, /function isSeriesParentCollectionV180\(/);
  assert.match(html, /window\.NagaSupabase\.loadCollectionVolumes\(shareSlug\)/);
  assert.match(html, /window\.NagaSupabase\.loadCollectionVolumeProgress\(shareSlug\)/);
  assert.match(html, /data-volume-number/);
  assert.match(html, /const range = Number\.isInteger\(start\) && Number\.isInteger\(end\)/);
  assert.match(html, /Number\(volume\?\.volume_start\)/);
  assert.match(html, /Number\(volume\?\.volume_end\)/);
  assert.match(html, /sharedCollectionV46\?\.series_parent_slug \|\| sharedCollectionV46\?\.share_slug/);
  assert.match(html, /sharedCollectionV46\?\.series_parent_id\s*\n?\s*\? "all"/);
  assert.match(html, /collection-choice-card-expansion/);
  assert.match(html, /current && isSeriesParentCollectionV180\(row\)/);
  assert.doesNotMatch(html, /const volumePicker = renderCollectionVolumeChooserV180\(\)/);
  assert.match(recentView, /直近の回答 10件/);
  assert.doesNotMatch(recentView, /todayQueueCandidatesV172\(\)/);
  assert.doesNotMatch(recentView, /今日の10問/);
  assert.doesNotMatch(html, /<span class="quick-start-title">今日の10問/);
});
