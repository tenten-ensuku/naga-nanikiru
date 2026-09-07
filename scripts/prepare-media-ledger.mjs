// Local preparation only. SQL is reviewed/executed separately through the management API.
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {validateObject,verifiedForObject} from "./verify-r2-migration.mjs";
const owners={
  "21c0d135-fce8-450d-b6ef-224788713168":"c574d471-7e7e-4d9d-b79f-930fc0bde839",
  "53d3ce97-8eb2-47b7-8c58-c43f378ba806":"3043e7d8-8343-4c0a-994b-f47fa21b9874",
  "88c9cb70-6958-42b6-a433-5518388bc158":"ab32ff86-0184-4a61-9b7e-e64b9a533eb4",
};
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
export function ledgerRows(objects,receipts) {
  const rows=[];
  for(const object of objects) {
    validateObject(object);
    if(!verifiedForObject(object,receipts.get(object.target_key)))continue;
    const cid=object.name.split("/")[0],owner=owners[cid];
    if(object.bucket_id!=="naga-question-assets" || !owner || !Number.isFinite(Date.parse(object.updated_at)))throw new Error("Unverified ownership/date for ledger import");
    rows.push({key:object.target_key,bucket:object.bucket_id,path:object.name,collection_id:cid,owner_id:owner,
      size_bytes:object.size_bytes,sha256:object.sha256,content_type:object.mime_type,source_updated_at:object.updated_at});
  }
  return rows;
}
export function registrationSql(rows) {
  if(!rows.length || rows.length>500)throw new Error("Invalid ledger batch size");
  return `do $ledger$
declare row record; actual_owner uuid; existing public.media_assets;
begin
  for row in select * from jsonb_to_recordset(${quote(JSON.stringify(rows))}::jsonb)
    as x(key text,bucket text,path text,collection_id uuid,owner_id uuid,size_bytes bigint,sha256 text,content_type text,source_updated_at timestamptz)
  loop
    select owner_id into actual_owner from public.collections where id=row.collection_id;
    if actual_owner is distinct from row.owner_id or row.bucket <> 'naga-question-assets'
      or row.key <> row.bucket || '/' || row.path or split_part(row.path,'/',1) <> row.collection_id::text then
      raise exception 'migration ownership changed';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(row.key,230));
    select * into existing from public.media_assets where object_key=row.key for update;
    if found and (existing.owner_id is distinct from row.owner_id or existing.collection_id is distinct from row.collection_id
      or existing.sha256 <> row.sha256 or existing.size_bytes <> row.size_bytes
      or existing.content_type <> row.content_type or existing.state not in ('pending','ready')) then
      raise exception 'migration ledger conflict';
    end if;
    if existing.object_key is null then
      insert into public.media_assets(object_key,bucket,path,owner_id,collection_id,size_bytes,sha256,content_type,state,created_at)
        values(row.key,row.bucket,row.path,row.owner_id,row.collection_id,row.size_bytes,row.sha256,row.content_type,'ready',least(row.source_updated_at,now()));
    end if;
    perform public.complete_media_asset(row.key,row.sha256);
  end loop;
end $ledger$;
select count(*) as ready_objects,coalesce(sum(size_bytes),0) as ready_bytes from public.media_assets where state='ready';`;
}
async function main() {
  const directory=path.resolve("outputs/r2-migration-20260906");
  const {objects}=JSON.parse(await fs.readFile(path.join(directory,"verified-delivery-manifest.json"),"utf8"));
  const text=await fs.readFile(path.join(directory,"r2-verification.jsonl"),"utf8");
  const receipts=new Map(text.split(/\r?\n/).filter(x=>x.trim()).map(x=>{const r=JSON.parse(x);return[r.key,r];}));
  const rows=ledgerRows(objects,receipts);
  const batches=[];
  for(let start=0;start<rows.length;start+=250) {
    const filename="ledger-batch-"+String(1+start/250).padStart(3,"0")+".sql";
    const group=rows.slice(start,start+250);
    await fs.writeFile(path.join(directory,filename),registrationSql(group));
    batches.push({filename,objects:group.length});
  }
  await fs.writeFile(path.join(directory,"ledger-plan.json"),JSON.stringify({generatedAt:new Date().toISOString(),status:"prepared_not_executed",objects:rows.length,bytes:rows.reduce((sum,row)=>sum+row.size_bytes,0),batches},null,2)+"\n");
  console.log(JSON.stringify({prepared:rows.length,batches:batches.length,remoteMutation:false}));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
