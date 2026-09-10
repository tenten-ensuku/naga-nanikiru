import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const helper=html.match(/function userStateStorageKeyV232\(\) \{[\s\S]*?\n      \}/)?.[0];
test('Cloudflare browser history and settings are isolated by authenticated account',()=>{
  assert.ok(helper);
  const key=(backend,id)=>vm.runInNewContext(helper+';userStateStorageKeyV232()',{
    USER_STATE_KEY_V16:'naga-nanikiru:user-state-v1',window:{NAGA_RUNTIME_CONFIG:{backend}},supabaseSessionV46:id?{user:{id}}:null,
  });
  assert.equal(key('cloudflare','alice'),'naga-nanikiru:user-state-v1:cloudflare:alice');
  assert.equal(key('cloudflare','bob'),'naga-nanikiru:user-state-v1:cloudflare:bob');
  assert.equal(key('cloudflare',null),'naga-nanikiru:user-state-v1:cloudflare:signed-out');
  assert.equal(key('supabase','alice'),'naga-nanikiru:user-state-v1');
  assert.match(html,/stateKey === USER_STATE_KEY_V16 && window\.localStorage\.getItem\(stateKey\) === null/);
  assert.match(html,/previousUserId !== String\(session\?\.user\?\.id \|\| ""\)/);
});
