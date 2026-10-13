import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {generator as g} from '../scripts/naga-generator-runtime.mjs';
import {boardRenderer} from '../scripts/naga-board-runtime.mjs';

const names=['ニシキ','ヒバカリ','カガシ','アナンタ','ウロボロス'];
const msg=(type,fields={})=>({info:{msg:{type,...fields}}});
const row=(length,values)=>Object.assign(Array(length).fill(0),values);
// Synthetic five-model report, following the viewer 1.2.2 mixed legacy/detail contract.
function report(){
  return {reportId:'models-v349',naga_types:Object.fromEntries(names.map((n,i)=>[i,n])),pred:[[
    msg('start_kyoku',{tehais:[['1m','2m','3m','4m','5m','6m','7m','8m','9m','E','S','W','N'],[],[],[]],dora_marker:'3p'}),
    {...msg('tsumo',{actor:0,pai:'5mr',real_dahai:'1m',pred_dahai:['1m','1m','1m','1m','5mr']}),
      dahai_pred:[row(34,{0:9000,4:1000}),row(34,{0:9000,4:1000}),row(34,{0:9000,4:1000}),null,null],
      dahai_detail:[null,null,null,[row(37,{0:1500,1:2000,2:2000,3:2000}),row(37,{0:2500})],[row(37,{4:4000,34:6000}),row(37,{})]],reach:[0,0,0,null,null]},
    msg('dahai',{actor:0,pai:'1m'})
  ]]};
}
const candidate=r=>g.sceneCandidate(r,{reportId:r.reportId,tw:0,ts:0,tv:1});

test('five-model mixed report preserves columns, merges red fives and reads joint riichi decisions without mutation',()=>{
  const r=report(),before=JSON.stringify(r),q=candidate(r);
  assert.equal(JSON.stringify(r),before);
  assert.deepEqual(Array.from(q.models,m=>m.name),names);
  assert.deepEqual(Array.from(q.probabilities.man1),[90,90,90,40,0]);
  assert.equal(q.probabilities.man5[4],100);assert.equal(q.probabilities.aka1[4],100);
  assert.equal(q.models[4].recommendation,'aka1');
  assert.equal(q.reach[3],2500);assert.equal(q.models[3].riichi,true);
  assert.equal(q.models[4].riichi,false);assert.equal(q.models[0].riichi,undefined);
  assert.equal(q.handValidation.valid,true);
  const markup=boardRenderer.tileRecommendationsMarkup('man1',{models:q.models,probabilities:q.probabilities,selectedModel:3});
  assert.match(markup,/アナンタ：40\.0%/);assert.match(markup,/data-recommendation-bar="3"[^>]*fill="#7c3be6"/);
});

test('both new types extract their own discard and riichi disagreements at every threshold',()=>{
  for(const detectionLevel of ['all','many','normal','few']){
    const r=report();
    assert.equal(g.extractBadMoves(r,0,{detectionLevel,modelNames:['ニシキ']}).length,0);
    const ananta=g.extractBadMoves(r,0,{detectionLevel,modelNames:['アナンタ']});
    assert.equal(ananta.length,1);assert.deepEqual(Array.from(ananta[0].decisionMismatchModels),['アナンタ']);
    assert.equal(g.extractBadMoves(r,0,{detectionLevel,modelNames:['ウロボロス']}).length,1);
    r.pred[0].splice(2,0,msg('reach',{actor:0}));
    assert.equal(g.extractBadMoves(r,0,{detectionLevel,modelNames:['アナンタ']}).length,0);
    // Top discard agrees, but the detailed best action is dama, despite total reach > 50%.
    r.pred[0][1].dahai_detail[3]=[row(37,{0:4000}),row(37,{0:1000,1:2500,2:2500})];
    assert.equal(candidate(r).models[3].riichi,false);
    assert.equal(candidate(r).reach[3],6000);
    assert.equal(g.extractBadMoves(r,0,{detectionLevel,modelNames:['アナンタ']}).length,1);
  }
});

test('detail-only rows and marginal threshold boundaries match the current report format',()=>{
  const r=report();delete r.pred[0][1].dahai_pred;
  r.pred[0][1].dahai_detail[3]=[row(37,{0:499,1:9501}),row(37,{})];r.pred[0][1].info.msg.pred_dahai[3]='2m';
  assert.equal(g.extractBadMoves(r,0,{detectionLevel:'few',modelNames:['アナンタ']}).length,1);
  r.pred[0][1].dahai_detail[3][0][0]=500;
  assert.equal(g.extractBadMoves(r,0,{detectionLevel:'few',modelNames:['アナンタ']}).length,0);
});

test('new kan choice compares individual joint actions, not only an aggregate fifty percent threshold',()=>{
  const r=report(),a=r.pred[0][1];
  a.dahai_detail[3]=[row(37,{0:3000,1:3000}),row(37,{})];
  a.kan=[{0:10000},{0:10000},{0:10000},{0:6000,1:4000},{0:10000}];
  a.ankan_pai=[null,null,null,{'1m':4000},null];
  const q=candidate(r);assert.equal(q.decisionType,'call');assert.equal(q.callRecommendedActions[3],'kan');
  assert.equal(g.extractBadMoves(r,0,{detectionLevel:'few',modelNames:['アナンタ']}).length,1);
});

function ui(scene){
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const elements=Object.fromEntries(['answerStrip','commentsPanel','nextQuestionButton','nextQuestionBottomButton','answerTitle','answerDetail','answerComparison','riichiPanels'].map(id=>[id,{}]));
  const c={SCENE:scene,state:{revealed:true,judgeModel:3,selected:'man1',riichi:true},document:{getElementById:id=>elements[id]},window:{NagaBoardV248:boardRenderer},renderAnswerConfirmationV41(){},renderChoiceScoreV16(){},tileImage:t=>`<img alt="${t}">`,tileLabel:t=>t,nextButtonLabelV44:()=> '次の問題へ',renderComments(){},refreshQuestionPollStatsV110(){}};
  vm.createContext(c);vm.runInContext(html.match(/const MODEL_PRIORITY = [^;]+;/)[0],c);
  for(const name of ['modelPriorityRank','priorityModelIndices','priorityIndicesV16','hasReachV16','questionRiichiRecommendationV349','recommendedRiichiV16','riichiLabel','riichiChoiceLabelV348','riichiChoiceMarkupV348','renderAnswerV16','choiceScoreV16','scoreForQuestionV16'])vm.runInContext(html.match(new RegExp(`    (?:  )?function ${name}\\([^]*?\\n    (?:  )?\\}`))[0],c);
  return {c,elements};
}
test('answer cards include all five models and selected new model controls scoring and historical scoring',()=>{
  const {c,elements}=ui(candidate(report()));c.renderAnswerV16();
  for(const name of names)assert.ok(elements.answerComparison.innerHTML.includes(name));
  assert.equal((elements.answerComparison.innerHTML.match(/class="answer-choice model-choice"/g)||[]).length,5);
  assert.match(elements.answerComparison.innerHTML,/アナンタ[^]*?answer-choice-decision-v348">リーチ/);
  assert.equal(c.choiceScoreV16().mark,'◎');
  assert.equal(c.scoreForQuestionV16(c.SCENE,{selected:'man1',riichi:true,judgeModel:'アナンタ'}).mark,'◎');
  c.state.judgeModel=4;c.state.selected='aka1';c.state.riichi=false;c.renderAnswerV16();assert.equal(c.choiceScoreV16().mark,'◎');
  const legacy=ui({models:names.slice(0,3).map(name=>({name}))});assert.deepEqual(Array.from(legacy.c.priorityIndicesV16()),[0,1,2]);
  const reordered=ui({models:[{name:'ウロボロス'},{name:'ニシキ'},{name:'アナンタ'},{name:'将来モデル'}]});assert.deepEqual(Array.from(reordered.c.priorityIndicesV16()),[1,2,0,3]);
});

test('five-type riichi graphs keep tiny and zero rates explicit and follow the detailed decision',()=>{
  const q={models:names.map(name=>({name})),hasRiichiJudgment:true,reach:[5588,4144,937,12,0]};
  for(const i of [3,4]){
    const html=boardRenderer.judgmentMarkup(q,{selectedModel:i});
    assert.equal((html.match(/data-judgment-model=/g)||[]).length,5);
    assert.match(html,new RegExp(`naga-judgment-values-v350[^]*?立直：${i===3?'0\\.1':'0\\.0'}%`));
  }
  const detailed=boardRenderer.judgmentMarkup(candidate(report()),{selectedModel:3});
  assert.match(detailed,/立直寄りかな/);assert.match(detailed,/立直：25\.0%/);
  q.models[3].riichi=false;q.reach[3]=6000;
  assert.match(boardRenderer.judgmentMarkup(q,{selectedModel:3}),/ダマ寄りかな/);
});

test('five-type call graphs show exact new-type pattern rates and preserve the recommended kan action',()=>{
  const q={decisionType:'call',models:names.map(name=>({name})),callTile:'pin5',callOptions:[{code:0,values:[10,20,30,53.83,86.77]},{code:1,values:[90,80,70,46.16,13.22]}]};
  for(const i of [3,4]){
    const html=boardRenderer.judgmentMarkup(q,{selectedModel:i});
    assert.equal((html.match(/data-judgment-model=/g)||[]).length,5);
    assert.match(html,new RegExp(i===3?'46\\.2%':'13\\.2%'));
    assert.match(html,/スルー寄りかな/);
  }
  const kan={...q,callOptions:[{code:0,values:[100,100,100,60,100]},{code:6,values:[0,0,0,40,0]}],callRecommendedActions:['pass','pass','pass','kan','pass']};
  assert.match(boardRenderer.judgmentMarkup(kan,{selectedModel:3}),/暗槓寄りかな/);
});
