import {ApiError,requireActor} from './access.mjs';
import {boundedBytes} from './media-write-v241.mjs';
import {imageType} from '../worker/media.mjs';
import {captureNaga} from './naga-capture-v241.mjs';
import {requireGenerationCapacity,reserveUsage,nowIso} from './generation-capacity-v241.mjs';
const reportPattern=/^[A-Za-z0-9_]{20,160}$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const integer=(v,max)=>typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<=max;
export function createGenerationApi({fetchImpl=fetch,captureImpl=captureNaga,cache=null}={}){
  return async function generation(name,input,env,actor){
    requireActor(actor);if(env.GENERATION_ENABLED!=='true')throw new ApiError('heavy_operations_paused',503);
    await requireGenerationCapacity(env);
    if(!reportPattern.test(input?.reportId||''))throw new ApiError('report_id_invalid',400);
    if(name==='naga-report'){
      const seat=input.targetPlayerSeat??null;if(seat!==null&&!integer(seat,3))throw new ApiError('scene_invalid',400);
      await reserveUsage(env.DB,'reports','all',1,150);
      const reportId=input.reportId,url='https://naga.dmv.nico/reports/'+reportId+'.json';
      const id=crypto.randomUUID(),started=nowIso();
      await env.DB.prepare(`INSERT INTO generation_jobs(id,requested_by,source_kind,source_url,source_report_id,target_player_seat,status,started_at) VALUES(?,?,?,?,?,?,'running',?)`)
        .bind(id,actor.id,input.sourceKind==='naga_scene'?'naga_scene':'naga_match','https://naga.dmv.nico/htmls/report_viewer.html?report_id='+reportId,reportId,seat,started).run();
      let stage='cache_read',upstreamStatus=null;
      try{
        const cacheKey=new Request(env.APP_ORIGIN+'/__naga_report_cache/'+reportId);
        let upstream=null;
        if(cache)try{upstream=await cache.match(cacheKey);}catch{}
        const cached=!!upstream;
        stage='fetch';upstream||=await fetchImpl(url,{headers:{Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(25000)});
        upstreamStatus=upstream.status;
        if(!upstream.ok)throw new ApiError(upstream.status===404?'naga_report_missing':'naga_report_unavailable',upstream.status===404?404:upstream.status===429?429:502);
        stage='body';const bytes=await boundedBytes(upstream,32*1024*1024);
        if(bytes.length<2)throw new ApiError('naga_report_invalid',502);
        // Keep the large report outside D1. Browser parses it with the existing
        // generator; the Worker avoids a large JSON.parse under Free CPU limits.
        // Cache is an optional optimization, never a condition for creation.
        if(cache&&!cached)try{await cache.put(cacheKey,new Response(bytes,{headers:{'Content-Type':'application/json','Cache-Control':'max-age=3600'}}));}catch{}
        stage='complete';
        await env.DB.prepare("UPDATE generation_jobs SET status='completed',completed_at=? WHERE id=?").bind(nowIso(),id).run();
        return new Response(new Blob(['{"jobId":'+JSON.stringify(id)+',"report":',bytes,'}']),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
      }catch(error){const code=error instanceof ApiError?error.code:'naga_report_unavailable';const detail=String(error.message||'').replace(/https?:\/\/\S+/g,'[url]').slice(0,200);await env.DB.prepare("UPDATE generation_jobs SET status='failed',completed_at=?,error_message=? WHERE id=?").bind(nowIso(),[code,stage,upstreamStatus||'',error.name||'Error',detail].join(':'),id).run();throw error instanceof ApiError?error:new ApiError('naga_report_unavailable',502);}
    }
    if(name==='naga-capture'){
      if(!env.BROWSER)throw new ApiError('capture_not_configured',503);
      if(!uuid.test(input.jobId||'')||!integer(input.tw,3)||!integer(input.ts,999)||!integer(input.tv,9999))throw new ApiError('scene_invalid',400);
      const job=await env.DB.prepare("SELECT id FROM generation_jobs WHERE id=? AND requested_by=? AND source_report_id=? AND status='completed'").bind(input.jobId,actor.id,input.reportId).first();
      if(!job)throw new ApiError('generation_job_not_owned',403);
      // Reserve a full minute before opening the browser, so parallel captures
      // cannot all assume the same remaining time. Interrupted reservations stay.
      const day=await reserveUsage(env.DB,'capture_seconds','all',60,480),started=Date.now();
      try{
        const url=new URL('https://naga.dmv.nico/htmls/report_viewer.html');
        for(const [key,value] of Object.entries({report_id:input.reportId,tw:input.tw,ts:input.ts,tv:input.tv}))url.searchParams.set(key,String(value));
        const bytes=await captureImpl(env,url.href),type=imageType(bytes);
        if(!['image/webp','image/png','image/jpeg'].includes(type)||bytes.length>8*1024*1024)throw new ApiError('capture_image_invalid',502);
        return new Response(bytes,{headers:{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
      }catch(error){throw error instanceof ApiError?error:new ApiError(/429|limit/i.test(String(error.message))?'capture_daily_limit':'capture_failed',/429|limit/i.test(String(error.message))?429:502);}
      finally{const elapsed=Math.min(60,Math.max(2,Math.ceil((Date.now()-started)/1000)+2));await env.DB.prepare("UPDATE private_generation_usage SET used=MAX(0,used-60+?) WHERE day=? AND kind='capture_seconds' AND subject='all'").bind(elapsed,day).run();}
    }
    throw new ApiError('function_not_allowed',403);
  };
}
