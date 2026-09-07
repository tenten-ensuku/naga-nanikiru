import test from 'node:test';
import assert from 'node:assert/strict';
import {createMonitorHandler} from '../supabase/functions/ops-capacity/handler.mjs';
import {createAccessVerifier} from '../ops/access.mjs';
const hex=x=>Buffer.from(x).toString('hex');
const token='f'.repeat(64),digest=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)));
const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
const req=(value,secret=token)=>new Request('https://project.supabase.co/functions/v1/ops-capacity',{method:'POST',headers:{'x-ops-monitor-token':secret},body:JSON.stringify(value)});
test('aggregate adapter denies unknown/missing token without touching DB',async()=>{
 let calls=0;const handler=createMonitorHandler({digest,baseUrl:'https://example.supabase.co',serviceKey:'test-only',fetchImpl:async()=>{calls++;return response({});}});
 for(const input of ['', '0'.repeat(64),'not-token'])assert.equal((await handler(req({action:'snapshot'},input))).status,403);
 assert.equal(calls,0);
});
test('aggregate adapter whitelists actions, bounded bodies, and preserves 402 without retries',async()=>{
 let calls=0;const handler=createMonitorHandler({digest,baseUrl:'https://example.supabase.co',serviceKey:'test-only',fetchImpl:async()=>{calls++;return new Response('secret detail',{status:402});}});
 for(const action of ['drop','constructor','__proto__'])assert.equal((await handler(req({action}))).status,400);
 assert.equal((await handler(req({action:'control',value:{}}))).status,400);
 assert.equal((await handler(req({action:'snapshot',padding:'x'.repeat(4096)}))).status,413);
 const r=await handler(req({action:'snapshot'}));assert.equal(r.status,402);assert.doesNotMatch(await r.text(),/secret detail|test-only/);assert.equal(calls,1);
});
test('aggregate route uses server key only upstream and returns metadata',async()=>{
 const handler=createMonitorHandler({digest,baseUrl:'https://example.supabase.co',serviceKey:'test-only',fetchImpl:async(url,options)=>{assert.equal(url,'https://example.supabase.co/rest/v1/rpc/ops_capacity_snapshot');assert.equal(options.headers.apikey,'test-only');return response({databaseBytes:123});}});
 assert.deepEqual(await (await handler(req({action:'snapshot'}))).json(),{databaseBytes:123});
});
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'test-key'};
const stamp=Date.parse('2026-09-07T12:00:00Z'),env={ACCESS_TEAM_DOMAIN:'unit-test.cloudflareaccess.com',ACCESS_AUD:'test-aud',OWNER_EMAIL:'owner@example.com'};
async function jwt(claims={},header={}){
 const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const data=encode({alg:'RS256',kid:'test-key',...header})+'.'+encode({iss:'https://'+env.ACCESS_TEAM_DOMAIN,aud:['test-aud'],email:'owner@example.com',exp:stamp/1000+600,...claims});
 return data+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(data))).toString('base64url');
}
test('Access verifies signature, exact owner, audience, expiry and missing configuration',async()=>{
 let calls=0;const verify=createAccessVerifier(async()=>{calls++;return response({keys:[jwk]});},()=>stamp);
 const check=async(claims={},header={},settings=env)=>verify(new Request('https://ops.example/',{headers:{'Cf-Access-Jwt-Assertion':await jwt(claims,header)}}),settings);
 assert.equal(await check(),true);
 for(const claims of [{email:'other@example.com'},{aud:['wrong']},{iss:'https://evil.test'},{exp:stamp/1000-1}])assert.equal(await check(claims),false);
 assert.equal(await check({},{alg:'none'}),false);assert.equal(await check({},{},{...env,ACCESS_AUD:''}),false);
 const signed=await jwt();assert.equal(await verify(new Request('https://ops.example/',{headers:{'Cf-Access-Jwt-Assertion':signed.slice(0,-5)+'aaaaa'}}),env),false);
 for(let i=0;i<4;i++)assert.equal(await check({},{kid:'bad-'+i}),false);
 assert.equal(calls,1,'unknown key ids cannot cause unlimited certificate fetches');
});
