import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('      async function openRequestedQuestionAfterAuthV187()'),html.indexOf('      async function refreshAccountBodyV153(',html.indexOf('      async function openRequestedQuestionAfterAuthV187()')));
const id='5ca6b224-da7d-4837-ba04-bdbdc325249a';
function setup({signedIn=true,missing=false,changeOwner=false}={}){
 const calls=[];const ctx={URL,console,pendingExistingQuestionIdV187:id,pendingExistingQuestionOpeningV187:false,supabaseSessionV46:signedIn?{user:{id:'owner'}}:null,
  questionsV16:[{serverQuestionId:'another'}],sharedCollectionV46:{share_slug:'book'},sharedQuestionPagingV177:{generation:1},
  normalizeSharedQuestionV66:row=>row?{id:row.id,question:{serverQuestionId:row.id,__sharedDetailLoaded:true}}:null,
  rememberSharedQuestionRowsV177:rows=>calls.push(['remember',rows.length]),renderQuestionOptionsV16:()=>{},
  openQuestionV16:async index=>{calls.push(['open',index]);return true;},
  window:{location:{href:'https://fixture.test/?existing_question='+id},history:{replaceState:()=>{}},NagaSupabase:{loadSharedQuestionDetail:async(slug,questionId)=>{calls.push(['detail',slug,questionId]);if(changeOwner)ctx.supabaseSessionV46={user:{id:'other'}};return missing?null:{id:questionId};}}}};
 vm.runInNewContext(source,ctx);return {ctx,calls};
}
test('a question outside the first index page loads exactly one authenticated detail',async()=>{const {ctx,calls}=setup();assert.equal(await ctx.openRequestedQuestionAfterAuthV187(),true);assert.deepEqual(calls.map(x=>x[0]),['detail','remember','open']);assert.equal(ctx.questionsV16.length,2);assert.equal(ctx.pendingExistingQuestionIdV187,'');});
test('deep links never expose a cached question after account switch or failed authorization',async()=>{for(const options of [{signedIn:false},{missing:true},{changeOwner:true}]){const {ctx,calls}=setup(options);assert.equal(await ctx.openRequestedQuestionAfterAuthV187(),false);assert.equal(calls.some(x=>x[0]==='open'),false);assert.equal(ctx.questionsV16.length,1);}});
