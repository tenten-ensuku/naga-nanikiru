import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/study-model-v351.js';
const api=globalThis.MinkiruStudyModelV351;
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};};
test('first signed-in load is shared by concurrent startup and question reads, then cached for later questions',async()=>{
 let calls=0;const backend={rpc:async()=>{calls++;return {data:{default_model:'ウロボロス',preferred_model:'アナンタ'}};}};
 const c=api.create({api:()=>backend,storage:storage()});
 await Promise.all([c.ensure('alice','book'),c.ensure('alice','book')]);await c.ensure('alice','book');
 assert.equal(calls,1);assert.equal(c.current('alice','book').preferred_model,'アナンタ');
});
test('model resolution follows names across reordered questions and falls back without overwriting the choice',()=>{
 assert.equal(api.resolve({models:[{name:'アナンタ'},{name:'ウロボロス'}]},'ウロボロス').index,1);
 const result=api.resolve({models:[{name:'ヒバカリ'},{name:'ニシキ'}]},'ウロボロス');assert.equal(result.index,1);assert.equal(result.missing,true);assert.equal(result.requested,'ウロボロス');
 assert.equal(api.resolve({models:[{name:'ウロボロス'},{name:'アナンタ'}]},result.requested).index,0);
});
test('a fresh controller reloads the saved personal model from the server; book and actor caches stay separate',async()=>{
 const db=new Map(),cache=storage(),backend={rpc:async(name,args)=>{if(name==='save_collection_study_model')db.set(args.p_share_slug,args.p_model);return {data:{default_model:'ニシキ',preferred_model:db.get(args.p_share_slug)||null}};}};
 const c=api.create({api:()=>backend,storage:cache});await c.choose('alice','book','アナンタ');assert.equal(c.current('alice','book').preferred_model,'アナンタ');
 assert.equal(c.current('bob','book').preferred_model,null);assert.equal(c.current('alice','other').preferred_model,null);
 const fresh=api.create({api:()=>backend,storage:storage()});assert.equal((await fresh.load('alice','book')).preferred_model,'アナンタ');
 await fresh.choose('alice','book',null);assert.equal(fresh.current('alice','book').preferred_model,null);
});
test('slow reads and successive writes cannot roll back a newer selection',async()=>{
 let finish;const calls=[];const backend={rpc:(name,args)=>name==='get_collection_study_model'?new Promise(resolve=>finish=resolve):(calls.push(args.p_model),Promise.resolve({data:{default_model:'ニシキ',preferred_model:args.p_model}}))};
 const c=api.create({api:()=>backend,storage:storage()});const read=c.load('alice','book');
 await Promise.all([c.choose('alice','book','ウロボロス'),c.choose('alice','book','アナンタ')]);finish({data:{default_model:'ニシキ',preferred_model:null}});await read;
 assert.deepEqual(calls,['ウロボロス','アナンタ']);assert.equal(c.current('alice','book').preferred_model,'アナンタ');
});
test('failed defaults roll back; a queued write cannot save under a different signed-in account',async()=>{
 let actor='alice';const backend={rpc:async()=>({error:Error('offline')})};const c=api.create({api:()=>backend,storage:storage(),getActor:()=>actor});
 await assert.rejects(c.choose(actor,'book','アナンタ',true));assert.equal(c.current(actor,'book').default_model,'ニシキ');
 const pending=c.choose(actor,'book','ウロボロス');actor='bob';await assert.rejects(pending,/ログイン状態/);assert.equal(c.current(actor,'book').preferred_model,null);
});
