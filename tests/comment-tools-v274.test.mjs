import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transform} from 'esbuild';
const source=readFileSync(new URL('../public/comment-tools-v274.js',import.meta.url),'utf8');
test('both save buttons share a lock through confirmation and release it after errors',async()=>{
  const ctx=vm.createContext({});vm.runInContext(source,ctx);
  const {saveOnce}=ctx.MinkiruCommentToolsV274;
  let calls=0,finish;
  const first=saveOnce(async()=>{calls++;await new Promise(resolve=>finish=resolve);return true;});
  assert.equal(await saveOnce(()=>{calls++;}),false);assert.equal(calls,1);finish();assert.equal(await first,true);
  await assert.rejects(saveOnce(()=>{throw Error('rejected');}),/rejected/);
  assert.equal(await saveOnce(()=>42),42);
});
test('initial comment uploads are reused on retry, isolated by account and destination, and failed uploads retry',async()=>{
  const client=readFileSync(new URL('../client/supabase-sync.ts',import.meta.url),'utf8');
  const section=client.slice(client.indexOf('const initialCommentUploadsV274'),client.indexOf('async function createSharedQuestion'));
  const {code}=await transform(section,{loader:'ts'});
  let actor='owner',calls=0,fail=false;
  const ctx=vm.createContext({currentSession:async()=>actor?{user:{id:actor}}:null,uploadCommentAttachment:async()=>{calls++;if(fail)throw Error('upload_failed');return {path:'owner/comments/test.png',src:'/v1/public/test',alt:'image'};}});
  vm.runInContext(code,ctx);const upload=ctx.prepareInitialAttachmentsV274,items=[{file:{name:'test.png'}}];
  await upload(items,'book');await upload(items,'book');assert.equal(calls,1);
  await upload(items,'book2');assert.equal(calls,2);actor='other';await upload(items,'book');assert.equal(calls,3);
  fail=true;await assert.rejects(upload(items,'book3'),/upload_failed/);fail=false;await upload(items,'book3');assert.equal(calls,5);
  actor=null;await assert.rejects(upload(items,'book'),/ログイン/);assert.deepEqual(Array.from(await upload([],'book')),[]);
  await assert.rejects(upload(Array(5).fill(items[0]),'book'),/comment_content_invalid/);
});

test('Enter on a disclosure or formatting button does not advance the study question',()=>{
  const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const start=html.lastIndexOf('document.addEventListener("keydown", event => {');
  const end=html.indexOf('\n        });',start)+'\n        });'.length;
  let listener,advanced=0,prevented=0;
  const document={activeElement:{tagName:'SUMMARY'},getElementById:()=>({hidden:false}),addEventListener:(_name,fn)=>{listener=fn;}};
  vm.runInNewContext(html.slice(start,end),{document,state:{revealed:true},advanceQuestionV44:()=>advanced++,confirmAnswerV41:()=>assert.fail('unexpected confirmation')});
  for(const tagName of ['SUMMARY','BUTTON','TEXTAREA']){document.activeElement.tagName=tagName;listener({key:'Enter',preventDefault:()=>prevented++});}
  assert.equal(advanced,0);assert.equal(prevented,0);
  document.activeElement.tagName='BODY';listener({key:'Enter',preventDefault:()=>prevented++});assert.equal(advanced,1);assert.equal(prevented,1);
});
