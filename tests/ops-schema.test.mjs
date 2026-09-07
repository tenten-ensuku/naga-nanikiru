import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import{PGlite}from'@electric-sql/pglite';
const migration=await readFile(new URL('../supabase/migrations/20260907103038_ops_capacity_v1.sql',import.meta.url),'utf8')+'\n'+await readFile(new URL('../supabase/migrations/20260907111035_ops_capacity_inventory_keys_v1.sql',import.meta.url),'utf8');
async function fixture(){const db=new PGlite();await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;create schema storage;
 grant usage on schema storage to service_role;
 create table storage.objects(bucket_id text,metadata jsonb);grant select on storage.objects to service_role;
 create table questions(id int primary key,payload jsonb,updated_at timestamptz);
 create table generation_jobs(id int primary key,status text);
 create table comments(id int primary key,body text,attachments jsonb);
 create table profiles(id int,avatar_url text);
 create table custom_reactions(id int,image_path text);
 create table media_assets(id int primary key,size_bytes bigint,state text);
 create table answer_attempts(id int primary key);
 grant select,insert,update on all tables in schema public to authenticated,service_role;
 `);await db.exec(migration);return db;}
test('service-only aggregate privileges and private RLS',async()=>{const db=await fixture();try{
 const check=await db.query("select has_function_privilege('anon','public.ops_capacity_snapshot()','EXECUTE') a,has_function_privilege('authenticated','public.ops_capacity_snapshot()','EXECUTE') u,has_function_privilege('service_role','public.ops_capacity_snapshot()','EXECUTE') s");assert.deepEqual(check.rows[0],{a:false,u:false,s:true});
 const r=await db.query("select relrowsecurity from pg_class where oid='private.ops_capacity_control'::regclass");assert.equal(r.rows[0].relrowsecurity,true);
 await assert.rejects(db.exec('set role authenticated; select * from private.ops_capacity_control'),/permission denied/);await db.exec('reset role');
}finally{await db.close();}});
test('observe allows writes, armed block preserves answers and text comments',async()=>{const db=await fixture();try{
 await db.exec("set role authenticated;insert into questions values(1,'{}',now()); insert into media_assets values(1,100,'pending');reset role;");
 await db.exec("update private.ops_capacity_control set armed=true,blocked=true,checked_at=now();set role authenticated;");
 await assert.rejects(db.exec("insert into questions values(2,'{}',now())"),/ops_capacity_limited/);
 await assert.rejects(db.exec("insert into generation_jobs values(1,'queued')"),/ops_capacity_limited/);
 await assert.rejects(db.exec("insert into media_assets values(2,200,'pending')"),/ops_capacity_limited/);
 await assert.rejects(db.exec("insert into comments values(1,'x','[{\"path\":\"image\"}]')"),/ops_capacity_limited/);
 await db.exec("insert into answer_attempts values(1);insert into comments values(2,'text','[]');update comments set body='text2' where id=2;update media_assets set state='ready' where id=1;update questions set updated_at=now() where id=1;");
 assert.equal((await db.query('select count(*)::int n from answer_attempts')).rows[0].n,1);
}finally{await db.close();}});
test('24hour stale policy blocks even without controller, rollback restores heavy only',async()=>{const db=await fixture();try{
 await db.exec("update private.ops_capacity_control set armed=true,blocked=false,checked_at=now()-interval '25 hours';set role authenticated;");
 await assert.rejects(db.exec("insert into questions values(1,'{}',now())"),/ops_capacity_limited/);
 await db.exec("reset role;update private.ops_capacity_control set armed=false;set role authenticated;insert into questions values(1,'{}',now());");
}finally{await db.close();}});
test('monitor API cannot set arbitrary timestamps or privileges',async()=>{const db=await fixture();try{
 await db.exec('set role service_role');await assert.rejects(db.exec("select ops_set_capacity_control(true,false,'',now()-interval '1 hour')"),/invalid_control/);
 await db.exec("select ops_set_capacity_control(false,false,'observation',now())");
}finally{await db.close();}});

test('inventory references return storage metadata only to service role, including nested payloads',async()=>{const db=await fixture();try{
 await db.exec(`insert into questions values(1,'{"scene":{"image":"https://example.invalid/naga-question-assets/a.webp","text":"private teaching text"}}',now());insert into media_assets values(1,12,'ready');`);
 await assert.rejects(db.exec('set role authenticated;select ops_media_references()'),/permission denied/);await db.exec('reset role;set role service_role');
 const row=(await db.query('select ops_media_references() result')).rows[0].result;
 assert.deepEqual(row.keys,['naga-question-assets/a.webp']);assert.equal(row.ledgerBytes,12);assert.doesNotMatch(JSON.stringify(row),/private teaching text/);
}finally{await db.close();}});
