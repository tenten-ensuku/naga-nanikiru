import {DAY,HOUR} from './policy.mjs';
import {monitor,inventory,cloudflareUsage,pruneSnapshots} from './collect.mjs';

export const jstDay=now=>new Date(now+9*HOUR).toISOString().slice(0,10);
export const dailyCollection={cadence:'daily',timezone:'Asia/Tokyo',scheduledTime:'03:00',automaticRefresh:false};

// Counts only responses the collector already needed. No diagnostic downloads,
// body copies of images, provider billing queries, or persistent image key lists.
export function meter(fetchImpl,env,now){
  const stats={metadataOnly:true,inputResponseBytes:0,requestCount:0,supabaseResponseBytes:0,supabaseRequests:0,r2ListCalls:0,imageBodyBytes:0,measuredAt:new Date(now).toISOString()};
  const measuredFetch=async(url,options)=>{
    stats.requestCount++;
    const supabase=[env.MINKIRU_URL,env.RANKING_URL].some(base=>base&&url===base+'/functions/v1/ops-capacity');
    if(supabase)stats.supabaseRequests++;
    const response=await fetchImpl(url,options);
    const bytes=await response.arrayBuffer();stats.inputResponseBytes+=bytes.byteLength;
    if(supabase)stats.supabaseResponseBytes+=bytes.byteLength;
    const headers=new Headers(response.headers);headers.delete('content-encoding');headers.delete('content-length');
    return new Response(bytes,{status:response.status,statusText:response.statusText,headers});
  };
  const wrap=bucket=>new Proxy(bucket,{get(target,key){if(key==='list')return async options=>{stats.r2ListCalls++;return target.list(options);};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  return{stats,fetch:measuredFetch,env:{...env,OPS_DATA:wrap(env.OPS_DATA),IMAGES:wrap(env.IMAGES)}};
}

export async function collectDaily(state,env,{now,fetchImpl,put,collect,alert,persist}){
  state.readOnly=true;state.enforcementApproved=false;state.blocked=false;state.blockReasons=[];
  const day=jstDay(now());
  if(state.dailyAttemptDay===day)return;
  // Claim before network I/O: even after a crash or a duplicate trigger no loop
  // will repeatedly scan production. A failed source retains its prior value.
  state.dailyAttemptDay=day;
  await put(env.OPS_DATA,'state.json',state);
  const measured=meter(fetchImpl,env,now());
  for(const id of ['minkiru','ranking'])await collect(state,id,()=>monitor(measured.env,id,'snapshot',undefined,measured.fetch));
  await collect(state,'cloudflare',()=>cloudflareUsage(measured.env,measured.fetch,now()));
  await pruneSnapshots(measured.env.OPS_DATA,now());
  await collect(state,'r2',()=>inventory(measured.env,measured.fetch));
  if(!state.raw.r2.failures)await monitor(measured.env,'minkiru','budget',{bytes:state.raw.r2.value.bytes},measured.fetch).catch(()=>alert(state,env,'media-budget','error','画像保存の既存予算へ日次容量を反映できませんでした。前回値を保持します。'));
  const valid=state.egress&&Date.parse(state.egress.periodStart)<=now()&&Date.parse(state.egress.periodEnd)>now();
  state.raw.egress={checkedAt:new Date(now()).toISOString(),lastSuccessAt:state.egress?.confirmedAt||null,failures:0,error:valid?null:'Dashboardの対象期間の確認値が必要です（自動取得しません）'};
  state.overhead=measured.stats;
  state.lastTick=new Date(now()).toISOString();
  const snap=await persist(state,env);
  const row={at:snap.generatedAt,storageBytes:snap.metrics.find(m=>m.id==='supabase-storage').used,databaseBytes:snap.metrics.find(m=>m.id==='supabase-database').used,r2Bytes:snap.metrics.find(m=>m.id==='r2-storage').used};
  const object=await env.OPS_DATA.get('history.json');
  const history=object?await object.json():{daily:[]};
  const daily=[...(Array.isArray(history.daily)?history.daily:[]).filter(r=>Date.parse(r.at)>=now()-90*DAY&&jstDay(Date.parse(r.at))!==day),row].sort((a,b)=>a.at.localeCompare(b.at)).slice(-90);
  // One small index, one GET to view history. Never write 15-minute snapshots.
  await put(env.OPS_DATA,'history.json',{daily,recent:[]});
  return snap;
}
