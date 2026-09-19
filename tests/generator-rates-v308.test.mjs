import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const names=['questionCallProbabilityV112','questionCallRecommendationProbabilityV308','callRecommendationProbabilityV112','generatorCandidateRecommendationMarkupV308'];
const source=names.map(name=>html.match(new RegExp(`    (?:  )?function ${name}\\([^]*?\\n    (?:  )?\\}`))?.[0] || assert.fail(name)).join('\n');
function harness(reported=['ニシキ','カガシ']) {
  const context={SCENE:{callActionProbabilities:{call:[99],kan:[0]}},generatorReportedModelNamesV46:()=>reported,
    modelColorByNameV16:{'ニシキ':'model-nishiki','カガシ':'model-kagashi'},escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')};
  vm.runInNewContext(source,context);
  return context;
}
const models=[{name:'ニシキ'},{name:'カガシ'}];
test('preview converts reach basis points, includes zero and omits unreported models',()=>{
  const h=harness(),candidate={models:[...models,{name:'オメガ'}],reach:[8345,0,10000],hasRiichiJudgment:true};
  const before=structuredClone(candidate),markup=h.generatorCandidateRecommendationMarkupV308(candidate);
  assert.match(markup,/立直推奨度/);assert.match(markup,/aria-valuenow="83\.45"/);assert.match(markup,/>83\.5%<\/strong>/);
  assert.match(markup,/>0\.0%<\/strong>/);assert.doesNotMatch(markup,/オメガ|100\.0%/);assert.deepEqual(candidate,before);
});
test('preview uses each candidate, not the question currently open, and shows call rate even for pass recommendation',()=>{
  const h=harness(),candidate={decisionType:'call',models,callRecommendedActions:['pass','call'],
    callActionProbabilities:{call:[15,85],kan:[0,0],pass:[85,15]},callPredictionAvailable:[true,true]};
  const before=structuredClone(candidate),markup=h.generatorCandidateRecommendationMarkupV308(candidate);
  assert.match(markup,/副露推奨度/);assert.match(markup,/>15\.0%<\/strong>/);assert.match(markup,/>85\.0%<\/strong>/);
  assert.doesNotMatch(markup,/99\.0%/);assert.equal(h.callRecommendationProbabilityV112(0),99);assert.deepEqual(candidate,before);
});
test('kan preview uses the same non-pass probability as the answer screen, without summing call and kan',()=>{
  const h=harness(),candidate={decisionType:'call',models,callActionProbabilities:{call:[5,0],kan:[55,99.11],pass:[40,.89]}};
  const markup=h.generatorCandidateRecommendationMarkupV308(candidate);
  assert.match(markup,/>55\.0%<\/strong>/);assert.match(markup,/>99\.1%<\/strong>/);assert.doesNotMatch(markup,/>60\.0%/);
  h.SCENE=candidate;assert.equal(h.callRecommendationProbabilityV112(0),55);
});
test('legacy probabilities remain readable',()=>{
  const h=harness();
  assert.match(h.generatorCandidateRecommendationMarkupV308({decisionType:'call',models,callProbabilities:{call:[12.34,0]}}),/>12\.3%<\/strong>/);
  assert.match(h.generatorCandidateRecommendationMarkupV308({decisionType:'call',models,callOptions:[{code:0,values:[20,10]},{code:4,values:[80,90]}]}),/>80\.0%<\/strong>/);
});
test('unavailable predictions are distinct from genuine zero rates',()=>{
  const h=harness();
  const reach=h.generatorCandidateRecommendationMarkupV308({models,actualReach:true,reach:[0,null]});
  assert.match(reach,/>0\.0%<\/strong>/);assert.match(reach,/データなし/);
  const call=h.generatorCandidateRecommendationMarkupV308({decisionType:'call',models,callActionProbabilities:{call:[0,0]},callPredictionAvailable:[true,false]});
  assert.match(call,/>0\.0%<\/strong>/);assert.equal((call.match(/データなし/g)||[]).length,1);
  assert.doesNotMatch(h.generatorCandidateRecommendationMarkupV308({decisionType:'call',models}),/role="meter"/);
});
test('ordinary discards do not acquire a riichi section and preview rendering includes the section',()=>{
  const h=harness();assert.equal(h.generatorCandidateRecommendationMarkupV308({models,reach:[0,0],actualReach:false}), '');
  assert.match(html,/\$\{generatorCandidateRecommendationMarkupV308\(candidate\)\}/);
});
