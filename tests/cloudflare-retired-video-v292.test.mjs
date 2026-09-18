import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/worker.mjs';

test('retired video cannot be served through old links or range requests',async()=>{
  const env={ASSETS:{fetch(){throw Error('Retired media must never reach the asset binding');}}};
  for(const method of ['GET','HEAD'])for(const suffix of ['','?v=291','?v=268']){
    const response=await worker.fetch(new Request('https://fixture.test/guide/video/minkiru-promo.mp4'+suffix,{method,headers:{Range:'bytes=0-1023'}}),env);
    assert.equal(response.status,410);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.notEqual(response.headers.get('Content-Type'),'video/mp4');
    if(method==='HEAD')assert.equal(await response.text(),'');
  }
});
