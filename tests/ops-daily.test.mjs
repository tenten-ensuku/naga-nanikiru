import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpsWorker,initialState,snapshot} from '../ops/worker.mjs';
import {DAY,HOUR} from '../ops/policy.mjs';

// Same in-memory R2/Access/fetch fixture style as ops-worker.test.mjs.
// No production credentials, image bodies, filesystem writes or live requests.
class Bucket {
  constructor({images=false}={}) {
    this.rows=new Map();this.seq=0;this.gets=[];this.puts=[];this.lists=[];this.deletes=[];
    this.images=images;this.metadataBytes=0;
  }
  async get(key) {
    this.gets.push(key);
    if(this.images)throw new Error('image bodies must never be fetched');
    const row=this.rows.get(key);
    return row?{...row,json:async()=>JSON.parse(row.body)}:null;
  }
  async put(key,body,options={}) {
    const old=this.rows.get(key),condition=options.onlyIf;
    if(condition?.etagMatches&&old?.etag!==condition.etagMatches||condition?.etagDoesNotMatch==='*'&&old)return null;
    const row={key,body,etag:String(++this.seq),size:Buffer.byteLength(body),uploaded:new Date()};
    this.rows.set(key,row);this.puts.push(key);return row;
  }
  async list({prefix='',cursor,limit=1000}={}) {
    this.lists.push({prefix,cursor,limit});
    const rows=[...this.rows.values()].filter(row=>row.key.startsWith(prefix)).sort((a,b)=>a.key.localeCompare(b.key));
    const start=Number(cursor||0);
    const result={objects:rows.slice(start,start+limit).map(({key,size,etag,uploaded})=>({key,size,etag,uploaded})),truncated:rows.length>start+limit,cursor:String(start+limit)};
    this.metadataBytes+=Buffer.byteLength(JSON.stringify(result));return result;
  }
  async delete(keys) {
    for(const key of [keys].flat()){this.rows.delete(key);this.deletes.push(key);}
  }
}

const stamp=Date.parse('2026-09-07T03:00:00Z');
const jstDay=time=>new Date(time+9*HOUR).toISOString().slice(0,10);
const request=(pathname,body)=>new Request('https://ops.test'+pathname,body===undefined?{}:{method:'POST',headers:{Origin:'https://ops.test','Content-Type':'application/json'},body:JSON.stringify(body)});
const options=more=>({verify:async()=>true,pause:async()=>{},...more});
function healthy(time=stamp) {
  const source=value=>({value,checkedAt:new Date(time).toISOString(),lastSuccessAt:new Date(time).toISOString(),failures:0});
  const state=initialState(time-2*DAY);
  state.enforcementApproved=true;state.successfulTicks=100;state.generatedAt=new Date(time).toISOString();
  state.egress={periodStart:'2026-09-06',periodEnd:'2026-10-06',confirmedAt:new Date(time).toISOString(),uncachedBytes:0,cachedBytes:0};
  state.raw={
    minkiru:source({databaseBytes:100,tables:[],storage:[]}),
    ranking:source({databaseBytes:100,tables:[],storage:[]}),
    r2:source({bytes:100,imageBytes:90,imageCount:1,managementBytes:10,managementCount:1,activeBytes:90,activeCount:1,oldBytes:0,oldCount:0,unknownBytes:0,unknownCount:0}),
    cloudflare:source({workersRequests:1,classA:1,classB:1,day:new Date(time).toISOString().slice(0,10),month:'2026-09-01'}),
    egress:source({}),
  };return state;
}
function fixture(at=stamp) {
  let time=at;
  const env={OPS_DATA:new Bucket(),IMAGES:new Bucket({images:true}),MINKIRU_URL:'https://main.supabase.co',RANKING_URL:'https://ranking.supabase.co',OPS_MONITOR_TOKEN:'test-token',CF_ACCOUNT_ID:'abc',CF_ANALYTICS_TOKEN:'test-analytics',READ_ONLY_MODE:'true',COLLECTOR_ENABLED:'true',CONTROL_SYNC_ENABLED:'true',ENFORCEMENT_READY:'true',NOTIFICATIONS_ENABLED:'false'};
  env.IMAGES.rows.set('naga-question-assets/current.png',{key:'naga-question-assets/current.png',etag:'image-metadata',size:1234,uploaded:new Date(at)});
  const log=[];
  const fetchImpl=async(url,init={})=>{
    const body=init.body?JSON.parse(init.body):null;
    const call={url:String(url),body,responseBytes:0};log.push(call);
    let value;
    if(call.url==='https://api.cloudflare.com/client/v4/graphql')value={data:{viewer:{accounts:[{workersInvocationsAdaptive:[{sum:{requests:1}}],r2OperationsAdaptiveGroups:[]}]}}};
    else if([env.MINKIRU_URL,env.RANKING_URL].some(origin=>call.url===origin+'/functions/v1/ops-capacity')){
      if(body?.action==='snapshot')value={databaseBytes:100,tables:[],storage:[],note:'集計メタデータ'};
      else if(body?.action==='references')value={keys:['naga-question-assets/current.png'],checkedAt:new Date(time).toISOString(),ledgerBytes:1234,ledgerCount:1};
      else if(['control','budget'].includes(body?.action))value={ok:true}; // Budget is allowed; record control attempts even if the API would accept them.
      else throw new Error('unexpected monitor action in offline fixture');
    }else throw new Error('unexpected URL in offline fixture');
    const text=JSON.stringify(value);call.responseBytes=Buffer.byteLength(text);
    return new Response(text,{headers:{'Content-Type':'application/json'}});
  };
  const worker=()=>createOpsWorker(options({now:()=>time,fetchImpl}));
  return {env,log,worker,setTime:value=>{time=value;},now:()=>time};
}
function collectionCounts({env,log}) {
  return {
    minkiru:log.filter(call=>call.url.startsWith(env.MINKIRU_URL+'/')&&call.body?.action==='snapshot').length,
    ranking:log.filter(call=>call.url.startsWith(env.RANKING_URL+'/')&&call.body?.action==='snapshot').length,
    references:log.filter(call=>call.body?.action==='references').length,
    budget:log.filter(call=>call.body?.action==='budget').length,
    r2:env.IMAGES.lists.length,
    cloudflare:log.filter(call=>call.url.endsWith('/graphql')).length,
  };
}
const oneCollection={minkiru:1,ranking:1,references:1,budget:1,r2:1,cloudflare:1};
const stored=(bucket,key)=>JSON.parse(bucket.rows.get(key)?.body||'null');
const historyWrites=bucket=>bucket.puts.filter(key=>key==='history.json');

test('read-only tick collects once per JST date, including UTC midnight and a new Worker instance',async()=>{
  const f=fixture(Date.parse('2026-09-06T23:59:00Z')); // JST 09/07 08:59.
  await f.worker().tick(f.env);
  assert.deepEqual(collectionCounts(f),oneCollection,'both DB snapshots, one inventory and one CF query');
  for(const time of ['2026-09-06T23:59:00Z','2026-09-07T00:01:00Z','2026-09-07T02:00:00Z','2026-09-07T14:59:00Z']){
    f.setTime(Date.parse(time));await f.worker().tick(f.env);
  }
  assert.deepEqual(collectionCounts(f),oneCollection,'same JST day must not recollect after restart, UTC midnight or hourly expiry');
  assert.deepEqual(historyWrites(f.env.OPS_DATA),['history.json']);
  assert.deepEqual(stored(f.env.OPS_DATA,'history.json').daily.map(row=>jstDay(Date.parse(row.at))),['2026-09-07']);
  assert.deepEqual(f.env.IMAGES.gets,[]);
});

test('the next JST date recollects every source even less than ten minutes after the previous tick',async()=>{
  const f=fixture(Date.parse('2026-09-07T14:59:00Z')); // JST 23:59 -> 00:01, same UTC date.
  await f.worker().tick(f.env);
  f.setTime(Date.parse('2026-09-07T15:01:00Z'));await f.worker().tick(f.env);
  assert.deepEqual(collectionCounts(f),{minkiru:2,ranking:2,references:2,budget:2,r2:2,cloudflare:2});
  assert.deepEqual(historyWrites(f.env.OPS_DATA),['history.json','history.json']);
  assert.deepEqual(stored(f.env.OPS_DATA,'history.json').daily.map(row=>jstDay(Date.parse(row.at))),['2026-09-07','2026-09-08']);
  await f.worker().tick(f.env);
  assert.deepEqual(collectionCounts(f),{minkiru:2,ranking:2,references:2,budget:2,r2:2,cloudflare:2},'the second day is also claimed persistently');
});

test('read-only overrides enforcement flags and a saved latch; owner resume cannot call control APIs',async()=>{
  const f=fixture(),state=healthy();state.blocked=true;state.blockReasons=['previous mode latch'];
  await f.env.OPS_DATA.put('state.json',JSON.stringify(state));
  const worker=f.worker();
  // The same state is safely resumable in the legacy mode: refusal must come from read-only.
  assert.equal(snapshot(state,stamp).control.canResume,true);
  const resume=await worker.fetch(request('/api/resume',{confirm:true}),f.env,{});
  assert.ok(resume.status>=400&&resume.status<500,'read-only must reject a valid, same-origin owner resume');
  // A high-capacity source and the mistakenly enabled flags must never arm anything.
  f.env.IMAGES.rows.get('naga-question-assets/current.png').size=9e9;
  await worker.tick(f.env);
  assert.equal(f.log.filter(call=>call.body?.action==='control').length,0,'no control API calls from either resume or tick');
  const response=await worker.fetch(request('/api/latest'),f.env,{});
  assert.equal(response.status,200);
  for(const view of [await response.json(),stored(f.env.OPS_DATA,'latest.json')]){
    assert.equal(view.control.mode,'read-only');assert.equal(view.control.blocked,false);assert.equal(view.control.canResume,false);
  }
});

test('GET latest/history reads saved data only, even when stale or uninitialized',async()=>{
  for(const initialized of [false,true]){
    const f=fixture();
    const history={daily:initialized?[{at:new Date(stamp-3*DAY).toISOString(),storageBytes:0,databaseBytes:200,r2Bytes:1234}]:[],recent:[]};
    if(initialized){
      const state=healthy(stamp-3*DAY);
      await f.env.OPS_DATA.put('state.json',JSON.stringify(state));
      await f.env.OPS_DATA.put('latest.json',JSON.stringify(snapshot(state,stamp-3*DAY)));
      await f.env.OPS_DATA.put('history.json',JSON.stringify(history));
    }
    const beforeWrites=f.env.OPS_DATA.puts.length,worker=f.worker();
    for(let repeat=0;repeat<2;repeat++){
      const latest=await worker.fetch(request('/api/latest'),f.env,{});
      assert.equal(latest.status,initialized?200:503);
      if(initialized)assert.equal((await latest.json()).generatedAt,new Date(stamp-3*DAY).toISOString());
      const beforeGets=f.env.OPS_DATA.gets.length,beforeLists=f.env.OPS_DATA.lists.length;
      const response=await worker.fetch(request('/api/history'),f.env,{});
      assert.equal(response.status,200);assert.deepEqual(await response.json(),history);
      assert.deepEqual(f.env.OPS_DATA.gets.slice(beforeGets),['history.json'],'history API uses exactly one R2 GET');
      assert.equal(f.env.OPS_DATA.lists.length,beforeLists,'history API must not list daily/ objects');
    }
    assert.deepEqual(f.log,[],'dashboard GETs cannot query production sources');
    assert.deepEqual(f.env.IMAGES.lists,[]);assert.deepEqual(f.env.IMAGES.gets,[]);
    assert.equal(f.env.OPS_DATA.puts.length,beforeWrites);assert.deepEqual(f.env.OPS_DATA.deletes,[]);
  }
});

test('history.json keeps 90 compact JST days with no new recent/ snapshots',async()=>{
  const f=fixture(),bucket=f.env.OPS_DATA;
  const daily=Array.from({length:92},(_,index)=>({at:new Date(stamp-(92-index)*DAY).toISOString(),storageBytes:0,databaseBytes:200,r2Bytes:1234}));
  await bucket.put('history.json',JSON.stringify({daily,recent:[]}));
  const seedWrites=bucket.puts.length;
  await f.worker().tick(f.env);
  const history=stored(bucket,'history.json');
  assert.equal(history.daily.length,90);
  const days=history.daily.map(row=>jstDay(Date.parse(row.at)));
  const expected=Array.from({length:90},(_,index)=>jstDay(stamp-(89-index)*DAY));
  assert.deepEqual(days,expected,'only the latest 90 JST dates remain');
  assert.deepEqual(history.daily.slice(0,-1),daily.slice(-89),'retained compact values are unchanged');
  assert.deepEqual(bucket.puts.slice(seedWrites).filter(key=>key.startsWith('recent/')),[],'no new recent snapshots');
  assert.deepEqual(bucket.puts.slice(seedWrites).filter(key=>key==='history.json'),['history.json']);
  for(const row of history.daily){
    for(const key of ['at','storageBytes','databaseBytes','r2Bytes'])assert.ok(Object.hasOwn(row,key),'compact history includes '+key);
    for(const key of ['raw','metrics','events','sources','candidates'])assert.equal(Object.hasOwn(row,key),false,'do not duplicate full snapshots in daily history');
  }
  assert.deepEqual(f.env.IMAGES.puts,[]);assert.deepEqual(f.env.IMAGES.deletes,[]);
});

test('snapshot overhead measures actual metadata bytes and request counts, with zero image bodies and optional CF',async()=>{
  for(const analyticsEnabled of [true,false]){
    const f=fixture();
    if(!analyticsEnabled)delete f.env.CF_ANALYTICS_TOKEN;
    // A large image size in list metadata must not become downloaded bytes.
    f.env.IMAGES.rows.get('naga-question-assets/current.png').size=9e9;
    await f.worker().tick(f.env);
    assert.deepEqual(collectionCounts(f),{...oneCollection,cloudflare:analyticsEnabled?1:0});
    const supabase=f.log.filter(call=>call.url.endsWith('/functions/v1/ops-capacity'));
    const response=await f.worker().fetch(request('/api/latest'),f.env,{});
    assert.equal(response.status,200);
    for(const view of [stored(f.env.OPS_DATA,'latest.json'),await response.json()]){
      const overhead=view.overhead;
      assert.ok(overhead,'persisted and GET snapshots both expose overhead');
      assert.equal(overhead.metadataOnly,true);
      assert.equal(overhead.requestCount,analyticsEnabled?5:4);
      assert.equal(overhead.requestCount,f.log.length);
      assert.equal(overhead.supabaseRequests,4);
      assert.equal(overhead.inputResponseBytes,f.log.reduce((sum,call)=>sum+call.responseBytes,0),'count UTF-8 response bytes, not characters or image sizes');
      assert.equal(overhead.supabaseResponseBytes,supabase.reduce((sum,call)=>sum+call.responseBytes,0));
      assert.equal(overhead.r2ListCalls,f.env.IMAGES.lists.length+f.env.OPS_DATA.lists.length);
      assert.equal(overhead.imageBodyBytes,0);
      assert.equal(Date.parse(overhead.measuredAt),f.now());
    }
    assert.deepEqual(f.env.IMAGES.gets,[],'image body requests are also zero');
    assert.deepEqual(f.env.IMAGES.puts,[]);assert.deepEqual(f.env.IMAGES.deletes,[]);
  }
});
