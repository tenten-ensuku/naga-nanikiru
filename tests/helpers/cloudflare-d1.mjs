import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
// Deterministic local adapter; never connects to a real account or public endpoint.
export function testD1({builder=true,generation=false,discord=false}={}){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(new URL('../../cloudflare/migrations/0001_minkiru.sql',import.meta.url),'utf8'));
  sqlite.exec(fs.readFileSync(new URL('../../cloudflare/migrations/0006_collection_managers_v290.sql',import.meta.url),'utf8'));
  sqlite.exec(fs.readFileSync(new URL('../../cloudflare/migrations/0007_notifications_v314.sql',import.meta.url),'utf8'));
  sqlite.exec(fs.readFileSync(new URL('../../cloudflare/migrations/0008_standard_reactions_v329.sql',import.meta.url),'utf8'));
  if(builder)sqlite.exec(fs.readFileSync(new URL('../../cloudflare/migrations/0002_collection_builder_v235.sql',import.meta.url),'utf8'));
  if(generation)sqlite.exec(fs.readFileSync(new URL('../../cloudflare/migrations/0003_generation_v241.sql',import.meta.url),'utf8'));
  if(discord)sqlite.exec(fs.readFileSync(new URL('../../cloudflare/migrations/0004_discord_sync_v242.sql',import.meta.url),'utf8'));
  const db={sqlite,close:()=>sqlite.close(),prepare(sql){
    let params=[];
    return {bind(...values){params=values;return this;},async first(column){const row=sqlite.prepare(sql).get(...params);return row?(column?row[column]:{...row}):null;},
      syncAll(){return {success:true,results:sqlite.prepare(sql).all(...params).map(x=>({...x}))};}, async all(){return this.syncAll();},
      async run(){const result=sqlite.prepare(sql).run(...params);return {success:true,meta:{changes:Number(result.changes)}};}};
  },async batch(statements){sqlite.exec('BEGIN; PRAGMA defer_foreign_keys=ON;');try{const results=[];for(const s of statements)results.push(s.syncAll());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  return db;
}
