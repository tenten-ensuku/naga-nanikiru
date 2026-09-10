// A small compatibility transport for the existing study UI. No Supabase SDK,
// browser bearer tokens, cross-site cookies, or periodic background requests.
export function createCloudflareClient({fetchImpl=globalThis.fetch,location=globalThis.location,document=globalThis.document,now=Date.now}={}) {
  const listeners=new Set();
  let session=null,checkedAt=0,pending=null;
  const errorResult=(message,status=0,code='request_failed')=>({data:null,error:{message,status,code}});
  const csrf=()=>String(document?.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-minkiru_csrf='))?.slice('__Host-minkiru_csrf='.length)||'';
  function emit(event,value){session=value;for(const fn of listeners)fn(event,value);}
  async function request(path,body) {
    try {
      const options={method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}};
      if(body!==undefined){options.headers['Content-Type']='application/json';options.headers['X-Minkiru-CSRF']=csrf();options.body=JSON.stringify(body);}
      const response=await fetchImpl(path,options);
      const json=await response.json();
      if(!response.ok){
        if(response.status===401){checkedAt=now();emit('SIGNED_OUT',null);}
        return errorResult(json.message||'通信に失敗しました。入力内容を保持してから再度お試しください。',response.status,json.error||'request_failed');
      }
      return {data:json,error:null};
    } catch {return errorResult('通信できませんでした。接続を確認してください。');}
  }
  function query(path,initial={}) {
    const args={...initial};let kind='many',result;
    const builder={
      select(columns='*'){args.columns=columns;return builder;},
      eq(key,value){if(!['user_id','status'].includes(key))throw Error('unsupported_filter');args[key]=value;return builder;},
      in(key,values){if(key!=='legacy_key')throw Error('unsupported_filter');args.legacyKeys=values;return builder;},
      order(key,options={}){args.order={key,ascending:options.ascending===true};return builder;},
      limit(value){args.limit=value;return builder;},
      upsert(rows,options={}){args.operation='upsert';args.rows=rows;args.onConflict=options.onConflict;return builder;},
      single(){kind='single';return builder;},
      maybeSingle(){kind='maybe';return builder;},
      then(resolve,reject){
        result??=request(path,args).then(out=>{
          if(out.error)return out;
          let data=out.data.data;
          if(kind!=='many'&&Array.isArray(data)){
            if(data.length>1||(kind==='single'&&data.length!==1))return errorResult('取得したデータの件数が一致しません。',406,'cardinality_mismatch');
            data=data[0]??null;
          }
          return {data,error:null};
        });
        return result.then(resolve,reject);
      },
    };
    return builder;
  }
  async function getSession({force=false}={}) {
    if(checkedAt&&!force&&now()-checkedAt<60000)return {data:{session},error:null};
    if(pending)return pending;
    pending=(async()=>{
      const result=await request('/api/session');
      if(result.error)return {data:{session:null},error:result.error};
      const previous=session?.user?.id;session=result.data.session??null;checkedAt=now();
      if(previous!==session?.user?.id)emit(session?'SIGNED_IN':'SIGNED_OUT',session);
      return {data:{session},error:null};
    })().finally(()=>{pending=null;});
    return pending;
  }
  return {
    rpc:(name,args={})=>query('/api/rpc/'+encodeURIComponent(name),args),
    from:name=>query('/api/table/'+encodeURIComponent(name)),
    functions:{invoke:async()=>errorResult('問題生成は移行確認中です。学習・回答保存はご利用いただけます。',503,'heavy_operations_paused')},
    auth:{getSession,stopAutoRefresh(){},
      onAuthStateChange(fn){listeners.add(fn);return {data:{subscription:{unsubscribe:()=>listeners.delete(fn)}}};},
      async signInWithOAuth({provider,options={}}){
        if(provider!=='discord')return errorResult('Discordログインをご利用ください。');
        const target=new URL(options.redirectTo||location.href,location.href);
        const returnTo=target.origin===location.origin?target.pathname+target.search:'/';
        location.assign('/auth/discord?returnTo='+encodeURIComponent(returnTo));
        return {data:null,error:null};
      },
      async signOut(){const out=await request('/api/logout',{});if(!out.error){checkedAt=now();emit('SIGNED_OUT',null);}return out;},
    },
  };
}
