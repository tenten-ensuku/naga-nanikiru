import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {registrationSql} from "../scripts/prepare-media-ledger.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const collection = "33333333-3333-4333-8333-333333333333";
const hash = "a".repeat(64);
const path = owner + "/comments/" + hash + ".png";
const key = "comment-assets/" + path;
const root = new URL("../", import.meta.url);
const migration = await readFile(new URL("supabase/migrations/20260906150107_r2_media_assets_v230.sql", root), "utf8");

test("migration ledger import is atomic, ownership checked and repeatable without double accounting",async()=>{
  const db=await fixture();
  try {
    const row={key:"naga-question-assets/"+collection+"/one.webp",bucket:"naga-question-assets",path:collection+"/one.webp",
      collection_id:collection,owner_id:owner,size_bytes:80,sha256:hash,content_type:"image/png",source_updated_at:"2026-08-01T00:00:00Z"};
    await db.exec(registrationSql([row]));
    await db.exec(registrationSql([row]));
    const stored=await db.query("select count(*)::int as count from public.media_assets");
    assert.equal(stored.rows[0].count,1);
    assert.equal((await db.query("select used_bytes::int as bytes from private.media_budget")).rows[0].bytes,80);
    await assert.rejects(db.exec(registrationSql([{...row,owner_id:other}])),/ownership/);
    await assert.rejects(db.exec(registrationSql([{...row,sha256:"b".repeat(64)}])),/conflict/);
    assert.equal((await db.query("select used_bytes::int as bytes from private.media_budget")).rows[0].bytes,80);
    assert.equal((await db.query("select extract(year from created_at)::int as year from public.media_assets")).rows[0].year,2026);
  } finally {await db.close();}
});

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; create schema private;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    grant usage on schema auth,storage,private to anon,authenticated,service_role;
    create table public.profiles(id uuid primary key,display_name text,avatar_url text);
    create table public.collections(id uuid primary key,share_slug text,owner_id uuid,allow_comments boolean default true,
      visibility text default 'private',published_at timestamptz default now(),archived_at timestamptz);
    create table public.questions(id uuid primary key,collection_id uuid,payload jsonb default '{}',deleted_at timestamptz);
    create table public.comments(id uuid primary key default gen_random_uuid(),collection_id uuid,question_id uuid,user_id uuid,
      body text,attachments jsonb default '[]',created_at timestamptz default now(),updated_at timestamptz default now(),deleted_at timestamptz);
    create table public.custom_reactions(reaction_key text primary key,label text,icon text,image_path text,icon_type text,
      creator_user_id uuid,created_at timestamptz default now());
    create table storage.objects(bucket_id text,name text,owner_id text);
    create function private.is_app_admin(uuid default auth.uid()) returns boolean language sql as $$select false$$;
    create function private.can_access_collection(uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.collections where id=$1 and owner_id=auth.uid());
    $$;
    create function private.can_contribute_collection(uuid) returns boolean language sql stable as $$select private.can_access_collection($1)$$;
    grant all on all tables in schema public to service_role;
    grant select on all tables in schema public to authenticated;
    grant insert,update on public.comments to authenticated;
    grant select on storage.objects to authenticated,service_role;
    alter table public.comments enable row level security;
    create policy comments_visible on public.comments for select to authenticated
      using (deleted_at is null and private.can_access_collection(collection_id));
    create policy comments_insert on public.comments for insert to authenticated
      with check (user_id=auth.uid() and private.can_access_collection(collection_id));
    create policy comments_update on public.comments for update to authenticated
      using(user_id=auth.uid()) with check(user_id=auth.uid());
    insert into public.profiles values('@OWNER@','owner',null),('@OTHER@','other',null);
    insert into public.collections(id,share_slug,owner_id) values('@COLLECTION@','fixture','@OWNER@');
  `.replaceAll("@OWNER@",owner).replaceAll("@OTHER@",other).replaceAll("@COLLECTION@",collection));
  for (const [file, name] of [
    ["20260816120000_collection_access_control_v100.sql","post_shared_comment"],
    ["20260814210757_comment_edit_delete.sql","update_shared_comment"],
    ["20260830172600_custom_reaction_images_and_tiles_v213.sql","create_custom_reaction"],
  ]) {
    const source = await readFile(new URL("supabase/migrations/" + file, root), "utf8");
    const expression = new RegExp("create (?:or replace )?function public\\." + name + "\\([\\s\\S]*?\\$(?:function)?\\$;", "i");
    const statement = source.match(expression)?.[0];
    assert.ok(statement, name);
    await db.exec(statement);
  }
  await db.exec(migration);
  return db;
}
async function role(db, name, uid = "") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
  await db.exec("set role " + name);
}
async function reserve(db, { assetPath = path, bytes = 80, digest = hash, userId = owner, bucket = "comment-assets" } = {}) {
  return db.query("select public.reserve_media_asset($1,$2,$3,$4,$5,$6,$7) as value",
    [bucket,assetPath,userId,collection,bytes,digest,"image/png"]);
}

test("media migration executes locally; service-only completion, ownership and reserved-byte cap", async () => {
  const db = await fixture();
  try {
    await role(db,"anon");
    await assert.rejects(db.query("select public.authorize_media_upload('comment-assets',$1,null)",[collection]), /permission denied/);
    await role(db,"authenticated",owner);
    await assert.rejects(reserve(db), /permission denied/);
    const permission = await db.query("select public.authorize_media_upload('comment-assets',$1,null) as value",[collection]);
    assert.equal(permission.rows[0].value.owner_id,owner);
    await role(db,"authenticated",other);
    await assert.rejects(db.query("select public.authorize_media_upload('comment-assets',$1,null)",[collection]), /access required/);
    await role(db,"service_role");
    assert.equal((await reserve(db)).rows[0].value.ready,false);
    assert.equal((await reserve(db)).rows[0].value.ready,false);
    await role(db,"authenticated",owner);
    assert.deepEqual((await db.query("select * from public.resolve_public_media($1)",[[key]])).rows,[]);
    await role(db,"service_role");
    assert.equal((await db.query("select used_bytes from private.media_budget")).rows[0].used_bytes,80);
    await assert.rejects(reserve(db,{digest:"b".repeat(64)}), /conflict/);
    await db.query("select public.complete_media_asset($1,$2)",[key,hash]);
    await role(db,"authenticated",owner);
    assert.equal((await db.query("select * from public.resolve_public_media($1)",[[key]])).rows[0].object_key,key);
    await role(db,"authenticated",other);
    assert.deepEqual((await db.query("select * from public.resolve_public_media($1)",[[key]])).rows,[]);
    await role(db,"service_role");
    assert.equal((await reserve(db)).rows[0].value.ready,true);
    await db.exec("update private.media_budget set limit_bytes=100");
    await assert.rejects(reserve(db,{assetPath:owner + "/comments/second.png",bytes:21}), /media_storage_limit/);
    assert.equal((await db.query("select used_bytes from private.media_budget")).rows[0].used_bytes,80);
    await role(db,"authenticated",other);
    assert.equal((await db.query("select * from public.media_assets")).rows.length,0);
    await role(db,"authenticated",owner);
    await assert.rejects(db.query("update public.media_assets set state='ready'"),/permission denied/);
    assert.equal((await db.query("select * from public.media_assets")).rows.length,1);
  } finally { await db.close(); }
});

test("existing comment RPC accepts completed owned R2 asset, rejects pending/foreign, refuses deletion while referenced", async () => {
  const db = await fixture();
  try {
    await role(db,"service_role");
    await reserve(db);
    await role(db,"authenticated",owner);
    const post = () => db.query("select public.post_shared_comment('fixture',null,'hello',$1::jsonb) as id",
      [JSON.stringify([{path,alt:"test"}])]);
    await assert.rejects(post(), /attachments are invalid/);
    await role(db,"service_role");
    await db.query("select public.complete_media_asset($1,$2)",[key,hash]);
    await role(db,"authenticated",owner);
    const created = await post();
    assert.ok(created.rows[0].id);
    await role(db,"service_role");
    await assert.rejects(db.query("select public.begin_media_asset_delete($1,$2)",[key,other]), /ownership/);
    await assert.rejects(db.query("select public.begin_media_asset_delete($1,$2)",[key,owner]), /in_use/);
    await db.query("update public.comments set deleted_at=now(),updated_at=now() where id=$1",[created.rows[0].id]);
    await role(db,"authenticated",owner);
    const changes = (await db.query("select public.get_shared_comment_changes('fixture') as value")).rows[0].value;
    assert.equal(changes.rows.length,1);
    assert.equal(changes.rows[0].body,"");
    assert.ok(changes.rows[0].deleted_at);
    await role(db,"authenticated",other);
    assert.equal((await db.query("select public.get_shared_comment_changes('fixture') as value")).rows[0].value.rows.length,0);
    await role(db,"service_role");
    assert.equal((await db.query("select public.begin_media_asset_delete($1,$2) as ok",[key,owner])).rows[0].ok,true);
    await db.query("select public.finish_media_asset_delete($1,true)",[key]);
    assert.equal((await db.query("select used_bytes from private.media_budget")).rows[0].used_bytes,0);
  } finally { await db.close(); }
});

test("an empty notification baseline still has a server cursor; later comments are deltas",async () => {
  const db = await fixture();
  try {
    await role(db,"authenticated",owner);
    const baseline = (await db.query("select public.get_shared_comment_changes('fixture') as value")).rows[0].value;
    assert.equal(baseline.rows.length,0);
    assert.ok(Date.parse(baseline.cursor.updatedAt));
    const created = await db.query("select public.post_shared_comment('fixture',null,'new comment','[]'::jsonb) as id");
    const changes = (await db.query("select public.get_shared_comment_changes('fixture',$1,$2) as value",[baseline.cursor.updatedAt,baseline.cursor.id])).rows[0].value;
    assert.equal(changes.rows[0].id,created.rows[0].id);
    assert.equal(changes.rows[0].body,"new comment");
    const noChanges = (await db.query("select public.get_shared_comment_changes('fixture',$1,$2) as value",[changes.cursor.updatedAt,changes.cursor.id])).rows[0].value;
    assert.deepEqual(noChanges.rows,[]);
    assert.deepEqual(noChanges.cursor,changes.cursor);
  } finally { await db.close(); }
});

test("inventory counts untracked objects and backups; failed inventory is not zero",async () => {
  const db = await fixture();
  try {
    await role(db,"service_role");
    await reserve(db);
    const snapshot = await db.query("select public.media_usage_snapshot(500,null) as value");
    assert.equal(snapshot.rows[0].value.used_bytes,500);
    const unknown = await db.query("select public.media_usage_snapshot(null,'inventory_unavailable') as value");
    assert.equal(unknown.rows[0].value.used_bytes,500);
    assert.equal(unknown.rows[0].value.error,"inventory_unavailable");
  } finally { await db.close(); }
});
