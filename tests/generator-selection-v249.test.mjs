import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {generator} from '../scripts/naga-generator-runtime.mjs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const names = ['currentGeneratorDestinationV130', 'canAddGeneratedQuestionV130',
  'explainGeneratorSaveBlockedV249', 'generatorCandidateStateV249',
  'selectedGeneratorCandidateIndexesV249', 'renderGeneratorBatchToolbarV158',
  'generatorCandidateSourceMarkupV309', 'renderGeneratorCandidatesV44', 'generatorCommentMarkupV273', 'addSelectedGeneratorQuestionsV158', 'addGeneratedQuestionV44'];
const source = names.map(name => {
  const match = html.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n      \\}`));
  assert.ok(match, name); return match[0];
}).join('\n');

function harness() {
  const events = [], select = { value: '', scrollIntoView: () => events.push('scroll'), focus: () => events.push('focus') };
  const context = vm.createContext({
    document: { getElementById: id => id === 'generatorDestinationSelect' ? select : null },
    generatorDestinationV130: '', generatorDestinationRowsV130: () => [
      {share_slug:'editable',can_edit:true,title:'編集できる本'},
      {share_slug:'readonly',can_edit:false,title:'閲覧だけの本'}],
    collectionDisplayNameV101: row => row.title, supabaseSessionV46: {user:{id:'owner'}},
    sharedCollectionV46: {share_slug:'editable'}, questionsV16: [],
    generatorCandidatesV44: [{id:'a',boardScene:{},playerName:'確認用',tv:1},{id:'b',boardScene:{},tv:2}],
    generatorSelectedCandidatesV158: new Set(), generatorAddedKeysV130: new Set(), generatorDuplicateKeysV153: new Set(), generatorCommentDraftsV273: new Map(),
    generatorReportV44: {},
    hasJsonBoardV248: candidate => Boolean(candidate.boardScene) && !candidate.invalid,
    prepareJsonBoardV248: candidate => !candidate.invalid, generatedHandIsValidV237: () => true,
    escapeHtml: value => String(value), questionTypeV44: () => '打牌判断',
    generatorCandidateChoiceMarkupV158: () => '', generatorCandidateModelsMarkupV158: () => '', generatorCandidateRecommendationMarkupV308: () => '',
    window: {NagaGeneratorV44:generator,NagaBoardV248:{markup:()=>'<svg></svg>'},NagaGenerationConfirmV241:{ask:async()=>{events.push('confirm');return true;}}},
    setGeneratorStatusV44: message => events.push(message), setGeneratorStageV159: () => {},
    bindGeneratorCandidateInputsV44: () => {}, invokeSharedMutationV47: () => {throw Error('unexpected write');},
  });
  vm.runInContext(fs.readFileSync(new URL('../public/comment-tools-v274.js', import.meta.url), 'utf8'), context);
  context.window.MinkiruCommentToolsV274 = context.MinkiruCommentToolsV274;
  vm.runInContext(html.match(/const GENERATOR_DETECTION_V300 = \{[\s\S]*?\n      \};/)[0], context);
  vm.runInContext(source, context);
  return {context, select, events, run: code => vm.runInContext(code, context)};
}

test('candidate selection is enabled without a destination; save action asks for one', () => {
  const h = harness(); h.context.generatorAddedKeysV130.add('a::local');
  const markup = h.run('renderGeneratorCandidatesV44()');
  assert.doesNotMatch(markup.match(/<input[^>]+data-generator-select="0"[^>]*>/)[0], /disabled/);
  assert.match(markup, /保存先を選ぶ/); assert.doesNotMatch(markup, /編集権限が必要/);
  h.context.generatorSelectedCandidatesV158.add(0);
  const toolbar = h.run('renderGeneratorBatchToolbarV158()');
  assert.match(toolbar, /保存先を選んで1問を追加/);
  assert.doesNotMatch(toolbar.match(/<button[^>]+data-generator-add-selected[^>]*>/)[0], /disabled/);
});

test('each preview links to its own NAGA scene in a separate tab, including invalid-board candidates', () => {
  const h=harness(),url='https://naga.dmv.nico/htmls/report_viewer.html?report_id=preview-test&tw=3&ts=2&tv=83';
  h.context.generatorCandidatesV44[0].nagaUrl=url;
  h.context.generatorCandidatesV44[1].nagaUrl=url.replace('tv=83','tv=84');
  h.context.generatorCandidatesV44[1].invalid=true;
  const markup=h.run('renderGeneratorCandidatesV44()');
  assert.ok(markup.includes(`href="${url}"`));assert.ok(markup.includes(`href="${url.replace('tv=83','tv=84')}"`));
  assert.equal((markup.match(/target="_blank" rel="noopener noreferrer"/g)||[]).length,2);
  assert.doesNotMatch(markup,/data-generator-capture|盤面を再描画|プレビューを読み込む/);
  assert.match(markup, /data-generator-add="1"[^>]*disabled/);
});

test('preview source links exclude unsafe, missing and non-scene URLs', () => {
  const h=harness();
  for(const nagaUrl of [undefined,'javascript:alert(1)','https://example.com/htmls/report_viewer.html?report_id=test&tw=0&ts=0&tv=1','https://naga.dmv.nico/htmls/report_viewer.html?report_id=test']) {
    assert.equal(h.context.generatorCandidateSourceMarkupV309({nagaUrl}), '');
  }
});

test('single and batch save without destination focus picker, preserve selection, never confirm/write', async () => {
  const h = harness(); h.context.generatorSelectedCandidatesV158.add(0);
  await h.run('addSelectedGeneratorQuestionsV158()'); await h.run('addGeneratedQuestionV44(0)');
  assert.equal(h.context.generatorSelectedCandidatesV158.has(0), true);
  assert.equal(h.events.filter(e => e === 'focus').length, 2);
  assert.ok(h.events.some(e => e.includes('保存先を選んで')));
  assert.ok(!h.events.includes('confirm')); assert.ok(!h.events.some(e => e.includes('権限')));
});

test('unauthorized destination allows drafting but denies both save paths', async () => {
  const h = harness(); h.select.value = 'readonly'; h.context.generatorSelectedCandidatesV158.add(0);
  h.context.generatorCommentDraftsV273.set('a', '保存先を選ぶ前の解説');
  const markup = h.run('renderGeneratorCandidatesV44()');
  assert.doesNotMatch(markup.match(/<input[^>]+data-generator-select="0"[^>]*>/)[0], /disabled/);
  assert.match(markup, /編集権限が必要/);
  assert.match(markup, /保存先を選ぶ前の解説/);
  assert.doesNotMatch(markup.match(/<textarea[^>]+data-generator-comment-v273="0"[^>]*>/)[0], /disabled/);
  await h.run('addSelectedGeneratorQuestionsV158()'); await h.run('addGeneratedQuestionV44(0)');
  assert.equal(h.events.filter(e => e.includes('権限')).length, 2); assert.ok(!h.events.includes('confirm'));
  h.select.value = 'editable'; h.context.supabaseSessionV46 = null;
  await h.run('addSelectedGeneratorQuestionsV158()'); assert.ok(!h.events.includes('confirm'));
});

test('destination changes preserve draft selections and exclude duplicate/invalid candidates from counts', () => {
  const h = harness(); h.context.generatorSelectedCandidatesV158.add(0); h.context.generatorSelectedCandidatesV158.add(1);
  h.context.generatorAddedKeysV130.add('a::editable'); h.context.generatorCandidatesV44[1].invalid = true;
  assert.equal(h.run('selectedGeneratorCandidateIndexesV249().length'), 1);
  h.select.value = 'editable'; assert.equal(h.run('selectedGeneratorCandidateIndexesV249().length'), 0);
  const markup = h.run('renderGeneratorCandidatesV44()');
  for (const input of markup.matchAll(/<input[^>]+data-generator-select="\d+"[^>]*>/g)) assert.match(input[0], /disabled/);
  h.select.value = 'local'; assert.equal(h.run('selectedGeneratorCandidateIndexesV249().length'), 1);
  assert.equal(h.context.generatorSelectedCandidatesV158.size, 2);
});

test('authorized batch confirms only eligible candidates and clears only successfully saved selections', async () => {
  const h = harness(); h.select.value = 'editable';
  h.context.generatorSelectedCandidatesV158.add(0); h.context.generatorSelectedCandidatesV158.add(1);
  h.context.generatorDuplicateKeysV153.add('b::editable'); const saved = [];
  h.context.window.NagaGenerationConfirmV241.ask = async (_document,destination,count) => {assert.equal(count,1);assert.equal(destination.shareSlug,'editable');return true;};
  h.context.addGeneratedQuestionV44 = async (index,options) => {saved.push(index);assert.equal(options.expectedDestinationKey,'editable');return true;};
  await h.run('addSelectedGeneratorQuestionsV158()'); assert.deepEqual(saved,[0]);
  assert.equal(h.context.generatorSelectedCandidatesV158.has(0),false); assert.equal(h.context.generatorSelectedCandidatesV158.has(1),true);
});

test('destination event re-renders without clearing selections and checkbox keeps keyboard focus', () => {
  const handler = html.slice(html.indexOf('document.getElementById("generatorDestinationSelect")?.addEventListener("change"'), html.indexOf('function handleMenuGridClickV16'));
  assert.doesNotMatch(handler, /generatorSelectedCandidatesV158\.clear/);
  assert.match(handler, /renderGeneratorCandidatesV44\(\)/);
  const selection=html.slice(html.indexOf('document.querySelectorAll("[data-generator-select]").forEach'),html.indexOf('document.querySelectorAll("[data-generator-add]").forEach'));
  assert.doesNotMatch(selection,/results\.innerHTML|renderGeneratorCandidatesV44|bindGeneratorCandidateInputsV44/);
  assert.match(selection,/button\.textContent = next\.textContent/);
  assert.match(selection,/button\.disabled = next\.disabled/);
});
