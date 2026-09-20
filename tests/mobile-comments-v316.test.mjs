import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const mobile=readFileSync(new URL('../public/mobile-comments-v316.js',import.meta.url),'utf8');
test('keyboard viewport size and offset are used without assuming the layout viewport shrinks',()=>{
  const window={};vm.runInNewContext(mobile,{window});
  const rect=window.MinkiruMobileCommentsV316.viewportRect({offsetTop:123,offsetLeft:0,width:390,height:410},390,844);
  assert.equal(rect.top,123);assert.equal(rect.height,410);assert.equal(rect.width,390);
  const fallback=window.MinkiruMobileCommentsV316.viewportRect(null,375,667);
  assert.equal(fallback.top,0);assert.equal(fallback.height,667);
});

function composer({editing=false,persist=async()=>{}}={}) {
  const original={id:'existing-comment',content:'元の内容',attachments:[{id:'old'}]};
  const attachment={id:'draft-file',file:{name:'draft.png'}};
  const input={value:'  変更した内容 7z  ',disabled:false,blur(){this.blurred=true;}};
  const controls=[input,{disabled:false},{disabled:true}];
  const state={comments:editing?[original]:[],commentAttachments:[attachment],commentEditingId:editing?original.id:null,commentComposerOpen:true,revealed:true,answers:{question:'unchanged'}};
  const statuses=[],busy=[],scrolls=[],frames=[];
  const notice={textContent:''};let dismiss;
  const window={persistLocalCommentV44:persist,persistCommentEditV75:persist,MinkiruMobileCommentsV316:{setBusy:value=>busy.push(value)}};
  const context=vm.createContext({window,state,requestAnimationFrame:callback=>frames.push(callback),setTimeout:callback=>{dismiss=callback;return 1;},clearTimeout(){},document:{getElementById:id=>id==='commentInput'?input:id==='commentSendNoticeV319'?notice:{querySelectorAll:()=>controls},querySelector:()=>({scrollIntoView:options=>scrolls.push(options)})},
    canEditCommentV75:()=>true,normalizeCommentAvatarUrlV196:()=>'',renderComments(){},renderCommentAttachmentPreviewV68(){},syncCommentComposerV75(){},
    clearCommentDraftV68(){state.commentAttachments=[];},setCommentFormStatusV68:(text,error)=>statuses.push({text,error})});
  const edits=html.slice(html.indexOf('    let commentSendNoticeTimerV319;'),html.indexOf('    async function deleteCommentV75('));
  const submit=html.slice(html.indexOf('    let commentSubmittingV316 ='),html.indexOf('    function reset()'));
  vm.runInContext(edits+submit,context);
  return {input,controls,state,statuses,busy,original,attachment,notice,scrolls,frames,flushFrame:()=>frames.splice(0).forEach(callback=>callback()),dismiss:()=>dismiss?.(),submit:()=>context.submitComment({preventDefault(){}})};
}
test('double tap sends once, locks controls, and clears draft only after success',async()=>{
  let finish,calls=0;
  const c=composer({persist:async()=>{calls++;await new Promise(resolve=>finish=resolve);}});
  const pending=c.submit();await Promise.resolve();await c.submit();
  assert.equal(calls,1);assert.equal(c.input.value,'  変更した内容 7z  ');assert.ok(c.controls.every(x=>x.disabled));
  finish();await pending;
  assert.equal(c.input.value,'');assert.equal(c.state.commentAttachments.length,0);
  assert.deepEqual(c.controls.map(x=>x.disabled),[false,false,true]);assert.deepEqual(c.busy,[true,false]);
  assert.deepEqual(c.state.answers,{question:'unchanged'});
  assert.equal(c.state.commentComposerOpen,false);assert.equal(c.state.revealed,true);assert.equal(c.input.blurred,true);
  assert.equal(c.notice.textContent,'送信しました');c.flushFrame();assert.equal(c.scrolls.length,1);assert.equal(c.scrolls[0].block,'start');
  c.dismiss();assert.equal(c.notice.textContent,'');
});
test('new comment failure preserves text and attachments, removes pending row, and permits retry',async()=>{
  let fail=true,calls=0;
  const c=composer({persist:()=>{calls++;if(fail)throw Error('通信失敗');}});
  await c.submit();assert.equal(c.input.value,'  変更した内容 7z  ');assert.equal(c.state.commentAttachments[0],c.attachment);
  assert.equal(c.state.comments.length,0);assert.equal(c.statuses.at(-1).error,true);assert.equal(c.input.disabled,false);
  assert.equal(c.state.commentComposerOpen,true);assert.equal(c.notice.textContent,'');assert.equal(c.frames.length,0);
  fail=false;await c.submit();assert.equal(calls,2);assert.equal(c.state.comments.length,1);assert.equal(c.input.value,'');
});
test('failed edit retains the attempted draft while restoring the displayed original comment',async()=>{
  const c=composer({editing:true,persist:async()=>{throw Error('更新失敗');}});
  await c.submit();assert.equal(c.input.value,'  変更した内容 7z  ');assert.equal(c.state.commentAttachments[0],c.attachment);
  assert.equal(c.state.comments[0],c.original);assert.equal(c.state.commentEditingId,c.original.id);assert.equal(c.input.disabled,false);
  assert.equal(c.state.commentComposerOpen,true);assert.equal(c.notice.textContent,'');assert.equal(c.frames.length,0);
});
test('successful edit persists edited content before clearing its draft',async()=>{
  let sent,previous;
  const c=composer({editing:true,persist:async(a,b)=>{sent=a;previous=b;assert.notEqual(c.input.value,'');}});
  await c.submit();assert.equal(sent.content,'変更した内容 7z');assert.equal(previous[0].id,'old');
  assert.equal(c.input.value,'');assert.equal(c.state.commentEditingId,null);assert.equal(c.state.commentAttachments.length,0);
  assert.equal(c.state.commentComposerOpen,false);assert.equal(c.notice.textContent,'更新しました');
});
