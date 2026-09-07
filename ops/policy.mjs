export const DAY=86400000, HOUR=3600000;
export const APPS={minkiru:'みん切る',ensuku:'エンスクドリル',iishanten:'一向聴受け入れ',isolated:'孤立牌比較',zundamon:'ずんだもん',common:'共通・未分類'};
export function parts(rows=[]) {
  return Object.entries(APPS).map(([appId,label])=>({appId,label,bytes:rows.filter(x=>x.appId===appId).reduce((n,x)=>n+x.bytes,0),count:rows.filter(x=>x.appId===appId).reduce((n,x)=>n+(x.count||0),0)}));
}
export function parseEgress(input,now=Date.now()) {
  const {periodStart,periodEnd,confirmedAt,uncachedBytes,cachedBytes}=input||{};
  const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
  if(!date(periodStart)||!date(periodEnd)||Date.parse(periodEnd)<=Date.parse(periodStart)||Date.parse(periodEnd)-Date.parse(periodStart)>32*DAY||Date.parse(periodStart)>now||Date.parse(periodEnd)<=now||!Number.isFinite(Date.parse(confirmedAt))||Math.abs(now-Date.parse(confirmedAt))>DAY||![uncachedBytes,cachedBytes].every(x=>Number.isSafeInteger(x)&&x>=0&&x<=1e13))throw new Error('対象期間・確認日時・2種類の通信量を確認してください。');
  if(input.storageAverageBytes!==undefined&&(!Number.isSafeInteger(input.storageAverageBytes)||input.storageAverageBytes<0||input.storageAverageBytes>1e13))throw new Error('期間平均容量を確認してください');
  return {periodStart,periodEnd,confirmedAt,uncachedBytes,cachedBytes,...(input.storageAverageBytes===undefined?{}:{storageAverageBytes:input.storageAverageBytes})};
}
export function severity(metric) {
  if(metric.used===null||!Number.isFinite(metric.used))return 'unknown';
  if(metric.id==='r2-storage')return metric.used>=8e9?'critical':metric.used>=7e9?'warning':'normal';
  if(!metric.limit)return 'normal';
  const ratio=metric.used/metric.limit;
  return ratio>=.9?'critical':ratio>=.75?'warning':ratio>=.5?'notice':'normal';
}
export function evaluate(state,metrics,sources,now=Date.now()) {
  const reasons=metrics.filter(m=>severity(m)==='critical').map(m=>m.label+'が安全上限に接近しています');
  for(const s of sources)if(now-Date.parse(s.lastSuccessAt||state.startedAt)>=DAY)reasons.push(s.label+'を24時間確認できません');
  const observing=now<Date.parse(state.observeUntil)||state.enforcementApproved!==true;
  const blocked=!observing&&(Boolean(state.blocked)||reasons.length>0);
  const allCurrent=sources.length>0&&sources.every(s=>s.status==='ok')&&metrics.every(m=>m.used!==null&&m.status!=='unknown'&&m.status!=='stale');
  const safe=allCurrent&&metrics.every(m=>m.id==='r2-storage'?m.used<7e9:!m.limit||m.used/m.limit<.75);
  return {mode:observing?'observe':blocked?'blocked':'armed',observeUntil:state.observeUntil,blocked,reasons:blocked?(reasons.length?reasons:state.blockReasons||['本人による再開確認を待っています']):reasons,canResume:!observing&&blocked&&safe};
}
export function buildMetrics(raw,egress,now=Date.now()) {
  const metrics=[], tableRows=[]; let databaseBytes=0, storageBytes=0, databaseKnown=true, storageKnown=true;
  for(const [id,label] of [['minkiru','みん切るDB'],['ranking','ランキングDB']]) {
    const result=raw[id],data=result?.value;
    const status=!data?'unknown':result.failures||now-Date.parse(result.lastSuccessAt)>2*HOUR?'stale':'ok';
    metrics.push({id:'database-'+id,label,provider:'Supabase',kind:'database',used:data?.databaseBytes??null,limit:5e8,unit:'bytes',status,observedAt:result?.lastSuccessAt||null,source:'pg_database_size（実容量）',note:'1プロジェクトあたりの上限。空き枠は他DBへ融通できません。',parts:[],details:[]});
    if(data) {
      const rows=data.tables||[]; const sum=rows.reduce((s,t)=>s+t.bytes,0);
      tableRows.push(...rows,{appId:'common',bytes:Math.max(0,data.databaseBytes-sum),count:0});
      databaseBytes+=data.databaseBytes;
      const b=(data.storage||[]).reduce((s,b)=>s+b.bytes,0);storageBytes+=b;
      if(data.storage?.some(x=>x.unknown>0))storageKnown=false;
    } else databaseKnown=storageKnown=false;
  }
  const stale=['minkiru','ranking'].some(id=>raw[id]?.failures||now-Date.parse(raw[id]?.lastSuccessAt||0)>2*HOUR);
  const storageRows=[];
  for(const data of [raw.minkiru?.value,raw.ranking?.value])for(const bucket of data?.storage||[])storageRows.push({appId:['naga-question-assets','comment-assets','question-assets','reaction-assets'].includes(bucket.bucket)?'minkiru':'common',bytes:bucket.bytes,count:bucket.count});
  metrics.unshift({id:'supabase-storage',label:'Supabase画像',provider:'Supabase',kind:'storage',used:storageKnown?storageBytes:null,limit:1e9,unit:'bytes',status:storageKnown?(stale?'stale':'ok'):'unknown',observedAt:raw.minkiru?.lastSuccessAt||null,source:'Storageオブジェクトのサイズ合計',note:'現在の実容量です。請求期間の平均容量ではありません。',parts:parts(storageRows),details:[]},
    {id:'supabase-database',label:'Supabase DB',provider:'Supabase',kind:'database',used:databaseKnown?databaseBytes:null,limit:null,unit:'bytes',status:databaseKnown?(stale?'stale':'ok'):'unknown',observedAt:raw.minkiru?.lastSuccessAt||null,source:'2DBの物理サイズ合計',note:'共通・未分類にはシステム・索引等の残差を含みます。残り枠はDBごとに表示します。',parts:parts(tableRows),details:(raw.minkiru?.value?.tables||[]).filter(t=>['questions','answer_attempts','question_audit_events','media_assets'].includes(t.name)).map(t=>({...t,label:{questions:'問題本体',answer_attempts:'回答履歴',question_audit_events:'変更監査ログ',media_assets:'画像台帳'}[t.name]}))});
  const r=raw.r2, rv=r?.value, pending=raw.minkiru?.value?.mediaBudget?.reservedAndReadyBytes;
  const managed=rv?Math.max(rv.bytes,(pending??0)+(raw.minkiru?.value?.mediaBudget?.externalBytes||0)):null;
  metrics.splice(2,0,{id:'r2-storage',label:'R2画像・管理データ',provider:'Cloudflare',kind:'storage',used:managed,limit:1e10,unit:'bytes',status:rv?(r.failures||now-Date.parse(r.lastSuccessAt)>26*HOUR?'stale':'ok'):'unknown',observedAt:r?.lastSuccessAt||null,source:'R2全オブジェクトのメタデータ集計＋未反映予約',note:'7GBで警告、8GBで新規保存停止。無料枠10GBとは別の安全上限です。',parts:rv?parts([{appId:'minkiru',bytes:rv.imageBytes,count:rv.imageCount},{appId:'common',bytes:rv.managementBytes+(managed-rv.bytes),count:rv.managementCount}]):parts(),details:rv?[{label:'使用中画像',bytes:rv.activeBytes,count:rv.activeCount},{label:'旧画像（削除前に要照合）',bytes:rv.oldBytes,count:rv.oldCount},{label:'分類未確認',bytes:rv.unknownBytes,count:rv.unknownCount},{label:'管理用データ',bytes:rv.managementBytes,count:rv.managementCount},{label:'未反映予約・安全余裕',bytes:managed-rv.bytes,count:null}]:[]});
  const cf=raw.cloudflare,values=cf?.value;
  for(const [id,label,limit,field] of [['workers-requests','Workersの本日リクエスト',100000,'workersRequests'],['r2-class-a','R2 Class A・今月',1e6,'classA'],['r2-class-b','R2 Class B・今月',1e7,'classB']]){
    const date=new Date(now).toISOString(),periodMatches=id==='workers-requests'?values?.day===date.slice(0,10):values?.month===date.slice(0,8)+'01';
    metrics.push({id,label,kind:'requests',provider:'Cloudflare',unit:'requests',used:values?.[field]??null,limit,status:!values?'unknown':cf.failures||!periodMatches||now-Date.parse(cf.lastSuccessAt)>HOUR?'stale':'ok',observedAt:cf?.lastSuccessAt||null,source:'Cloudflare GraphQL Analytics',note:'WorkersはUTC日次、R2操作数はUTC暦月。アカウント合計。期間切替の未取得値は前回値として表示。',parts:[],details:[]});
  }
  const valid=egress&&Date.parse(egress.periodStart)<=now&&Date.parse(egress.periodEnd)>now;
  for(const [id,label,field] of [['egress','Supabase通常Egress','uncachedBytes'],['cached-egress','Supabase Cached Egress','cachedBytes']])metrics.push({id,label,provider:'Supabase',kind:'egress',used:valid?egress[field]:null,limit:5e9,unit:'bytes',status:valid?(now-Date.parse(egress.confirmedAt)>DAY?'stale':'manual'):'unknown',observedAt:egress?.confirmedAt||null,source:'本人がDashboardで確認した期間合計',note:valid?egress.periodStart+' ～ '+egress.periodEnd+'（自動取得ではありません）':'確認値未登録／期間外。API回数からの推定はしません。',parts:[],details:[]});
  return metrics;
}
