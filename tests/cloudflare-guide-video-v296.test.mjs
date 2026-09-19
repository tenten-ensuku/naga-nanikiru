import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import worker from '../cloudflare/worker.mjs';
const origin='https://fixture.test', path='/guide/video/minkiru-promo-landscape-v295.mp4';
const bytes=Uint8Array.from({length:1000},(_,i)=>i%251);
function fixture(status=200){
  const requests=[];let cancelled=false,reads=0;
  const env={CUTOVER_READY:'true',DB:{},APP_ORIGIN:origin,DISCORD_CLIENT_ID:'123456789012345678',DISCORD_CLIENT_SECRET:'fixture',ASSETS:{async fetch(req){
    requests.push({path:new URL(req.url).pathname,method:req.method,range:req.headers.get('Range')});
    if(status!==200)return new Response(null,{status});
    let offset=0;const body=new ReadableStream({pull(c){reads++;if(offset===bytes.length){c.close();return;}const end=Math.min(offset+100,bytes.length);c.enqueue(bytes.slice(offset,end));offset=end;},cancel(){cancelled=true;}});
    return new Response(body,{headers:{'Content-Type':'video/mp4','Content-Length':String(bytes.length),ETag:'"movie-v1"','Last-Modified':'Fri, 18 Sep 2026 00:00:00 GMT'}});
  }}};
  return {env,requests,get cancelled(){return cancelled},get reads(){return reads}};
}
async function fetchVideo(f,range,more={},method='GET'){
  return worker.fetch(new Request(origin+path,{method,headers:{...(range?{Range:range}:{}),...more}}),f.env);
}
test('unbuffered positions return the requested bytes with exact partial-content headers',async()=>{
  for(const [range,start,end] of [['bytes=0-1',0,1],['bytes=523-640',523,640],['bytes=900-',900,999],['bytes=-75',925,999],['bytes=980-2000',980,999]]){
    const f=fixture(),r=await fetchVideo(f,range);
    assert.equal(r.status,206);assert.equal(r.headers.get('Accept-Ranges'),'bytes');
    assert.equal(r.headers.get('Content-Range'),`bytes ${start}-${end}/1000`);
    assert.equal(r.headers.get('Content-Length'),String(end-start+1));
    assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes.slice(start,end+1));
    assert.equal(f.requests[0].range,null);if(end<999)assert.equal(f.cancelled,true);
    if(end<100)assert.ok(f.reads<4,'small ranges must not read the entire asset');
  }
});
test('HEAD and full GET advertise seeking without modifying the movie',async()=>{
  const f=fixture(),head=await fetchVideo(f,'bytes=5-8',{},'HEAD');
  assert.equal(head.status,200);assert.equal(head.headers.get('Content-Length'),'1000');assert.equal((await head.arrayBuffer()).byteLength,0);assert.equal(f.cancelled,true);
  const full=await fetchVideo(fixture());assert.equal(full.status,200);assert.equal(full.headers.get('Accept-Ranges'),'bytes');assert.deepEqual(new Uint8Array(await full.arrayBuffer()),bytes);
});
test('unsatisfiable ranges fail with the real total length; unsupported ranges fall back to full GET',async()=>{
  for(const range of ['bytes=1000-','bytes=80-20','bytes=-0']){const r=await fetchVideo(fixture(),range);assert.equal(r.status,416);assert.equal(r.headers.get('Content-Range'),'bytes */1000');assert.equal((await r.arrayBuffer()).byteLength,0);}
  for(const range of ['bytes=bad','bytes=1-3,5-8','items=1-3']){const r=await fetchVideo(fixture(),range);assert.equal(r.status,200);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes);}
});
test('If-Range validators prevent mixing old and new asset bytes',async()=>{
  for(const [value,status] of [['"movie-v1"',206],['"old"',200],['W/"movie-v1"',200],['Sat, 19 Sep 2026 00:00:00 GMT',206],['Thu, 17 Sep 2026 00:00:00 GMT',200]]){
    const r=await fetchVideo(fixture(),'bytes=10-19',{'If-Range':value});assert.equal(r.status,status);await r.arrayBuffer();
  }
});
test('missing videos and withdrawn media keep their existing status',async()=>{
  assert.equal((await fetchVideo(fixture(404),'bytes=0-1')).status,404);
  const f=fixture();const r=await worker.fetch(new Request(origin+'/guide/video/minkiru-promo.mp4',{headers:{Range:'bytes=0-1'}}),f.env);assert.equal(r.status,410);assert.equal(f.requests.length,0);
});

test('every published movie supports seeking when ASSETS omits Content-Length',async()=>{
  const directory=new URL('../public/guide/video/',import.meta.url);
  const movies=(await readdir(directory)).filter(name=>name.endsWith('.mp4'));
  assert.ok(movies.length>0);
  for(const name of movies){
    const movie=await readFile(new URL(name,directory)), f=fixture();
    f.env.ASSETS.fetch=async()=>new Response(movie,{headers:{'Content-Type':'video/mp4'}});
    const url=origin+'/guide/video/'+name;
    const r=await worker.fetch(new Request(url,{headers:{Range:'bytes=5000000-5000100'}}),f.env);
    assert.equal(r.status,206,name);
    assert.equal(r.headers.get('Content-Range'),`bytes 5000000-5000100/${movie.length}`,name);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()),movie.subarray(5000000,5000101));
    const head=await worker.fetch(new Request(url,{method:'HEAD'}),f.env);
    assert.equal(head.headers.get('Content-Length'),String(movie.length));
  }
});
