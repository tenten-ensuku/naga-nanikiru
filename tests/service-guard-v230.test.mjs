import assert from "node:assert/strict";
import test from "node:test";
import { createServiceGuard } from "../client/service-guard.mjs";
test("402 stops subsequent requests until successful explicit probe, without retrying",async () => {
  let calls = 0, status = 402, notices = 0;
  const guard = createServiceGuard({ fetchImpl: async () => { calls++; return new Response("{}",{status}); }, onRestricted: () => notices++ });
  assert.equal((await guard.fetch("https://example.test")).status,402);
  assert.equal(guard.available(),false);
  await assert.rejects(guard.fetch("https://example.test"),/通信を停止/);
  assert.equal(calls,1); assert.equal(notices,1);
  assert.equal(await guard.probe("https://example.test","public"),false);
  status = 200;
  assert.equal(await guard.probe("https://example.test","public"),true);
  assert.equal((await guard.fetch("https://example.test")).status,200);
  assert.equal(calls,4);
});
test("failed and concurrent probes neither manufacture recovery nor duplicate traffic",async () => {
  let calls = 0, finish;
  const guard = createServiceGuard({ fetchImpl: () => { calls++; return new Promise(resolve => { finish=resolve; }); } });
  const a = guard.probe("https://example.test","public"), b = guard.probe("https://example.test","public");
  assert.equal(a,b); assert.equal(calls,1);
  finish(new Response("{}",{status:503}));
  assert.equal(await a,false);
});
