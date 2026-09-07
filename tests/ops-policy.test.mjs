import test from 'node:test';
import assert from 'node:assert/strict';
import {DAY,HOUR,severity,evaluate,parseEgress,buildMetrics} from '../ops/policy.mjs';
const now=Date.parse('2026-09-07T12:00:00Z');
const base={startedAt:new Date(now-2*DAY).toISOString(),observeUntil:new Date(now-DAY).toISOString(),enforcementApproved:true,blocked:false};
const source={id:'test',label:'test',status:'ok',lastSuccessAt:new Date(now).toISOString()};
const metric={id:'database-test',label:'test',used:1,limit:100,status:'ok'};
for(const [used,expected]of [[0,'normal'],[49,'normal'],[50,'notice'],[74,'notice'],[75,'warning'],[89,'warning'],[90,'critical'],[100,'critical'],[null,'unknown']])test('normal threshold '+used,()=>assert.equal(severity({...metric,used}),expected));
for(const [used,expected]of [[6999999999,'normal'],[7e9,'warning'],[7999999999,'warning'],[8e9,'critical']])test('R2 threshold '+used,()=>assert.equal(severity({...metric,id:'r2-storage',used}),expected));
test('observe never imposes new blocks',()=>assert.equal(evaluate({...base,observeUntil:new Date(now+HOUR).toISOString()},[{...metric,used:99}],[source],now).blocked,false));
test('read failure past24h blocks heavy only',()=>assert.equal(evaluate(base,[metric],[{...source,status:'unknown',lastSuccessAt:new Date(now-DAY-1).toISOString()}],now).blocked,true));
test('latched block requires explicit safe resume',()=>{const x=evaluate({...base,blocked:true},[metric],[source],now);assert.equal(x.blocked,true);assert.equal(x.canResume,true);});
test('unknown metric prevents resume',()=>assert.equal(evaluate({...base,blocked:true},[{...metric,used:null}],[source],now).canResume,false));
test('exact75 or7GB do not allow resume',()=>{for(const m of [{...metric,used:75},{...metric,id:'r2-storage',used:7e9}])assert.equal(evaluate({...base,blocked:true},[m],[source],now).canResume,false);});
test('valid manual egress including zero',()=>assert.equal(parseEgress({periodStart:'2026-09-06',periodEnd:'2026-10-06',confirmedAt:new Date(now).toISOString(),uncachedBytes:0,cachedBytes:0},now).uncachedBytes,0));
for(const bad of [{uncachedBytes:-1},{cachedBytes:'0'},{periodEnd:'2026-09-07'},{confirmedAt:'2026-09-01'},{periodStart:'2026-02-31'}])test('manual rejects '+JSON.stringify(bad),()=>assert.throws(()=>parseEgress({periodStart:'2026-09-06',periodEnd:'2026-10-06',confirmedAt:new Date(now).toISOString(),uncachedBytes:1,cachedBytes:0,...bad},now)));
test('missing sources not zero',()=>{const m=buildMetrics({},null,now);assert.equal(m.find(x=>x.id==='supabase-storage').used,null);assert.equal(m.find(x=>x.id==='egress').used,null);assert.equal(m.find(x=>x.id==='r2-storage').used,null);});

test('daily metadata remains dated and current for 48h; manual Egress is never automatic',()=>{
 const old={value:{databaseBytes:100,tables:[],storage:[]},lastSuccessAt:new Date(now-30*HOUR).toISOString(),failures:0};
 const raw={minkiru:old,ranking:old,r2:{...old,value:{bytes:100,imageBytes:100,managementBytes:0}}};
 const entry={periodStart:'2026-09-06',periodEnd:'2026-10-06',confirmedAt:new Date(now-30*HOUR).toISOString(),uncachedBytes:123,cachedBytes:0};
 const metrics=buildMetrics(raw,entry,now,true);
 for(const id of ['database-minkiru','supabase-storage','r2-storage'])assert.equal(metrics.find(x=>x.id===id).status,'ok');
 assert.equal(metrics.find(x=>x.id==='egress').status,'manual');
 assert.equal(buildMetrics(raw,entry,now+20*HOUR,true).find(x=>x.id==='supabase-storage').status,'stale');
 assert.equal(buildMetrics(raw,entry,Date.parse('2026-10-06'),true).find(x=>x.id==='egress').used,null);
 assert.equal(evaluate({...base,readOnly:true,blocked:true},[{...metric,used:999}],[{...source,status:'unknown'}],now).blocked,false);
});
test('physical DB residual and app attribution add exactly',()=>{
 const item=(value)=>({value,lastSuccessAt:new Date(now).toISOString(),failures:0});
 const metrics=buildMetrics({minkiru:item({databaseBytes:150,tables:[{name:'questions',appId:'minkiru',bytes:100,count:2}],storage:[{bucket:'naga-question-assets',bytes:70,count:2,unknown:0}]}),ranking:item({databaseBytes:50,tables:[{name:'ensuku_rankings',appId:'ensuku',bytes:20,count:4}],storage:[]}),r2:item({bytes:100,imageBytes:90,imageCount:10,managementBytes:10,managementCount:1,activeBytes:50,oldBytes:40,unknownBytes:0})},null,now);
 for(const id of ['supabase-storage','supabase-database','r2-storage']){const m=metrics.find(x=>x.id===id);assert.equal(m.parts.reduce((n,p)=>n+p.bytes,0),m.used);}
 assert.equal(metrics.find(x=>x.id==='supabase-database').limit,null);
 assert.equal(metrics.find(x=>x.id==='supabase-database').parts.find(x=>x.appId==='common').bytes,80);
});
