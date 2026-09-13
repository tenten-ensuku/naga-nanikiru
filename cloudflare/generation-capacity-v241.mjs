import {ApiError} from './access.mjs';
export const nowIso=()=>new Date().toISOString();
export async function requireGenerationCapacity(env){
  const control=await env.DB.prepare('SELECT armed,blocked,checked_at FROM private_ops_capacity_control WHERE singleton=1').first();
  if(control?.armed&&(control.blocked||!Number.isFinite(Date.parse(control.checked_at))||Date.now()-Date.parse(control.checked_at)>86400000))throw new ApiError('heavy_operations_paused',503);
  let budget=await env.DB.prepare('SELECT * FROM private_media_budget WHERE singleton=1').first();
  if(budget&&env.IMAGES&&env.ARCHIVES&&(!Number.isFinite(Date.parse(budget.inventory_checked_at))||Date.now()-Date.parse(budget.inventory_checked_at)>86400000)){
    await reconcileMediaBudget(env);
    budget=await env.DB.prepare('SELECT * FROM private_media_budget WHERE singleton=1').first();
  }
  if(!budget||budget.inventory_error||!Number.isFinite(Date.parse(budget.inventory_checked_at))||Date.now()-Date.parse(budget.inventory_checked_at)>172800000)throw new ApiError('media_capacity_unavailable',503);
  if(budget.used_bytes+budget.external_bytes>=budget.limit_bytes)throw new ApiError('media_storage_limit',507);
}
export async function reserveUsage(db,kind,subject,amount,limit){
  if(!Number.isSafeInteger(amount)||amount<1||!Number.isSafeInteger(limit)||amount>limit)throw new ApiError('generation_daily_limit',429);
  const day=nowIso().slice(0,10);
  const row=await db.prepare(`INSERT INTO private_generation_usage(day,kind,subject,used) VALUES(?,?,?,?)
    ON CONFLICT(day,kind,subject) DO UPDATE SET used=used+excluded.used WHERE used+excluded.used<=? RETURNING used`)
    .bind(day,kind,subject,amount,limit).first();
  if(!row)throw new ApiError('generation_daily_limit',429);
  return day;
}
// Small metadata-only daily reconciliation. Include archive/cache files; count
// pending reservations even when a corresponding upload never finished.
export async function reconcileMediaBudget(env){
  let imageBytes=0,archiveBytes=0,pendingMissing=0;
  const pending=(await env.DB.prepare("SELECT object_key,size_bytes FROM media_assets WHERE state='pending'").all()).results||[];
  const pendingKeys=new Map(pending.map(x=>[x.object_key,x.size_bytes]));
  try{
    for(const [kind,bucket] of [['images',env.IMAGES],['archives',env.ARCHIVES]]){
      if(!bucket)throw Error('missing_bucket');
      let cursor,pages=0;
      do{
        const page=await bucket.list({limit:1000,cursor});
        for(const object of page.objects){
          if(!Number.isSafeInteger(object.size)||object.size<0)throw Error('bad_inventory');
          if(kind==='images'){imageBytes+=object.size;pendingKeys.delete(object.key);}else archiveBytes+=object.size;
        }
        if(++pages>100)throw Error('inventory_limit');
        cursor=page.truncated?page.cursor:undefined;if(page.truncated&&!cursor)throw Error('inventory_cursor');
      }while(cursor);
    }
    for(const size of pendingKeys.values())pendingMissing+=size;
    // Never decrease the running reservation counter during online inventory:
    // an upload may complete between pages. Conservative drift is safe.
    await env.DB.prepare(`UPDATE private_media_budget SET used_bytes=MAX(used_bytes,?),external_bytes=MAX(external_bytes,?),inventory_checked_at=?,inventory_error=NULL WHERE singleton=1`)
      .bind(imageBytes+pendingMissing,archiveBytes,nowIso()).run();
    return {imageBytes,archiveBytes,pendingMissing};
  }catch(error){
    await env.DB.prepare("UPDATE private_media_budget SET inventory_error='metadata_inventory_failed' WHERE singleton=1").run();
    throw new ApiError('media_capacity_unavailable',503);
  }
}
