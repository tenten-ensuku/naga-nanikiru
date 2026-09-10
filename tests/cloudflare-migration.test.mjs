import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {encodeValue,assertPrivateDirectory} from '../scripts/minkiru-migration.mjs';
import {checkedResults,validateWriteBudget,conservativeAccountWrites} from '../scripts/minkiru-d1-import.mjs';
import {testD1} from './helpers/cloudflare-d1.mjs';
test('migration preserves JSON and boolean types and rejects unsafe integers and paths',()=>{
  assert.equal(encodeValue({text:'伏せ字 ||維持||',array:[1,null]},'jsonb'),'{"text":"伏せ字 ||維持||","array":[1,null]}');
  assert.equal(encodeValue(false,'boolean'),0);assert.equal(encodeValue(true,'boolean'),1);
  assert.throws(()=>encodeValue('false','boolean'));assert.throws(()=>encodeValue(Number.MAX_SAFE_INTEGER+1,'bigint'));
  const base=path.resolve('private-fixture');assert.equal(assertPrivateDirectory(path.join(base,'dated'),base),path.join(base,'dated'));
  for(const value of [base,path.join(base,'..','public')])assert.throws(()=>assertPrivateDirectory(value,base));
});
test('partial or ambiguous import API results cannot be reported as successful',()=>{
  assert.deepEqual(checkedResults({status:200,data:{success:true,result:[{success:true,results:[]}]}}),[{success:true,results:[]}]);
  for(const response of [{status:402},{status:200,data:{success:true,result:[{success:false}]}},{status:200,data:{success:false,result:[]}}])assert.throws(()=>checkedResults(response));
});
test('owner-selected free budget preserves a hard reserve and never trusts lagging analytics',()=>{
  assert.equal(validateWriteBudget(98000),98000);
  for(const n of [100000,99999,0,NaN,Infinity,98000.5])assert.throws(()=>validateWriteBudget(n));
  assert.equal(conservativeAccountWrites(84994,12041,90000),97035);
  assert.equal(conservativeAccountWrites(84994,12041,97600),97600);
  assert.throws(()=>conservativeAccountWrites(84994,-1));
});
test('D1 batch constraint failure rolls back data and migration marker together',async t=>{
  const db=testD1();t.after(()=>db.close());
  await assert.rejects(db.batch([
    db.prepare("INSERT INTO profiles(id) VALUES ('fixture')"),
    db.prepare("INSERT INTO profiles(id) VALUES ('fixture')"),
    db.prepare("INSERT INTO migration_batches(batch_id,sha256,row_count) VALUES ('test','hash',2)"),
  ]));
  assert.equal(await db.prepare('SELECT count(*) n FROM profiles').first('n'),0);
  assert.equal(await db.prepare('SELECT count(*) n FROM migration_batches').first('n'),0);
});
test('source-scene uniqueness preserves PostgreSQL NULLS NOT DISTINCT semantics',t=>{
  const db=testD1();t.after(()=>db.close());
  db.sqlite.exec("INSERT INTO profiles(id) VALUES ('u'); INSERT INTO collections(id,owner_id,title,share_slug) VALUES ('c','u','fixture','fixture')");
  db.sqlite.exec("INSERT INTO questions(id,collection_id,created_by) VALUES ('q','c','u')");
  assert.throws(()=>db.sqlite.exec("INSERT INTO questions(id,collection_id,created_by) VALUES ('q2','c','u')"));
  db.sqlite.exec("INSERT INTO questions(id,collection_id,created_by,source_report_id) VALUES ('q3','c','u','')");
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM questions').get().n,2);
});
