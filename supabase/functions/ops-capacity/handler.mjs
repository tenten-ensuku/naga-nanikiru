// Narrow server-to-server aggregate adapter. No service key ever leaves this function.
export function createMonitorHandler({digest,baseUrl,serviceKey,fetchImpl=fetch}) {
  return async request=>{
    const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    const token=request.headers.get('x-ops-monitor-token');
    if(request.method!=='POST'||!/^[a-f0-9]{64}$/.test(token||'')||!/^[a-f0-9]{64}$/.test(digest||''))return json({error:'Forbidden'},403);
    const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,'0')).join('');
    let mismatch=0;for(let i=0;i<64;i++)mismatch|=actual.charCodeAt(i)^digest.charCodeAt(i);
    if(mismatch)return json({error:'Forbidden'},403);
    if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(baseUrl||'')||!serviceKey)return json({error:'Configuration unavailable'},503);
    let input;
    try {
      const reader=request.body?.getReader(),decoder=new TextDecoder();let bytes=0,text='';if(reader){while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.byteLength;if(bytes>4096){await reader.cancel();return json({error:'Too large'},413);}text+=decoder.decode(r.value,{stream:true});}text+=decoder.decode();}
      input=JSON.parse(text);
    }catch{return json({error:'Invalid request'},400);}
    const routes={snapshot:'ops_capacity_snapshot',references:'ops_media_references',control:'ops_set_capacity_control',budget:'media_usage_snapshot'};
    const route=Object.hasOwn(routes,input?.action)?routes[input.action]:null;if(!route)return json({error:'Unknown action'},400);
    let body={};
    if(input.action==='control'){
      const p=input.value;
      if(typeof p?.armed!=='boolean'||typeof p?.blocked!=='boolean'||typeof p.reason!=='string'||p.reason.length>500||!Number.isFinite(Date.parse(p.checkedAt)))return json({error:'Invalid control'},400);
      body={p_armed:p.armed,p_blocked:p.blocked,p_reason:p.reason,p_checked_at:p.checkedAt};
    }
    if(input.action==='budget'){
      const b=input.value?.bytes;
      if(!Number.isSafeInteger(b)||b<0||b>1e12)return json({error:'Invalid budget'},400);
      body={p_actual_r2_bytes:b,p_inventory_error:null};
    }
    try{
      const response=await fetchImpl(baseUrl+'/rest/v1/rpc/'+route,{method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
      if(!response.ok)return json({error:'Aggregate service unavailable',upstreamStatus:response.status},response.status===402?402:503);
      const data=await response.text();return new Response(data||'null',{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    }catch{return json({error:'Aggregate service unavailable'},503);}
  };
}
