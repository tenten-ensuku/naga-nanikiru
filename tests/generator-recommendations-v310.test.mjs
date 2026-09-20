import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const names = ['normalizeCallActionV112', 'callActionLabelV112', 'questionCallActionV112',
  'questionCallProbabilityV112', 'questionCallRecommendationProbabilityV308',
  'generatorCandidateRecommendationMarkupV308', 'generatorCandidateBarsMarkupV310',
  'generatorCandidateJudgmentMarkupV310', 'generatorCandidateModelsMarkupV158', 'generatorCandidateChoiceMarkupV158', 'generatorCandidatePanelMarkupV310', 'toggleGeneratorRecommendationsV310',
  'preferredGeneratorModelV300', 'generatorCandidateModelIndexV311', 'generatorCandidateOverlayV311', 'changeGeneratorPreviewModelV311'];
const source = names.map(name => html.match(new RegExp(`    (?:  )?function ${name}\\([^]*?\\n    (?:  )?\\}`))?.[0] || assert.fail(name)).join('\n');
function harness(reported = ['ニシキ', 'カガシ']) {
  const context = { generatorReportedModelNamesV46: () => reported,
    modelColorByNameV16: { 'ニシキ': 'model-nishiki', 'カガシ': 'model-kagashi' },
    escapeHtml: value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    tileLabel: tile => tile, tileImage: tile => `<img src="tiles/${tile}-66-90-l.png">`,
    generatorRecommendationOpenV310: new Set(), generatorCandidatesV44: [], hasJsonBoardV248: candidate => !!candidate.boardScene,
    generatorReportV44: {}, generatorPreviewModelsV311: new Map(), selectedGeneratorModelNamesV46: () => ['ニシキ']
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('../public/naga-board-v248.js', import.meta.url),'utf8'), context);
  context.window = { NagaBoardV248: context.NagaBoardV248 };
  vm.runInContext(source, context);
  return context;
}
const models = [{name:'ニシキ'}, {name:'オメガ'}, {name:'カガシ'}];

test('bars use canonical hand positions, original model indices, percent units and distinct red tiles', () => {
  const h=harness(),candidate={id:'discard',models,boardScene:{hand:{tiles:['man5',null,'aka1'],draw:'pin3'}},
    probabilities:{man5:[60,99,20],aka1:[10,99,40],pin3:[80,99,0]}};
  const before=structuredClone(candidate),markup=h.generatorCandidateBarsMarkupV310(candidate,2);
  assert.match(markup,/data-generator-recommendation-content-v310="2" hidden/);
  assert.equal((markup.match(/<rect /g)||[]).length,5);
  assert.doesNotMatch(markup,/オメガ|99\.0%/);
  assert.match(markup,/ニシキ：60\.0%/);
  assert.match(markup,/カガシ：40\.0%/);
  const bars=[...markup.matchAll(/x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(m=>m.slice(1).map(Number));
  const positions=h.NagaBoardV248.handPositions(candidate.boardScene);
  assert.equal(bars[0][1],positions[0].y-24);
  assert.equal(bars[2][0]-bars[0][0],positions[1].x-positions[0].x);
  assert.equal(bars[4][0]-bars[0][0],positions[2].x-positions[0].x);
  assert.deepEqual(candidate,before);
});

test('call previews show decision UI, target tile, kan actions and rates, without discarded-tile bars', () => {
  const h=harness(),candidate={id:'kan',decisionType:'call',models,callTile:'ji1',actualCallAction:'pass',
    callRecommendedActions:['kan','call','pass'],callActionProbabilities:{call:[0,90,0],kan:[75,0,5],pass:[25,10,95]}};
  const before=structuredClone(candidate),markup=h.generatorCandidatePanelMarkupV310(candidate,0);
  assert.equal(h.generatorCandidateBarsMarkupV310(candidate,0),'');
  assert.match(markup,/aria-label="副露判断"/); assert.match(markup,/tiles\/ji1-66-90-l.png/);
  const actions=h.generatorCandidateModelsMarkupV158(candidate);
  assert.match(actions,/ニシキの推奨：カン/); assert.match(actions,/カガシの推奨：スルー/);
  assert.match(markup,/>75\.0%<\/strong>/); assert.match(h.generatorCandidateChoiceMarkupV158(candidate),/プレイヤー選択：スルー/);
  assert.deepEqual(candidate,before);
});

test('riichi uses the same 5000 basis-point boundary and ordinary discards do not show judgment controls', () => {
  const h=harness();
  const markup=h.generatorCandidateJudgmentMarkupV310({models,hasRiichiJudgment:true,actualReach:true,reach:[5000,9000,4999]});
  assert.match(markup,/aria-label="立直判断"/); assert.match(markup,/ニシキ<strong>立直/);
  assert.match(markup,/カガシ<strong>ダマ/); assert.match(markup,/当時の選択：立直/);
  assert.equal(h.generatorCandidateJudgmentMarkupV310({models,reach:[0,0,0]}),'');
  const missing=h.generatorCandidateJudgmentMarkupV310({models,hasRiichiJudgment:true,reach:[null,5000,null]});
  assert.match(missing,/ニシキ<strong>データなし/); assert.doesNotMatch(missing,/ニシキ<strong>スルー/);
});

test('toggle affects only its candidate and preserves drafts, selection, board and data without re-rendering', () => {
  const h=harness(),candidate={id:'one',boardScene:{},probabilities:{man1:[20]}};
  const before=structuredClone(candidate);h.generatorCandidatesV44=[candidate];
  const children=[{hidden:true},{hidden:true}],other={hidden:true};
  const draft={value:'入力途中の解説'},selection={checked:true},board={unchanged:true};
  const article={querySelectorAll:()=>children,draft,selection,board};
  const button={dataset:{generatorRecommendationsV310:'0'},setAttribute(key,value){this[key]=value;},closest:()=>article};
  h.toggleGeneratorRecommendationsV310(button);
  assert.equal(button['aria-expanded'],'true'); assert.ok(children.every(el=>!el.hidden));
  assert.equal(h.generatorRecommendationOpenV310.has('one'),true);assert.equal(other.hidden,true);
  assert.equal(article.draft,draft);assert.equal(draft.value,'入力途中の解説');assert.equal(selection.checked,true);assert.equal(article.board,board);
  h.toggleGeneratorRecommendationsV310(button);
  assert.equal(button['aria-expanded'],'false');assert.ok(children.every(el=>el.hidden));assert.deepEqual(candidate,before);
  assert.doesNotMatch(source.match(/function toggleGeneratorRecommendationsV310[^]*?\n      \}/)[0],/innerHTML|fetch\(|SCENE|invokeSharedMutation|renderGeneratorCandidates/);
});
