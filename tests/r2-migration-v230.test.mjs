import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyDestination,buildDeletionReview,verifiedForObject } from "../scripts/verify-r2-migration.mjs";
const bytes = Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]);
const hash = algorithm=>createHash(algorithm).update(bytes).digest("hex");
const object = {bucket_id:"naga-question-assets",name:"collection/question.png",target_key:"naga-question-assets/collection/question.png",
  size_bytes:bytes.length,mime_type:"image/png",sha256:hash("sha256"),md5:hash("md5"),local_path:"local-original.png"};
const candidate = {bucket:object.bucket_id,name:object.name,sizeBytes:object.size_bytes,eTag:'"'+object.md5+'"'};
const response = body=>new Response(body,{headers:{"Content-Type":"image/png"}});
test("destination verification reads only R2, compares actual bytes, and never changes data",async()=>{
  const receipt = await verifyDestination(object,async(url,options)=>{
    assert.match(url,/^https:\/\/minkiru-media\.naga-study\.workers\.dev\/v1\/public\//);
    assert.equal(options.redirect,"error");
    assert.equal(options.method,undefined);
    return response(bytes);
  });
  assert.equal(verifiedForObject(object,receipt),true);
  const review = buildDeletionReview([object],[candidate],new Map([[object.target_key,receipt]]));
  assert.equal(review.readyCount,1);
  assert.equal(review.status,"approval_required_not_deleted");
  assert.equal(verifiedForObject({...object,sha256:"a".repeat(64)},receipt),false);
});
test("mismatch, missing copy, private scope and misleading metadata are refused",async()=>{
  const damaged = Buffer.from(bytes); damaged[10] = 9;
  await assert.rejects(verifyDestination(object,async()=>response(damaged)),/mismatch/);
  await assert.rejects(verifyDestination(object,async()=>new Response("",{status:402})),/402/);
  await assert.rejects(verifyDestination({...object,target_key:"question-assets/user/private.png"},async()=>assert.fail()),/Invalid/);
  await assert.rejects(verifyDestination(object,async()=>response(Buffer.concat([bytes,bytes]))),/size/);
});
test("source and destination verification are both required in a deletion review",()=>{
  const result = buildDeletionReview([object],[candidate,{...candidate,name:"missing.png"}],new Map());
  assert.equal(result.readyCount,0);
  assert.deepEqual(result.pending.map(x=>x.reason),["destination_not_verified","local_original_not_verified"]);
});

test("legacy incorrect MIME may be repaired only after byte verification, never considered ready",async()=>{
  const mismatch = ()=>new Response(bytes,{headers:{"Content-Type":"image/webp"}});
  await assert.rejects(verifyDestination(object,async()=>mismatch()),/content type mismatch/);
  const repair = await verifyDestination(object,async()=>mismatch(),{allowContentTypeRepair:true});
  assert.equal(repair.status,"content_type_repair_required");
  assert.equal(verifiedForObject(object,repair),false);
  const damaged = Buffer.from(bytes); damaged[10] = 7;
  await assert.rejects(verifyDestination(object,async()=>new Response(damaged,{headers:{"Content-Type":"image/webp"}}),{allowContentTypeRepair:true}),/hash/);
});
