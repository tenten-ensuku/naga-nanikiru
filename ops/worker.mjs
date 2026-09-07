import {createAccessVerifier} from './access.mjs';
import {buildMetrics,evaluate,severity,parseEgress,DAY,HOUR} from './policy.mjs';
import {monitor,inventory,cloudflareUsage,pruneSnapshots} from './collect.mjs';
import {collectDaily,dailyCollection} from './daily.mjs';
const LABELS={minkiru:'みん切るDB・Storage',ranking:'ランキングDB・Storage',r2:'R2日次台帳',cloudflare:'Cloudflare利用回数',egress:'Supabase Egress確認値'};
const safeError=e=>e.message==='analytics_token_missing'?'Cloudflare利用回数の読み取り権限は設定待ちです（容量集計は継続）':/^monitor_http_\d+$/.test(e.message)?e.message:'取得できませんでした（秘密情報は記録しません）';
const jsonHeaders={'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:jsonHeaders});
async function read(bucket,key){const object=await bucket.get(key);return {object,value:object?await object.json():null};}
async function rawPut(bucket,key,value,options={}){return bucket.put(key,JSON.stringify(value),{httpMetadata:{contentType:'application/json',cacheControl:'private, no-store'},...options});}
export function initialState(now){return {version:1,startedAt:new Date(now).toISOString(),observeUntil:new Date(now+DAY).toISOString(),successfulTicks:0,enforcementApproved:false,raw:{},events:[],alerts:{},blocked:false,blockReasons:[]};}
function sources(state,now){
  return Object.entries(LABELS).map(([id,label])=>{
    const r=state.raw[id],ttl=state.readOnly?(id==='egress'?7*DAY:48*HOUR):id==='r2'?26*HOUR:id==='egress'?DAY:id==='cloudflare'?HOUR:2*HOUR;
    const age=now-Date.parse(r?.lastSuccessAt||0);
    const changedPeriod=id==='cloudflare'&&r?.value?.day!==new Date(now).toISOString().slice(0,10);
    return{id,label,status:!r?.lastSuccessAt?'unknown':r.failures||age>ttl||changedPeriod?'stale':'ok',checkedAt:r?.checkedAt||null,lastSuccessAt:r?.lastSuccessAt||null,failures:r?.failures||0,error:r?.error||null};
  });
}
export function snapshot(state,now){
  const metrics=buildMetrics(state.raw,state.egress,now,state.readOnly),ss=sources(state,now);
  const control=evaluate(state,metrics,ss,now),audit=state.raw.minkiru?.value?.tables?.find(x=>x.name==='question_audit_events'),questions=state.raw.minkiru?.value?.tables?.find(x=>x.name==='questions');
  return {version:1,generatedAt:state.generatedAt||state.startedAt,control,sources:ss,metrics,events:state.events.slice(-100).reverse(),
    ...(state.readOnly?{collection:dailyCollection,overhead:state.overhead||null}:{}),
    billing:state.egress?{storageAverageBytes:state.egress.storageAverageBytes??null,periodStart:state.egress.periodStart,periodEnd:state.egress.periodEnd,confirmedAt:state.egress.confirmedAt}:null,
    candidates:[{label:'Supabaseに残る画像原本',bytes:metrics[0].used,count:metrics[0].parts.reduce((s,p)=>s+(p.count||0),0),status:'R2実表示・独立原本・現行参照の再照合が必要',advice:'削除はこの画面から実行できません。現在参照・R2照合・独立バックアップが揃った固定対象だけ別途確認します。'},
      {label:'問題変更監査ログ',bytes:audit?.bytes??null,count:audit?.count??null,status:'最大のDB削減検討候補',advice:'内容が同じ更新の記録抑制と、古い詳細の非公開R2保管を検討。回答履歴や監査記録を一括削除しません。'},
      {label:'R2旧画像・分類外画像',bytes:state.raw.r2?.value?.oldBytes??null,count:state.raw.r2?.value?.oldCount??null,status:'現行参照の検出結果。削除可能とは限りません',advice:'ハッシュ重複と移行証跡・バックアップを再照合。DBへの画像埋め込みも別途点検します。'}],
    growth:{questionCount:questions?.count??null,questionBytes:questions?.bytes??null,imageBytes:state.raw.r2?.value?.activeBytes??null,note:'現時点の平均からの推計。監査ログ・利用者増加・再取込による変動は別です。'}};
}
export function createOpsWorker({fetchImpl=fetch,now=()=>Date.now(),verify=createAccessVerifier(fetchImpl,now),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  const writtenAt=new Map();
  async function put(bucket,key,value,options={}){
    // R2 allows one write/second to the same key. In-flight requests are also serialized by the lease.
    const wait=1100-(Date.now()-(writtenAt.get(key)||0));if(wait>0)await pause(wait);
    const result=await rawPut(bucket,key,value,options);writtenAt.set(key,Date.now());return result;
  }
  async function lease(env,task){
    const {object,value}=await read(env.OPS_DATA,'locks/control.json');
    if(value&&value.until>now())throw new Error('busy');
    const lock=await put(env.OPS_DATA,'locks/control.json',{until:now()+180000},{onlyIf:object?{etagMatches:object.etag}:{etagDoesNotMatch:'*'}});
    if(!lock)throw new Error('busy');
    try{return await task();}finally{await put(env.OPS_DATA,'locks/control.json',{until:0},{onlyIf:{etagMatches:lock.etag}});}
  }
  async function collect(state,id,task){
    const prior=state.raw[id]||{};const checkedAt=new Date(now()).toISOString();
    try {const value=await task();state.raw[id]={value,checkedAt,lastSuccessAt:checkedAt,failures:0,error:null};}
    catch(e){state.raw[id]={...prior,checkedAt,failures:(prior.failures||0)+1,error:safeError(e)};}
  }
  async function dm(env,message){
    const ownerId=env.OPS_OWNER_DISCORD_ID||env.OWNER_DISCORD_ID;
    if(!env.DISCORD_BOT_TOKEN||!/^\d{17,20}$/.test(ownerId||''))throw new Error('dm_not_configured');
    const call=async(path,body)=>{
      const r=await fetchImpl('https://discord.com/api/v10'+path,{method:'POST',headers:{Authorization:'Bot '+env.DISCORD_BOT_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
      if(!r.ok)throw new Error('dm_unavailable');return r.json();
    };
    const channel=await call('/users/@me/channels',{recipient_id:ownerId});
    if(!/^\d{17,20}$/.test(channel.id||''))throw new Error('dm_invalid_channel');
    await call('/channels/'+channel.id+'/messages',{content:message,allowed_mentions:{parse:[]}});
  }
  async function alert(state,env,key,level,message){
    const prior=state.alerts[key],at=new Date(now()).toISOString();
    const sending=key==='setup'||env.NOTIFICATIONS_ENABLED==='true';
    if(prior&&prior.level===level&&now()-Date.parse(prior.at)<DAY&&(!sending||prior.delivery!=='not-requested'))return;
    state.alerts[key]={level,at,delivery:sending?'pending':'not-requested'};
    const event={at,level,message,delivery:'pending'};state.events.push(event);state.events=state.events.slice(-300);
    // Persist claim before POST to avoid duplicate DMs when a runtime is interrupted.
    await put(env.OPS_DATA,'state.json',state);
    if(sending){try{await dm(env,'【エンスク容量管理】\n'+message+'\nhttps://ensuku-ops.naga-study.workers.dev/');event.delivery='sent';}catch{event.delivery='failed';}}
    else event.delivery='not-requested';
    state.alerts[key].delivery=event.delivery;
  }
  async function persist(state,env){
    state.generatedAt=new Date(now()).toISOString();const snap=snapshot(state,now());
    await put(env.OPS_DATA,'state.json',state);await put(env.OPS_DATA,'latest.json',snap);
    return snap;
  }
  async function applyControl(state,env,snap){
    const value={armed:snap.control.mode!=='observe',blocked:snap.control.blocked,reason:snap.control.reasons.join(' / ').slice(0,500),checkedAt:new Date(now()).toISOString()};
    let confirmed=true;
    for(const project of ['minkiru','ranking']){
      try {await monitor(env,project,'control',value,fetchImpl);}
      catch{confirmed=false;await alert(state,env,'control-'+project,'error',LABELS[project]+'への追加処理制限の反映を確認できません。');}
    }
    return confirmed;
  }
  async function tick(env){
    if(env.COLLECTOR_ENABLED!=='true')return;
    return lease(env,async()=>{
      const state=(await read(env.OPS_DATA,'state.json')).value||initialState(now());
      if(!state.egress&&!state.initialConfirmationRead){
        const initial=(await read(env.OPS_DATA,'initial-egress.json')).value;
        if(initial){try{state.egress=parseEgress(initial,now());}catch{/* Expired confirmation is unknown, never treated as zero. */}}
        state.initialConfirmationRead=true;
      }
      if(env.READ_ONLY_MODE==='true')return collectDaily(state,env,{now,fetchImpl,put,collect,alert,persist});
      if(state.lastTick&&now()-Date.parse(state.lastTick)<10*60000)return;
      for(const id of ['minkiru','ranking'])if(!state.raw[id]?.checkedAt||now()-Date.parse(state.raw[id].checkedAt)>=55*60000)await collect(state,id,()=>monitor(env,id,'snapshot',undefined,fetchImpl));
      await collect(state,'cloudflare',()=>cloudflareUsage(env,fetchImpl,now()));
      const utc=new Date(now()),day=utc.toISOString().slice(0,10);
      if(!state.raw.r2?.checkedAt||(utc.getUTCHours()===18&&state.r2InventoryDay!==day)){
        await collect(state,'r2',()=>inventory(env,fetchImpl));state.r2InventoryDay=day;
        if(!state.raw.r2.failures)await monitor(env,'minkiru','budget',{bytes:state.raw.r2.value.bytes},fetchImpl).catch(()=>alert(state,env,'media-budget','error','R2実容量と予約予算の同期を確認できません。'));
        await pruneSnapshots(env.OPS_DATA,now());
      }
      const egressValid=state.egress&&Date.parse(state.egress.periodStart)<=now()&&Date.parse(state.egress.periodEnd)>now()&&now()-Date.parse(state.egress.confirmedAt)<DAY;
      state.raw.egress={checkedAt:new Date(now()).toISOString(),lastSuccessAt:state.egress?.confirmedAt||null,failures:egressValid?0:(state.raw.egress?.failures||0)+1,error:egressValid?null:'Dashboardの最新確認値が必要です'};
      const ss=sources(state,now());if(ss.every(s=>s.status==='ok'))state.successfulTicks++;
      state.enforcementApproved=env.ENFORCEMENT_READY==='true'&&state.successfulTicks>=96&&now()>=Date.parse(state.observeUntil);
      let snap=snapshot(state,now());
      if(snap.control.blocked){state.blocked=true;state.blockReasons=snap.control.reasons;}
      for(const metric of snap.metrics){
        const level=severity(metric),prior=state.alerts['metric-'+metric.id];
        if(['notice','warning','critical'].includes(level))await alert(state,env,'metric-'+metric.id,level,metric.label+'：'+(level==='critical'?'危険域':level==='warning'?'警告域':'注意域')+'です。'+(snap.control.mode==='observe'?'現在は観測中で、新しい自動制限はまだ有効ではありません。':''));
        else if(level==='normal'&&prior&&prior.level!=='recovery')await alert(state,env,'metric-'+metric.id,'recovery',metric.label+'は注意域を下回りました。追加処理の解除が必要な場合は管理画面で確認してください。');
      }
      for(const s of ss){
        if(s.failures>=2)await alert(state,env,'source-'+s.id,'error',s.label+'の確認が連続して失敗しています。前回値を保持しています。');
        else if(s.status==='ok'&&state.alerts['source-'+s.id]?.level==='error')await alert(state,env,'source-'+s.id,'recovery',s.label+'の取得が復旧しました。');
      }
      if(env.SEND_SETUP_DM==='true'&&!state.setupDmRequested){state.setupDmRequested=true;await alert(state,env,'setup','notice','容量監視の接続確認です。ダッシュボードv1を準備しました。24時間の観測と必要な設定の確認後に重い追加処理の安全制限を有効化します。');}
      snap=snapshot(state,now());
      if(env.CONTROL_SYNC_ENABLED==='true')await applyControl(state,env,snap);
      state.lastTick=new Date(now()).toISOString();snap=await persist(state,env);
      await put(env.OPS_DATA,'recent/'+snap.generatedAt+'.json',snap);
      await put(env.OPS_DATA,'daily/'+day+'.json',{at:snap.generatedAt,storageBytes:snap.metrics.find(m=>m.id==='supabase-storage').used,databaseBytes:snap.metrics.find(m=>m.id==='supabase-database').used,r2Bytes:snap.metrics.find(m=>m.id==='r2-storage').used});
    });
  }
  async function body(request){if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('JSON形式が必要です');const t=await request.text();if(t.length>4096)throw new Error('入力が大きすぎます');return JSON.parse(t);}
  return {
    tick,
    async fetch(request,env,ctx){
      const url=new URL(request.url);
      if(!await verify(request,env))return new Response('本人専用の容量管理ページです。Cloudflare Accessでログインしてください。',{status:403,headers:{...jsonHeaders,'Content-Type':'text/plain; charset=utf-8'}});
      if(!env.OPS_DATA)return json({error:'管理用ストレージの設定待ちです'},503);
      if(request.method==='GET'&&url.pathname==='/api/latest'){
        const state=(await read(env.OPS_DATA,'state.json')).value;if(!state)return json({error:'初回集計を待っています'},503);
        if(env.READ_ONLY_MODE==='true')state.readOnly=true;
        return json(snapshot(state,now()));
      }
      if(request.method==='GET'&&url.pathname==='/api/history'){
        if(env.READ_ONLY_MODE==='true')return json((await read(env.OPS_DATA,'history.json')).value||{daily:[],recent:[]});
        const page=await env.OPS_DATA.list({prefix:'daily/',limit:100});
        const rows=await Promise.all(page.objects.sort((a,b)=>a.key.localeCompare(b.key)).slice(-30).map(async o=>(await read(env.OPS_DATA,o.key)).value));
        return json({daily:rows.filter(Boolean),recent:[]});
      }
      if(request.method==='POST'&&['/api/egress','/api/resume'].includes(url.pathname)){
        if(env.READ_ONLY_MODE==='true'&&url.pathname==='/api/resume')return json({error:'容量を確認する専用モードです。アプリの停止・再開は操作しません。'},409);
        if(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'同じ管理ページから操作してください'},403);
        try{return await lease(env,async()=>{
          const state=(await read(env.OPS_DATA,'state.json')).value;if(!state)throw new Error('初回集計を待っています');
          if(env.READ_ONLY_MODE==='true')state.readOnly=true;
          const input=await body(request);
          if(url.pathname==='/api/egress'){
            state.egress=parseEgress(input,now());
            state.raw.egress={checkedAt:new Date(now()).toISOString(),lastSuccessAt:state.egress.confirmedAt,failures:0,error:null};
          }
          else{
            const snap=snapshot(state,now());
            if(env.CONTROL_SYNC_ENABLED!=='true'||input.confirm!==true||!snap.control.canResume)throw new Error('最新値・容量・観測期間を確認できるまで再開できません');
            state.blocked=false;state.blockReasons=[];
            const confirmed=await applyControl(state,env,snapshot(state,now()));
            if(!confirmed){
              state.blocked=true;state.blockReasons=['再開を全DBへ反映できませんでした。制限を維持して再確認が必要です'];
              await applyControl(state,env,snapshot(state,now()));await persist(state,env);
              throw new Error('再開の反映を確認できませんでした。制限を維持しています');
            }
          }
          await persist(state,env);
          return json({ok:true});
        });}catch(e){return json({error:e.message==='busy'?'集計中です。少し待ってから操作してください':e.message},409);}
      }
      if(request.method!=='GET'||url.pathname.startsWith('/api/'))return json({error:'Not found'},404);
      if(!['/','/index.html','/style.css','/dashboard.js'].includes(url.pathname))return json({error:'Not found'},404);
      const response=await env.ASSETS.fetch(request);const headers=new Headers(response.headers);
      for(const [k,v]of Object.entries(jsonHeaders))if(k!=='Content-Type')headers.set(k,v);
      headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
      return new Response(response.body,{status:response.status,headers});
    },
    scheduled(_event,env,ctx){ctx.waitUntil(tick(env).catch(e=>{console.error(JSON.stringify({event:'ops_tick_failed',code:e.message==='busy'?'busy':'unavailable'}));}));}
  };
}
const worker=createOpsWorker();
export default worker;
