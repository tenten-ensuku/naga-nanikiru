// Owner-operated, resumable import into the explicit new Minkiru DB only.
// Each data batch and its commit marker are committed together. No source writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {cfApi,ACCOUNT} from './ops-admin.mjs';
import {assertPrivateDirectory,TARGET_DB} from './minkiru-migration.mjs';
const route='/accounts/'+ACCOUNT+'/d1/database/'+TARGET_DB;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validateWriteBudget(value){
  // A higher owner-selected budget never removes the free-tier hard-stop reserve.
  if(!Number.isSafeInteger(value)||value<1000||value>99000)throw Error('Unsafe write budget');
  return value;
}
export function conservativeAccountWrites(startingWrites,runWrites,latestAccountWrites=0){
  if([startingWrites,runWrites,latestAccountWrites].some(x=>!Number.isSafeInteger(x)||x<0))throw Error('Invalid usage metadata');
  return Math.max(startingWrites+runWrites,latestAccountWrites);
}
export function checkedResults(response){
  if(response.status!==200||response.data?.success!==true||!Array.isArray(response.data.result)||response.data.result.some(x=>x.success!==true))throw Error('D1 import API failed; no automatic retry. Inspect commit markers before resuming.');
  return response.data.result;
}
export async function accountUsage(){
  const day=new Date().toISOString().slice(0,10);
  const query=`query { viewer { accounts(filter:{accountTag:"${ACCOUNT}"}) { d1AnalyticsAdaptiveGroups(limit:1000,filter:{date_geq:"${day}",date_leq:"${day}"}) { sum { rowsRead rowsWritten } } } } }`;
  const r=await cfApi('/graphql',{method:'POST',body:{query}}),rows=r.data?.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups;
  if(r.status!==200||r.data?.errors?.length||!Array.isArray(rows)||rows.length>=1000||rows.some(x=>!Number.isSafeInteger(x.sum?.rowsWritten)||!Number.isSafeInteger(x.sum?.rowsRead)))throw Error('Daily capacity unavailable; import not started');
  return {day,rowsWritten:rows.reduce((n,x)=>n+x.sum.rowsWritten,0),rowsRead:rows.reduce((n,x)=>n+x.sum.rowsRead,0)};
}
export async function importPrepared(input,{maxWrites=85000}={}){
  validateWriteBudget(maxWrites);
  const directory=assertPrivateDirectory(input),report=JSON.parse(await fs.readFile(path.join(directory,'prepared.json'),'utf8'));
  if(report.targetDatabase!==TARGET_DB||report.integrity!=='ok'||report.foreignKeys!=='ok')throw Error('Unexpected/unverified preparation');
  const before=JSON.parse(await fs.readFile(path.join(directory,'source-before.json'),'utf8'));
  const after=JSON.parse(await fs.readFile(path.join(directory,'source-after.json'),'utf8'));
  if(before.length!==after.length||before.some(x=>!after.some(y=>x.name===y.name&&x.rows===y.rows&&x.content_fingerprint===y.content_fingerprint)))throw Error('Source snapshot was not stable');
  const identity=await cfApi(route);if(identity.data?.result?.name!=='minkiru-main')throw Error('Wrong target DB');
  const start=await accountUsage();
  const oldProgress=JSON.parse(await fs.readFile(path.join(directory,'d1-import-progress.json'),'utf8').catch(e=>{if(e.code==='ENOENT')return '{}';throw e;}));
  // Analytics may lag behind a just-completed run. Never regain that spent budget by rerunning.
  if(oldProgress.day===start.day)start.rowsWritten=Math.max(start.rowsWritten,(oldProgress.accountStartingWrites||0)+(oldProgress.writes||0));
  let writes=0,reads=0,completed=0,remaining=0,pausedReason=null;
  let latestAccountWrites=start.rowsWritten,lastUsageCheck=0;
  const existing=checkedResults(await cfApi(route+'/query',{method:'POST',body:{sql:'SELECT batch_id,sha256,row_count FROM migration_batches'}}))[0].results;
  const commits=new Map(existing.map(x=>[x.batch_id,x]));
  const verified=JSON.parse(await fs.readFile(path.join(directory,'r2-verification.json'),'utf8').catch(e=>{if(e.code==='ENOENT')return '{"objects":[]}';throw e;}));
  const archiveReady=report.archives.every(x=>verified.objects.some(y=>x.key===y.key&&x.sha256===y.sha256&&x.bytes===y.bytes));
  const localJournalFile=path.join(directory,'d1-import-progress.json');
  // Preserve each earlier receipt before a resumed run replaces its progress view.
  if(oldProgress.startedAt){
    const priorName='d1-import-receipt-'+String(oldProgress.startedAt).replace(/[^0-9TZ]/g,'')+'.json';
    try{await fs.writeFile(path.join(directory,priorName),JSON.stringify(oldProgress,null,2),{flag:'wx'});}
    catch(error){if(error.code!=='EEXIST')throw error;}
  }
  const journal={startedAt:new Date().toISOString(),database:TARGET_DB,day:start.day,accountStartingWrites:start.rowsWritten,maxWrites,batches:[]};
  for(const item of report.batches){
    const id='20260910:'+item.file,prior=commits.get(id);
    if(prior){if(prior.sha256!==item.sha256||prior.row_count!==item.rows)throw Error('Remote commit marker mismatch');completed++;continue;}
    if(item.table==='audit_archives'&&!archiveReady){remaining++;pausedReason??='archive_verification_pending';continue;}
    // Metadata only; never download application tables to monitor usage.
    if(journal.batches.length-lastUsageCheck>=10){
      const live=await accountUsage();
      if(live.day!==start.day){pausedReason='daily_budget';break;}
      latestAccountWrites=Math.max(latestAccountWrites,live.rowsWritten);
      if(live.rowsRead>4e6){pausedReason='daily_budget';break;}
      lastUsageCheck=journal.batches.length;
    }
    // Conservatively reserve index and commit-marker writes for the next batch.
    if(new Date().toISOString().slice(0,10)!==start.day||conservativeAccountWrites(start.rowsWritten,writes,latestAccountWrites)+item.rows*8+4>maxWrites||start.rowsRead+reads>4e6){pausedReason='daily_budget';remaining++;continue;}
    if(!/^\d{5}\.json$/.test(item.file))throw Error('Unexpected batch path');
    const body=await fs.readFile(path.join(directory,'d1-batches',item.file),'utf8');
    if(hash(body)!==item.sha256)throw Error('Local batch checksum mismatch');
    const statements=JSON.parse(body);
    const results=checkedResults(await cfApi(route+'/query',{method:'POST',body:{batch:[
      {sql:'PRAGMA defer_foreign_keys=ON'},...statements,
      {sql:'INSERT INTO migration_batches(batch_id,sha256,row_count) VALUES (?,?,?)',params:[id,item.sha256,item.rows]},
    ]}}));
    const rowWrites=results.reduce((n,x)=>n+Number(x.meta?.rows_written??NaN),0),rowReads=results.reduce((n,x)=>n+Number(x.meta?.rows_read??NaN),0);
    if(!Number.isSafeInteger(rowWrites)||!Number.isSafeInteger(rowReads))throw Error('Usage metadata missing; stopped after committed batch');
    writes+=rowWrites;latestAccountWrites+=rowWrites;reads+=rowReads;completed++;
    journal.batches.push({id,rowsWritten:rowWrites,rowsRead:rowReads});
    await fs.writeFile(localJournalFile,JSON.stringify({...journal,completed,remaining,writes,reads,pausedReason},null,2));
    if(completed%25===0)console.log(JSON.stringify({completed,total:report.batches.length,writes}));
  }
  // A complete import must satisfy the same FK constraints as the local restore.
  if(completed===report.batches.length){
    const results=checkedResults(await cfApi(route+'/query',{method:'POST',body:{sql:'PRAGMA foreign_key_check'}}));
    if(results.some(x=>x.results.length))throw Error('Remote foreign key check failed');
  }
  const final={...journal,completed,remaining:report.batches.length-completed,writes,reads,pausedReason,complete:completed===report.batches.length,publicCutover:false,sourceWrites:0};
  await fs.writeFile(localJournalFile,JSON.stringify(final,null,2));return {...final,batches:journal.batches.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const option=process.argv[3];
  if(option&&!/^--max-writes=\d+$/.test(option))throw Error('Unknown import option');
  console.log(JSON.stringify(await importPrepared(process.argv[2],{maxWrites:option?validateWriteBudget(Number(option.split('=')[1])):85000})));
}
