import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {boardRenderer as renderer} from '../scripts/naga-board-runtime.mjs';

const models=[{name:'ニシキ'},{name:'ヒバカリ'},{name:'カガシ'}];
const rects=html=>[...html.matchAll(/<rect ([^>]+)>/g)].map(match=>Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]+)"/g)].map(a=>[a[1],a[2]])));
const close=(actual,expected)=>assert.ok(Math.abs(Number(actual)-expected)<1e-9,`${actual} != ${expected}`);
const q={decisionType:'call',models,callTile:'pin5',callOptions:[{code:0,values:[10,30,40]},{code:1,values:[65,20,40]},{code:3,values:[25,50,20]}]};

test('two chi patterns retain their separate probabilities, consumed tiles and original graph geometry',()=>{
  const before=JSON.stringify(q),html=renderer.judgmentMarkup(q);
  const bars=rects(html).filter(r=>r['data-judgment-code']);
  assert.equal(bars.length,6);
  close(bars[0].x,40);close(bars[0].width,68/3.7*1.7);close(bars[1].x,41+68/3.7*1.7);
  close(bars[0].height,202.5*.65);close(bars[0].y,202.5*.35);close(bars[3].x,151);
  assert.deepEqual(bars.map(r=>r.fill),['#64c8c8','#c8c8c8','#c8c8c8','#64c8c8','#c8c8c8','#c8c8c8']);
  assert.match(html,/y="101.25" width="260" height="2.5"/);
  for(const tile of ['pin6','pin7','pin3','pin4'])assert.match(html,new RegExp(`tiles/${tile}-66-90-l.png`));
  assert.match(html,/チー寄りかな/);assert.equal(JSON.stringify(q),before);
});

test('model selection changes the recommendation and top two patterns, with NAGA tie ordering',()=>{
  const value={...q,callOptions:[{code:0,values:[0,0,90]},{code:1,values:[20,70,3]},{code:2,values:[40,20,3]},{code:3,values:[40,10,4]}]};
  const codes=i=>[...new Set(rects(renderer.judgmentMarkup(value,{selectedModel:i})).filter(r=>r['data-judgment-code']).map(r=>r['data-judgment-code']))];
  assert.deepEqual(codes(0),['3','2']);assert.deepEqual(codes(1),['1','2']);
  assert.match(renderer.judgmentMarkup(value,{selectedModel:2}),/スルー！/);
});

test('pon, open kan, ankan and kakan retain their original tile or text labels and colors',()=>{
  // Synthetic boundary cases; actual report cases are exercised separately in browser QA.
  for(const [code,label,tiles,color] of [[4,'ポン',2,'#64c8c8'],[5,'カン',3,'#64c8c8'],[6,'暗槓',0,'#6464c8'],[7,'加槓',0,'#6464c8']]){
    const html=renderer.judgmentMarkup({...q,callTile:'aka1',callOptions:[{code:0,values:[5,30,40]},{code,values:[95,70,60]}]});
    assert.match(html,new RegExp(`${label}！`));assert.equal((html.match(/<image href="tiles\/man5/g)||[]).length,tiles);
    const bar=rects(html).find(r=>r['data-judgment-model']==='0');assert.equal(bar.fill,color);close(bar.x,60);close(bar.height,202.5*.95);
  }
  assert.deepEqual(renderer.callTiles('pin1',3),[]);assert.deepEqual(renderer.callTiles('ji1',1),[]);
});

test('missing raw pattern data stays generic; absent model data is never shown as zero confidence',()=>{
  const legacy={decisionType:'call',models,callTile:'pin5',callProbabilities:{pass:[30,80,100],call:[70,20,0]}};
  const html=renderer.judgmentMarkup(legacy);
  assert.match(html,/鳴く寄りかな/);assert.doesNotMatch(html,/<image|使って|チー/);
  assert.match(renderer.judgmentMarkup({...q,callPredictionAvailable:[false,true,true]}),/推奨データはありません/);
  const partial=renderer.judgmentMarkup({...q,callPredictionAvailable:[true,false,true]});assert.doesNotMatch(partial,/data-judgment-model="1"/);
});

test('riichi uses basis points and the original 50 percent boundary and red graph',()=>{
  const question={models,hasRiichiJudgment:true,reach:[5000,4999,10000]};
  assert.match(renderer.judgmentMarkup(question),/立直寄りかな/);
  assert.match(renderer.judgmentMarkup(question,{selectedModel:1}),/ダマ寄りかな/);
  assert.match(renderer.judgmentMarkup(question,{selectedModel:2}),/立直！/);
  const bar=rects(renderer.judgmentMarkup(question)).find(r=>r['data-judgment-model']==='0');close(bar.height,101.25);assert.equal(bar.fill,'#c86464');
});

test('the ordinary answer tile uses the same NAGA bar geometry, including a zero-valued model slot',()=>{
  const options={models,probabilities:{pin5:[60,0,40]},selectedModel:2};
  const board=rects(renderer.recommendationsMarkup({hand:{tiles:['pin5'],draw:null}},options)).filter(r=>r['data-recommendation-bar']);
  const tile=rects(renderer.tileRecommendationsMarkup('pin5',{...options,player:true,recommended:true}));
  const bars=tile.filter(r=>r['data-recommendation-bar']);assert.equal(bars.length,2);
  bars.forEach((bar,i)=>{close(bar.width,board[i].width);close(bar.height,board[i].height);close(bar.x,Number(board[i].x)-124);});
  assert.deepEqual(tile.filter(r=>r['data-recommendation-frame']).map(r=>r.stroke),['#7c3be6','#ff0000']);
});

test('revealing a repeated tile highlights only the recommended draw and the actual answer slot',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const source=html.match(/      function tileButtonV16\([^]*?\n      \}/)[0];
  const context={SCENE:{models:[{name:'ニシキ',recommendation:'man5'}],draw:'man5',handBeforeDraw:['man5','man5'],probabilities:{man5:[60]}},state:{revealed:true,selectedIndex:1,judgeModel:0},window:{NagaBoardV248:renderer},displayHandSlotsV212:()=>null,sortHandV20:tiles=>tiles,displayConcealedHandV143:q=>q.handBeforeDraw,tileLabel:x=>x,tileImage:x=>`<img src="tiles/${x}-66-90-l.png">`};
  vm.runInNewContext(source,context);
  const first=context.tileButtonV16('man5',0),answer=context.tileButtonV16('man5',1),draw=context.tileButtonV16('man5',2,true);
  assert.doesNotMatch(first,/data-recommendation-frame/);assert.match(answer,/data-recommendation-frame="player"/);assert.doesNotMatch(answer,/data-recommendation-frame="naga"/);assert.match(draw,/data-recommendation-frame="naga"/);
  context.state.revealed=false;assert.doesNotMatch(context.tileButtonV16('man5',1),/data-recommendation-bar|data-recommendation-frame/);
});

test('answer rendering uses the common graph and preserves both current and historical selections without changing scoring',()=>{
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const source=html.match(/      function renderAnswerV16\([^]*?\n      \}/)[0];
  const elements=Object.fromEntries(['answerStrip','commentsPanel','nextQuestionButton','nextQuestionBottomButton','answerTitle','answerDetail','answerComparison','riichiPanels'].map(id=>[id,{}]));
  const context={document:{getElementById:id=>elements[id]},state:{revealed:true,judgeModel:0},SCENE:{...q,actualCallAction:'pass'},window:{NagaBoardV248:renderer},renderAnswerConfirmationV41(){},renderChoiceScoreV16(){},recommendedRiichiV16:()=>false,selectedCallActionV112:()=> 'call',callActionRecommendationV112:()=> 'call',callBinaryKindV128:x=>x,callBinaryLabelV128:x=>x==='pass'?'スルー':'鳴く',normalizeCallActionV112:x=>x,tileLabel:x=>x,nextButtonLabelV44:()=> '次の問題へ',renderComments(){},refreshQuestionPollStatsV110(){}};
  vm.runInNewContext(source,context);context.renderAnswerV16();
  assert.match(elements.answerComparison.innerHTML,/あなたの選択[^]*鳴く/);assert.match(elements.answerComparison.innerHTML,/当時の選択[^]*スルー/);
  assert.match(elements.riichiPanels.innerHTML,/data-judgment-code="1"/);assert.doesNotMatch(source,/recordAnswer|fetch\(|state\.judgeModel\s*=/);
});
