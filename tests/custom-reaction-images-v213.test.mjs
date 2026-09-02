import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(testDir, "..");
const read = (relativePath) => fs.readFileSync(path.join(repoDir, relativePath), "utf8");

const html = read("public/index.html");
const css = read("public/ux-v159.css");
const syncClient = read("client/supabase-sync.ts");
const migration = read("supabase/migrations/20260830172600_custom_reaction_images_and_tiles_v213.sql");

test("V213 adds the 37 approved tile reactions between standard and custom", () => {
  assert.match(html, /const APP_VERSION = 220;/);
  assert.match(html, /data-reaction-tab="standard"[\s\S]*data-reaction-tab="tiles"[\s\S]*data-reaction-tab="custom"/);
  assert.match(html, /id="reactionPickerTilePanelV213"/);
  assert.match(html, /id="reactionTilePickerOptionsV213"/);
  assert.match(html, /iconType: "mahjong-tile"/);
  const keyBlock = html.match(/const MAHJONG_TILE_REACTION_KEYS_V213 = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] || "";
  const tileKeys = [...keyBlock.matchAll(/"([a-z]+[1-9])"/g)].map((match) => match[1]);
  assert.equal(tileKeys.length, 37);
  assert.deepEqual(tileKeys.slice(0, 3), ["man1", "man2", "man3"]);
  assert.deepEqual(tileKeys.slice(-3), ["aka1", "aka2", "aka3"]);
  assert.match(html, /tiles\/\$\{escapeHtml\(definition\.tileKey\)\}-66-90-l\.png/);
  assert.match(css, /\.reaction-mahjong-tile-icon-v213/);
  assert.match(css, /\.reaction-tile-picker-options-v213\s*\{[\s\S]*grid-template-columns: repeat\(10/);
  assert.match(css, /\.reaction-picker-option-v213\.is-tile \.reaction-picker-label-v208\s*\{[\s\S]*display: none/);
});

test("V213 accepts either an emoji or a shared image for custom reactions", () => {
  assert.match(html, /id="customReactionImageV213" type="file" accept="image\/png,image\/jpeg,image\/webp,image\/gif"/);
  assert.match(html, /絵文字または画像のどちらかを指定してください/);
  assert.match(html, /createCustomReaction\(label, icon, imageFile\)/);
  assert.match(html, /normalizeReactionAssetPathV213/);
  assert.match(html, /iconType: imagePath \? "image" : "emoji"/);
  assert.match(syncClient, /const REACTION_IMAGE_BUCKET = "reaction-assets"/);
  assert.match(syncClient, /publicReactionAssetUrl\(path: string\)/);
  assert.match(syncClient, /storage\.from\(REACTION_IMAGE_BUCKET\)\.upload/);
  assert.match(syncClient, /p_image_path: imagePath \|\| null/);
  assert.match(syncClient, /upsert: false/);
  assert.match(css, /\.custom-reaction-image-preview-v213/);
});

test("V213 protects reaction images and accepts tile keys in Supabase", () => {
  assert.match(migration, /add column if not exists image_path text/);
  assert.match(migration, /add column if not exists icon_type text not null default 'emoji'/);
  assert.match(migration, /'reaction-assets'/);
  assert.match(migration, /file_size_limit,[\s\S]*1048576/);
  assert.match(migration, /create policy reaction_assets_insert/);
  assert.match(migration, /create policy reaction_assets_delete/);
  assert.match(migration, /owner_id = current_user_id::text/);
  assert.match(migration, /create function public\.create_custom_reaction\([\s\S]*p_image_path text/);
  assert.match(migration, /grant execute on function public\.create_custom_reaction\(text, text, text\) to authenticated/);
  assert.match(migration, /'tile_man1'/);
  assert.match(migration, /'tile_aka3'/);
});
