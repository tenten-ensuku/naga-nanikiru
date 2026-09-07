// Verifies destination bytes only. No upload, DB mutation, or source deletion.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { APPROVED_MEDIA_API_ORIGIN } from "./write-runtime-config.mjs";
import { imageType, validKey } from "../worker/media.mjs";

const digest = (value, algorithm = "sha256") => createHash(algorithm).update(value).digest("hex");
const publicBuckets = new Set(["naga-question-assets","comment-assets","reaction-assets"]);

export function validateObject(object) {
  if (!object || !publicBuckets.has(object.bucket_id) ||
      !validKey(object.target_key) || object.target_key !== object.bucket_id + "/" + object.name ||
      !Number.isSafeInteger(object.size_bytes) || object.size_bytes < 1 || object.size_bytes > 10485760 ||
      !/^[a-f0-9]{64}$/.test(object.sha256) || !/^[a-f0-9]{32}$/.test(object.md5) ||
      !["image/png","image/jpeg","image/webp","image/gif"].includes(object.mime_type)) {
    throw new Error("Invalid migration object; private images require a separate authorized verifier.");
  }
}

export async function verifyDestination(object, fetchImpl = fetch, {allowContentTypeRepair = false} = {}) {
  validateObject(object);
  const url = APPROVED_MEDIA_API_ORIGIN + "/v1/public/" + object.target_key.split("/").map(encodeURIComponent).join("/");
  const response = await fetchImpl(url, {cache:"no-store",headers:{"Cache-Control":"no-cache"},redirect:"error",signal:AbortSignal.timeout(45000)});
  if (!response.ok || !response.body) {
    const error = new Error("R2 verification returned HTTP " + response.status);
    error.status = response.status;
    throw error;
  }
  const mime = response.headers.get("content-type")?.split(";")[0];
  if (mime !== object.mime_type && !allowContentTypeRepair) { await response.body.cancel(); throw new Error("R2 content type mismatch: " + object.target_key); }
  const length = response.headers.get("content-length");
  if (length && Number(length) !== object.size_bytes) { await response.body.cancel(); throw new Error("R2 size mismatch"); }
  const sha = createHash("sha256"), md5 = createHash("md5");
  let bytes = 0, prefix = Buffer.alloc(0);
  const reader = response.body.getReader();
  try {
    while (true) {
      const {value,done} = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > object.size_bytes) { await reader.cancel(); throw new Error("R2 size mismatch"); }
      if (prefix.length < 12) prefix = Buffer.concat([prefix,Buffer.from(value).subarray(0,12-prefix.length)]);
      sha.update(value); md5.update(value);
    }
  } finally { reader.releaseLock(); }
  const sha256 = sha.digest("hex"), contentMd5 = md5.digest("hex");
  if (bytes !== object.size_bytes || sha256 !== object.sha256 || contentMd5 !== object.md5 ||
      imageType(prefix) !== object.mime_type) throw new Error("R2 byte/hash/signature mismatch: " + object.target_key);
  return {key:object.target_key,size_bytes:bytes,sha256,md5:contentMd5,content_type:mime,
    origin:APPROVED_MEDIA_API_ORIGIN,status:mime === object.mime_type ? "verified" : "content_type_repair_required",verifiedAt:new Date().toISOString()};
}

export function verifiedForObject(object, receipt) {
  return receipt?.status === "verified" && receipt.origin === APPROVED_MEDIA_API_ORIGIN &&
    receipt.key === object.target_key && receipt.size_bytes === object.size_bytes &&
    receipt.sha256 === object.sha256 && receipt.md5 === object.md5 &&
    receipt.content_type === object.mime_type && Number.isFinite(Date.parse(receipt.verifiedAt));
}

export function buildDeletionReview(objects, candidates, receipts) {
  const sources = new Map(objects.map(object => { validateObject(object); return [object.target_key,object]; }));
  const ready = [], notReady = [];
  for (const item of candidates) {
    const key = item.bucket + "/" + item.name, object = sources.get(key);
    const sourceMatch = object && item.sizeBytes === object.size_bytes &&
      String(item.eTag || "").replaceAll('"',"") === object.md5;
    const entry = {bucket:item.bucket,name:item.name,sizeBytes:item.sizeBytes,eTag:item.eTag,
      sourceSha256:sourceMatch ? object.sha256 : null};
    if (sourceMatch && verifiedForObject(object,receipts.get(key))) {
      ready.push({...entry,destination:key,destinationReceipt:receipts.get(key),localOriginal:object.backup_path || object.local_path});
    } else notReady.push({...entry,reason:sourceMatch ? "destination_not_verified" : "local_original_not_verified"});
  }
  ready.sort((a,b) => (a.bucket+"/"+a.name).localeCompare(b.bucket+"/"+b.name));
  return {
    generatedAt:new Date().toISOString(),status:"approval_required_not_deleted",
    referenceCheck:"The saved reference snapshot is not a fresh check. Recheck current references and source metadata before deletion.",
    readyCount:ready.length,readyBytes:ready.reduce((sum,x)=>sum+x.sizeBytes,0),
    pendingCount:notReady.length,
    approvalDigest:digest(JSON.stringify(ready.map(x=>[x.bucket,x.name,x.sizeBytes,x.eTag,x.sourceSha256]))),
    ready,pending:notReady,
  };
}

async function readJsonLines(file) {
  try { return (await fs.readFile(file,"utf8")).split(/\r?\n/).filter(x=>x.trim()).map(x=>JSON.parse(x)); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

export async function main(args = process.argv.slice(2)) {
  const directory = path.resolve(args.find(x=>!x.startsWith("--")) || "outputs/r2-migration-20260906");
  let manifestFile = "verified-delivery-manifest.json";
  try { await fs.access(path.join(directory,manifestFile)); } catch(error) { if(error.code!=="ENOENT")throw error; manifestFile="verified-local-manifest.json"; }
  const {objects} = JSON.parse(await fs.readFile(path.join(directory,manifestFile),"utf8"));
  for (const object of objects) validateObject(object);
  try {
    const backup=JSON.parse(await fs.readFile(path.join(directory,"local-backup-manifest.json"),"utf8"));
    if(backup.status!=="local_content_verified")throw new Error("Unverified local backup");
    const records=new Map(backup.records.map(row=>[row.key,row]));
    for(const object of objects) {
      const row=records.get(object.target_key);
      if(!row || row.sha256!==object.sha256 || row.md5!==object.md5 || row.size_bytes!==object.size_bytes ||
        path.resolve(row.backup_path)!==path.join(directory,"local-originals",object.sha256+"."+({"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif"}[object.mime_type])))throw new Error("Local backup manifest mismatch");
      object.backup_path=row.backup_path;
    }
  } catch(error) {if(error.code!=="ENOENT")throw error;}
  const candidates = [];
  const cleanupDirectory = path.resolve(directory,"../supabase-cleanup-v227");
  for (const name of (await fs.readdir(cleanupDirectory)).filter(x=>/^orphan-candidates-.*\.jsonl$/.test(x))) {
    candidates.push(...await readJsonLines(path.join(cleanupDirectory,name)));
  }
  const receiptFile = path.join(directory,"r2-verification.jsonl");
  const receipts = new Map((await readJsonLines(receiptFile)).map(x=>[x.key,x]));
  let writes = Promise.resolve(), failure;
  const saveReceipt = record => {
    receipts.set(record.key,record);
    writes = writes.then(()=>fs.appendFile(receiptFile,JSON.stringify(record)+"\n","utf8"));
    return writes;
  };
  if (args.includes("--verify")) {
    // This opt-in downloads from R2 (never from Supabase). Keep concurrency small.
    const pending = objects.filter(object=>!verifiedForObject(object,receipts.get(object.target_key)));
    let index = 0, complete = 0;
    await Promise.all(Array.from({length:3},async()=>{
      while (!failure && index < pending.length) {
        const object = pending[index++];
        try {
          await saveReceipt(await verifyDestination(object));
          if (++complete % 100 === 0) console.log("R2 verified this run: " + complete);
        } catch (error) {
          failure ||= error;
          await saveReceipt({key:object.target_key,status:"failed",message:error.message,checkedAt:new Date().toISOString()});
        }
      }
    }));
    await writes;
  }
  const review = buildDeletionReview(objects,candidates,receipts);
  await fs.writeFile(path.join(directory,"deletion-review-v230.json"),JSON.stringify(review,null,2)+"\n");
  const csvCell = value => '"'+String(value ?? "").replaceAll('"','""')+'"';
  const csv = [["bucket","path","bytes","source_md5","sha256","r2_key","local_original"],
    ...review.ready.map(row=>[row.bucket,row.name,row.sizeBytes,row.eTag,row.sourceSha256,row.destination,row.localOriginal])]
    .map(row=>row.map(csvCell).join(",")).join("\r\n");
  await fs.writeFile(path.join(directory,"deletion-review-v230.csv"),"\ufeff"+csv+"\r\n");
  const fileLink = filename => path.join(directory,filename).replaceAll("\\","/");
  const markdown = ["# Supabase旧画像・削除承認用一覧 V230","",
    "この一覧は削除命令ではありません。原本はまだ削除していません。","",
    "- 作成日時: "+review.generatedAt,
    "- ローカル原本とR2配信先の内容一致を確認済み: "+review.readyCount+"件 / "+review.readyBytes.toLocaleString("en-US")+" bytes",
    "- 削除対象にできない未確認画像: "+review.pendingCount+"件",
    "- 承認対象ダイジェスト: `"+review.approvalDigest+"`","",
    "[対象ファイル一覧（CSV）](<"+fileLink("deletion-review-v230.csv")+">)",
    "[ハッシュ・照合記録を含む一覧（JSON）](<"+fileLink("deletion-review-v230.json")+">)","",
    "承認後も、削除直前に現在の参照・容量・ETagを再照合します。使われている画像、R2で内容一致を確認できない画像は削除しません。",
    "削除に使うのはSupabase Storage APIです。402の場合は繰り返し実行せず停止します。",
    "削除した場合でも、検証済みR2コピーとローカル原本から復元できる状態を保持します。",""].join("\n");
  await fs.writeFile(path.join(directory,"deletion-review-v230.md"),markdown);
  console.log(JSON.stringify({mode:args.includes("--verify")?"destination_verification":"local_report_only",
    readyForSeparateApproval:review.readyCount,pending:review.pendingCount,noDeletionPerformed:true}));
  if (failure) throw failure;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error=>{ console.error(error.message); process.exitCode=1; });
}
