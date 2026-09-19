import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
function fn(name){const match=html.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n      \\}`));assert.ok(match,name);return match[0];}
function harness(){
  const events=[],select={value:'book'},rows=[{share_slug:'book',can_edit:true,visibility:'private',title:'自分の本'}];
  const ctx=vm.createContext({
    document:{getElementById:()=>select}, generatorDestinationV130:'',generatorDestinationRowsV130:()=>rows,
    collectionDisplayNameV101:row=>row.title,supabaseSessionV46:{user:{id:'author'}},sharedCollectionV46:{share_slug:'book'},
    questionsV16:[],generatorCandidatesV44:[{id:'candidate',boardScene:{}}],generatorAddedKeysV130:new Set(),generatorDuplicateKeysV153:new Set(),
    generatorCommentDraftsV273:new Map([['candidate','**検討** #押し引き']]),
    generatedHandIsValidV237:()=>true,prepareJsonBoardV248:()=>true,nextQuestionNumberV154:()=>1,
    currentUserDisplayNameV47:()=> '作成者',normalizeDiscordThreadUrlV222:x=>x,
    setGeneratorStatusV44:(text,error)=>events.push({text,error}),explainGeneratorSaveBlockedV249:()=>events.push('blocked'),
    setGeneratorStageV159:()=>{},refreshBookCapacityV235:()=>{},renderQuestionOptionsV16:()=>{},markSharedCommentKnownV65:id=>events.push(id),
    saveUserStateV16:()=>{throw Error('Generation must not depend on browser storage');},userStateV16:{customQuestions:[],localComments:{},answerHistory:[{id:'existing-history'}]},
    window:{NagaGenerationConfirmV241:{ask:async()=>true},MinkiruCommentToolsV274:{getAttachments:async()=>[]},
      MinkiruCommentTagsV270:{tagsFromComments:()=>['押し引き'],searchTextFromComments:comments=>comments.join('\n')}},
    invokeSharedMutationV47:async(action,payload)=>{events.push({action,payload});return {id:'server-question',questionNumber:7,shareSlug:'book',initialCommentId:'saved-comment'};}
  });
  vm.runInContext(['currentGeneratorDestinationV130','canAddGeneratedQuestionV130','addGeneratedQuestionV44'].map(fn).join('\n'),ctx);
  return {ctx,select,events,save:()=>ctx.addGeneratedQuestionV44(0,{suppressRender:true})};
}
test('retired local destination and missing permissions cannot add even through the save handler',async()=>{
  for(const destination of ['local','','revoked']){const h=harness();h.select.value=destination;assert.equal(await h.save(),false);assert.equal(h.events.some(e=>e.action),false);assert.equal(h.ctx.questionsV16.length,0);}
  const h=harness();h.ctx.supabaseSessionV46=null;assert.equal(await h.save(),false);assert.equal(h.events.some(e=>e.action),false);
});
test('a generated question and comment must save to the selected book before becoming usable',async()=>{
  const h=harness();assert.equal(await h.save(),true);
  const write=h.events.find(e=>e.action);assert.equal(write.action,'add');assert.equal(write.payload.shareSlug,'book');
  assert.equal(write.payload.initialComment,'**検討** #押し引き');assert.equal(write.payload.question.visibility,'private');
  assert.equal(h.ctx.questionsV16[0].id,'server-question');assert.equal(h.ctx.questionsV16[0].number,7);
  assert.equal(h.ctx.questionsV16[0].serverQuestionId,'server-question');assert.equal(h.ctx.questionsV16[0].isShared,true);
  assert.equal(h.ctx.userStateV16.customQuestions.length,0);assert.equal(h.ctx.userStateV16.answerHistory[0].id,'existing-history');
  assert.equal(h.ctx.generatorAddedKeysV130.has('candidate::book'),true);
});
test('failed or unconfirmed server saves leave the candidate without creating a local question or comment',async()=>{
  for(const invoke of [async()=>{throw Error('通信失敗');},async()=>({})]){
    const h=harness();h.ctx.invokeSharedMutationV47=invoke;assert.equal(await h.save(),false);
    assert.equal(h.ctx.questionsV16.length,0);assert.equal(h.ctx.generatorCandidatesV44.length,1);assert.equal(h.ctx.generatorAddedKeysV130.size,0);
    assert.equal(h.ctx.userStateV16.customQuestions.length,0);assert.equal(Object.keys(h.ctx.userStateV16.localComments).length,0);
  }
});
test('old local destinations cannot pass default selection or save confirmation',async()=>{
  const window={};vm.runInNewContext(fs.readFileSync(new URL('../public/navigation-v234.js',import.meta.url),'utf8'),{window});
  assert.equal(window.MinkiruNavigationV234.generatorDefault({stored:'local',explicit:true,rows:[{share_slug:'book'}],fromBook:true,bookSlug:'book'}),'');
  vm.runInNewContext(fs.readFileSync(new URL('../public/generation-confirm-v241.js',import.meta.url),'utf8'),{window});
  assert.equal(await window.NagaGenerationConfirmV241.ask({getElementById:()=>({})},{kind:'local',label:'古い保存先'},1),false);
});
test('comment posting, editing and deletion have no browser-only fallback',async()=>{
  for(const name of ['persistLocalCommentV44','persistCommentEditV75','persistCommentDeleteV75']){
    const body=html.match(new RegExp(`window\\.${name} = async[\\s\\S]*?\\n      };`))[0];
    const ctx={window:{},questionsV16:[{id:'local-question'}],currentQuestionIndexV16:0,sharedCollectionV46:null,state:{comments:[{id:'draft'}]},renderComments(){}};
    vm.runInNewContext(body,ctx);await assert.rejects(ctx.window[name]({id:'draft'}),/問題集に保存した問題/);
  }
});
