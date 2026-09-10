import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudflareClient} from '../client/cloudflare-transport.mjs';
test('cookie transport coalesces session reads and preserves RPC and table contracts',async()=>{
  const calls=[];const client=createCloudflareClient({document:{cookie:'__Host-minkiru_csrf=test-csrf'},fetchImpl:async(path,options)=>{
    calls.push({path,options});return Response.json(path==='/api/session'?{session:{user:{id:'u'}}}:{data:[{display_name:'fixture'}]});
  }});
  await Promise.all([client.auth.getSession(),client.auth.getSession()]);await client.auth.getSession();assert.equal(calls.length,1);
  const out=await client.rpc('get_shared_collection',{p_share_slug:'one'}).maybeSingle();assert.equal(out.data.display_name,'fixture');
  await client.from('profiles').upsert({id:'u',display_name:'test'}).select('display_name').single();
  assert.equal(calls.at(-1).options.credentials,'same-origin');assert.equal(calls.at(-1).options.headers['X-Minkiru-CSRF'],'test-csrf');
  assert.ok(!JSON.stringify(calls).includes('Authorization'));assert.equal(JSON.parse(calls.at(-1).options.body).rows.id,'u');
});
test('auth destinations stay same-origin and failed requests never impersonate sessions',async()=>{
  let assigned;const client=createCloudflareClient({location:{href:'https://fixture.test/?q=2',origin:'https://fixture.test',assign:x=>{assigned=x;}},fetchImpl:async()=>Response.json({error:'login_required',message:'ログインしてください'},{status:401})});
  await client.auth.signInWithOAuth({provider:'discord',options:{redirectTo:'https://evil.test/'}});
  assert.equal(assigned,'/auth/discord?returnTo=%2F');
  const result=await client.auth.getSession();assert.equal(result.data.session,null);assert.equal(result.error.status,401);
});
