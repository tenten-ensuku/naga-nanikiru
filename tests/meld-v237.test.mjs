import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
const context = {URL,URLSearchParams}; context.globalThis = context;
for(const file of ['naga-generator-v44.js','hand-mask-v237.js']) vm.runInNewContext(await fs.readFile(new URL('../public/'+file,import.meta.url),'utf8'),context);
const api = context.NagaGeneratorV44;

test('null, absent, or empty previous meld counts do not turn a second/third call into a first call',()=>{
  for(const count of [2,3,4]) for(const value of [null,undefined,'']) {
    const q={decisionType:'discard',predictionType:'pon',immediateCallPreviousMeldCount:value,melds:Array.from({length:count},()=>({type:'pon'}))};
    assert.equal(api.immediateCallPreviousMeldCount(q),count-1);
  }
});

test('a kan consumes one group; the replacement draw does not reduce concealed tiles by four',()=>{
  const q={decisionType:'discard',predictionType:'tsumo',handBeforeDraw:['man1','man2','man3','man8','man9','pin2','pin2'],draw:'pin2',actualDiscard:'man9',melds:[{type:'chi',pai:'aka3',consumed:['sou6','sou7']},{type:'daiminkan',pai:'ji5',consumed:['ji5','ji5','ji5']}]};
  assert.equal(api.validateDiscardHand(q).valid,true);
  const broken={...q,handBeforeDraw:[...q.handBeforeDraw,'ji5','ji5','ji5']};
  assert.deepEqual(Array.from(api.validateDiscardHand(broken).errors),['concealed-tile-count','tile-more-than-four']);
  const copied=JSON.stringify(q); api.validateDiscardHand(q); assert.equal(JSON.stringify(q),copied);
});

test('chi after an earlier kan preserves canonical hand and restores only current consumed slots',()=>{
  const q={decisionType:'discard',predictionType:'chi',actualDiscard:'man1',handBeforeDraw:['man1','man2','man3','man4','man5','man6','pin1','pin2'],melds:[{type:'daiminkan',pai:'ji5',consumed:['ji5','ji5','ji5']},{type:'chi',pai:'sou3',consumed:['sou1','sou2']}]};
  assert.equal(api.validateDiscardHand(q).valid,true);
  assert.equal(api.displayConcealedHand(q).length,8);
  const legacy={...q,handBeforeDraw:[...q.handBeforeDraw,'sou1','sou2']};
  assert.equal(api.displayConcealedHand(legacy).length,8);
  assert.equal(api.displayConcealedHandSlots(legacy).filter(x=>x==null).length,2);
});

test('rejects malformed kan groups, unavailable discard, and five copies including a red five',()=>{
  const q={handBeforeDraw:['man5','man5','aka1','man1','man2','man3','pin1'],draw:'pin2',actualDiscard:'sou9',melds:[{type:'pon',pai:'man5',consumed:['man5','man5']},{type:'ankan',consumed:['ji5','ji5','ji5']}]};
  const issues=api.validateDiscardHand(q).errors;
  for(const issue of ['meld-tile-count','tile-more-than-four','discard-not-in-hand']) assert.ok(issues.includes(issue));
});

test('real NAGA kakan format removes only the added tile and preserves the red pon',()=>{
  const entries=[{info:{msg:{type:'start_kyoku',tehais:[['5pr','5p','1m','2m','3m','4m','6m','7m','8m','9m','1s','2s','3s'],[],[],[]]}}},
    {info:{msg:{type:'pon',actor:0,pai:'5p',consumed:['5pr','5p']}}},
    {info:{msg:{type:'tsumo',actor:0,pai:'5p'}}},
    {info:{msg:{type:'kakan',actor:0,pai:'5p',consumed:['5pr','5p','5p']}}}];
  const s=api.replayKyoku(entries,4,0);
  assert.equal(s.melds.length,1);assert.equal(s.hand.length,11);
  assert.deepEqual(Array.from(api.meldDisplayTiles(s.melds[0])),['pin5','aka2','pin5','pin5']);
  assert.ok(!s.hand.includes('pin5')&&!s.hand.includes('aka2'));
});

test('the Worker rejects invalid newly generated hands before any insert',async()=>{
  const {validateStoredHand}=await import('../cloudflare/question-validation-v237.mjs');
  assert.throws(()=>validateStoredHand({handBeforeDraw:['ji5'],draw:null,melds:[]},'discard'),e=>e.code==='question_hand_invalid');
  assert.equal(validateStoredHand({handBeforeDraw:['man1','man2','man3','man4','man5','man6','man7','man8','man9','pin1','pin2','pin3','ji1'],melds:[]},'call').valid,true);
});

test('riichi and riichi-selected labels have intrinsic single-line width',async()=>{
  const html=await fs.readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const css=html.match(/^\s*\.riichi-button\s*\{([^}]+)\}/m)[1];
  assert.match(css,/white-space:\s*nowrap/);assert.match(css,/width:\s*max-content/);assert.match(css,/flex:\s*0 0 auto/);
});

test('detects the source panel through to the bottom, independently of opponent tiles at far left',()=>{
  const width=1400,height=1300,pixels=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<pixels.length;i+=4) pixels.set([13,92,142,255],i);
  for(const panelWidth of [716,540]) {
    const data=pixels.slice();
    for(let y=1030;y<height;y++) for(let x=160;x<160+panelWidth;x++) data.set([3,55,87,255],(y*width+x)*4);
    for(let y=1100;y<height;y++) for(let x=0;x<80;x++) data.set([250,250,250,255],(y*width+x)*4);
    const mask=context.NagaHandMaskV237.detectSourcePanel(data,width,height,null);
    assert.ok(mask); assert.equal(mask.left*width/100,160); assert.equal(mask.top*height/100,1030);
    assert.ok(Math.abs(mask.width*width/100-panelWidth)<1e-8); assert.equal(mask.top+mask.height,100);
  }
  const fallback={review:true};assert.equal(context.NagaHandMaskV237.detectSourcePanel(pixels,width,height,fallback),fallback);
});

test('input and answer keep detected geometry, normal post-call detection stays in place, generation stops invalid candidates',async()=>{
  const html=await fs.readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(html,/const APP_VERSION = 239/);
  assert.match(html,/questionKeyV16\(activeHandQuestionV18\) === questionKeyV16\(question\) && activeHandMaskV18/);
  assert.match(html,/if \(isImmediateCallDiscardV132\(SCENE\) && globalThis\.NagaHandMaskV237\)/);
  assert.match(html,/hasSelfMeldsV17 \? detectHandMaskV17/);
  assert.equal(html.match(/if \(!generatedHandIsValidV237\(candidate\)\) return false;/g)?.length,2);
});
