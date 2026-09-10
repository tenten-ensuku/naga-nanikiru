import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
// Deterministic local adapter; never connects to a real account or public endpoint.
export function testD1(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(new URL('../../cloudflare/migrations/0001_minkiru.sql',import.meta.url),'utf8'));
  const db={sqlite,close:()=>sqlite.close(),prepare(sql){
    let params=[];
    return {bind(...values){params=values;return this;},async first(column){const row=sqlite.prepare(sql).get(...params);return row?(column?row[column]:{...row}):null;},
      async all(){return {success:true,results:sqlite.prepare(sql).all(...params).map(x=>({...x}))};},
      async run(){const result=sqlite.prepare(sql).run(...params);return {success:true,meta:{changes:Number(result.changes)}};}};
  },async batch(statements){sqlite.exec('BEGIN; PRAGMA defer_foreign_keys=ON;');try{const results=[];for(const s of statements)results.push(await s.all());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  return db;
}
