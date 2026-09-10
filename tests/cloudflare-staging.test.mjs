import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{MIGRATION_IMPLEMENTATION_COMPLETE} from '../cloudflare/worker.mjs';
test('staging entry cannot expose incomplete APIs, even if an environment flag is set',async()=>{
  assert.equal(MIGRATION_IMPLEMENTATION_COMPLETE,false);
  for(const url of ['/', '/auth/discord','/api/rpc/get_shared_question_detail','/api/table/profiles']){
    const r=await worker.fetch(new Request('https://fixture.test'+url),{CUTOVER_READY:'true',DB:{prepare(){throw Error('Unexpected DB access');}}});
    assert.equal(r.status,503);assert.equal(r.headers.get('Cache-Control'),'no-store');
  }
  const response=await worker.fetch(new Request('https://fixture.test/health'));
  assert.equal((await response.json()).ready,false);
});
