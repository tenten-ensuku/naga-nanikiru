import {DAY} from './policy.mjs';
export async function monitor(env,project,action,value,fetchImpl=fetch){
  const url=project==='minkiru'?env.MINKIRU_URL:env.RANKING_URL;
  if(!env.OPS_MONITOR_TOKEN||!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url||''))throw new Error('monitor_not_configured');
  const response=await fetchImpl(url+'/functions/v1/ops-capacity',{method:'POST',headers:{'Content-Type':'application/json','x-ops-monitor-token':env.OPS_MONITOR_TOKEN},body:JSON.stringify({action,value}),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error('monitor_http_'+response.status);
  return response.json();
}
export async function inventory(env,fetchImpl=fetch){
  const references=await monitor(env,'minkiru','references',undefined,fetchImpl);
  if(!Array.isArray(references.keys)||references.keys.some(x=>typeof x!=='string'))throw new Error('inventory_reference_shape');
  const known=new Set(references.keys);
  const result={bytes:0,imageBytes:0,imageCount:0,managementBytes:0,managementCount:0,activeBytes:0,activeCount:0,oldBytes:0,oldCount:0,unknownBytes:0,unknownCount:0,referencesAt:references.checkedAt,ledgerBytes:references.ledgerBytes,ledgerCount:references.ledgerCount};
  for(const [name,bucket] of [['images',env.IMAGES],['management',env.OPS_DATA]]){
    let cursor,pages=0;
    do {
      const page=await bucket.list({limit:1000,cursor});
      for(const object of page.objects){
        if(!Number.isSafeInteger(object.size)||object.size<0)throw new Error('invalid_inventory_size');
        result.bytes+=object.size;
        if(name==='management'){result.managementBytes+=object.size;result.managementCount++;continue;}
        result.imageBytes+=object.size;result.imageCount++;
        const type=known.has(object.key)?'active':/^(naga-question-assets|comment-assets|reaction-assets|question-assets)\//.test(object.key)?'old':'unknown';
        result[type+'Bytes']+=object.size;result[type+'Count']++;
      }
      cursor=page.truncated?page.cursor:undefined;
      if(++pages>100||(page.truncated&&!cursor))throw new Error('inventory_page_limit');
    }while(cursor);
  }
  return result;
}
const CLASS_A=new Set(['PutObject','PutBucket','CopyObject','CompleteMultipartUpload','CreateMultipartUpload','ListBuckets','ListObjects','ListObjectsV2','ListMultipartUploads','ListParts','UploadPart','UploadPartCopy','PutBucketLifecycleConfiguration','PutBucketCors','PutBucketEncryption']);
const CLASS_B=new Set(['GetObject','HeadObject','HeadBucket','GetBucketLifecycleConfiguration','GetBucketCors','GetBucketEncryption','UsageSummary','GetObjectAttributes']);
const FREE=new Set(['DeleteObject','DeleteObjects','AbortMultipartUpload','DeleteBucket']);
export async function cloudflareUsage(env,fetchImpl=fetch,now=Date.now()){
  if(!env.CF_ANALYTICS_TOKEN)throw new Error('analytics_token_missing');
  const date=new Date(now).toISOString(),day=date.slice(0,10)+'T00:00:00Z',month=date.slice(0,8)+'01T00:00:00Z';
  const query=`query { viewer { accounts(filter:{accountTag:"${env.CF_ACCOUNT_ID}"}) {
    workersInvocationsAdaptive(limit:1000,filter:{datetime_geq:"${day}",datetime_leq:"${date}"}) { sum { requests } }
    r2OperationsAdaptiveGroups(limit:1000,filter:{datetime_geq:"${month}",datetime_leq:"${date}"}) { sum { requests } dimensions { actionType } }
  } } }`;
  const response=await fetchImpl('https://api.cloudflare.com/client/v4/graphql',{method:'POST',headers:{Authorization:'Bearer '+env.CF_ANALYTICS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(20000)});
  const data=await response.json();if(!response.ok||data.errors?.length)throw new Error('analytics_unavailable');
  const account=data.data?.viewer?.accounts?.[0];
  if(!Array.isArray(account?.workersInvocationsAdaptive)||!Array.isArray(account?.r2OperationsAdaptiveGroups))throw new Error('analytics_shape');
  if(account.workersInvocationsAdaptive.length>=1000||account.r2OperationsAdaptiveGroups.length>=1000)throw new Error('analytics_truncated');
  let workersRequests=0,classA=0,classB=0;
  for(const row of account.workersInvocationsAdaptive)workersRequests+=row.sum.requests;
  for(const row of account.r2OperationsAdaptiveGroups){
    if(CLASS_A.has(row.dimensions.actionType))classA+=row.sum.requests;
    else if(CLASS_B.has(row.dimensions.actionType))classB+=row.sum.requests;
    else if(!FREE.has(row.dimensions.actionType)&&row.sum.requests>0)throw new Error('unclassified_r2_operation');
  }
  if(![workersRequests,classA,classB].every(n=>Number.isFinite(n)&&n>=0))throw new Error('invalid_analytics_count');
  return{workersRequests,classA,classB,day:day.slice(0,10),month:month.slice(0,10)};
}
export async function pruneSnapshots(bucket,now=Date.now()){
  // Only generated management snapshots with exact safe prefixes; never app data or image buckets.
  for(const [prefix,age] of [['recent/',2*DAY],['daily/',90*DAY]]){
    let cursor,pages=0;
    do{
      const page=await bucket.list({prefix,limit:1000,cursor});
      const keys=page.objects.filter(x=>x.key.startsWith(prefix)&&/^\d{4}-\d{2}-\d{2}/.test(x.key.slice(prefix.length))&&x.uploaded.getTime()<now-age).map(x=>x.key);
      for(let i=0;i<keys.length;i+=100)await bucket.delete(keys.slice(i,i+100));
      cursor=page.truncated?page.cursor:undefined;if(++pages>10)throw new Error('retention_page_limit');
    }while(cursor);
  }
}
