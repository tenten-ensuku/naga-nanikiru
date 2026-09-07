import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../supabase/functions/_shared/ops-capacity.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {checkOpsCapacity}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const options={supabaseUrl:'https://testproject.supabase.co',serviceRoleKey:'unit-test-secret'};
for(const [value,expected]of [[{blocked:false,reason:'',checkedAt:null},'allowed'],[{blocked:true,reason:'monitor_stale',checkedAt:null},'blocked'],[{blocked:false,reason:'',checkedAt:'2026-09-07T00:00:00Z'},'allowed'],[{blocked:'false'},'unavailable']])test('server preflight '+expected+' '+JSON.stringify(value),async()=>{
 let calls=0;const result=await checkOpsCapacity({...options,fetchImpl:async(url,init)=>{calls++;assert.equal(url,'https://testproject.supabase.co/rest/v1/rpc/ops_capacity_status');assert.equal(init.headers.apikey,'unit-test-secret');return Response.json(value);}});
 assert.equal(result.kind,expected);assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(result),/unit-test-secret/);
});
for(const status of [402,500,503])test('preflight transport '+status+' never retries',async()=>{let calls=0;const result=await checkOpsCapacity({...options,fetchImpl:async()=>{calls++;return new Response('private upstream details',{status});}});assert.equal(calls,1);assert.equal(result.kind,'unavailable');assert.doesNotMatch(JSON.stringify(result),/private upstream details/);});
