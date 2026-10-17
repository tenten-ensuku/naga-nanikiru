import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const code=name=>{const match=html.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n      \\}`));assert.ok(match,name);return match[0];};
function search() {
  const context=vm.createContext({window:{}});
  vm.runInContext(fs.readFileSync(new URL('../public/reaction-search-v356.js',import.meta.url),'utf8'),context);
  return context.window.MinkiruReactionSearchV356;
}

test('reaction and comment searches intersect, navigation restores selection and queue keys distinguish filters',()=>{
  const api=search(),ctx=vm.createContext({window:{MinkiruReactionSearchV356:api,MinkiruCommentTagsV270:{matchesCommentSearch:(text,q)=>text.includes(q),normalizeSearchQuery:q=>q||''}},
    questionCommentSearchTextV284:q=>q.text,learningOrderV189:'sequential',learningGenresV189:new Set(['discard']),learningHistoryFiltersV189:new Set(['unanswered']),learningCommentTagV273:'',
    menuSearchV44:'',menuCommentTagV270:'',menuStatusFiltersV92:[],menuTypeV44:'all',menuRangeV60:'all',menuFavoritesOnlyV137:false,menuRenderLimitV119:40,menuOrderV92:'sequential',MENU_RENDER_BATCH_V119:40,
    LEARNING_GENRE_ORDER_V189:['discard'],LEARNING_HISTORY_ORDER_V189:['unanswered'],document:{getElementById:()=>null,querySelectorAll:()=>[]}});
  vm.runInContext(['questionMatchesCommentSearchV284','learningFilterKeyV335','navigationFiltersV234','restoreNavigationFiltersV234'].map(code).join('\n'),ctx);
  const base=ctx.learningFilterKeyV335(),q={text:'押し引き',reactionKeysV356:['like']};
  assert.equal(ctx.questionMatchesCommentSearchV284(q,'押し'),true);
  api.choose('like');assert.equal(ctx.questionMatchesCommentSearchV284(q,'押し'),true);
  assert.equal(ctx.questionMatchesCommentSearchV284(q,'安全'),false);
  assert.equal(ctx.questionMatchesCommentSearchV284({text:'押し引き',reactionKeysV356:['important']},''),false);
  assert.notEqual(ctx.learningFilterKeyV335(),base);
  const snapshot=ctx.navigationFiltersV234();api.choose('important');ctx.restoreNavigationFiltersV234(snapshot);assert.equal(api.selected,'like');
  api.choose('');assert.equal(ctx.learningFilterKeyV335(),base);
  api.choose('<img>');assert.equal(api.selected,'');
  assert.deepEqual(Array.from(api.fromSummary({question:{hard:{reactionCount:1}},comments:{c:{like:{reactionCount:0},custom_abc:{reactionCount:2}}}},id=>id==='hard'?{storageKey:'difficult'}:null)),['difficult','custom_abc']);
});

test('select all skips duplicates and unsupported boards, clear all preserves drafts and updates both toolbars',()=>{
  const candidates=[{id:'a',ready:true},{id:'b',ready:true,duplicate:true},{id:'c',ready:false},{id:'d',ready:true}];
  const checks=candidates.map((q,index)=>({dataset:{generatorSelect:String(index)},checked:false,listeners:{},addEventListener(type,fn){this.listeners[type]=fn;}}));
  const action=all=>({disabled:false,textContent:'',listeners:{},hasAttribute:attr=>all&&attr==='data-generator-select-all',addEventListener(type,fn){this.listeners[type]=fn;}});
  const all=[action(true),action(true)],clear=[action(false),action(false)],add=[action(false),action(false)],draft={value:'入力中の解説'};
  const source=code('bindGeneratorCandidateInputsV44');
  const ctx=vm.createContext({doraSheenV333:{observe(){}},generatorCandidatesV44:candidates,generatorSelectedCandidatesV158:new Set(),generatorCommentDraftsV273:new Map([['a',draft.value]]),
    generatorCandidateStateV249:c=>({boardReady:c.ready,duplicate:c.duplicate}),window:{},document:{querySelectorAll:selector=>selector==='[data-generator-select]'?checks:selector==='[data-generator-select-all], [data-generator-clear-all]'?[...all,...clear]:selector==='[data-generator-add-selected]'?add:[]},
    syncGeneratorBatchToolbarV356:()=>{for(const button of add)button.textContent='選択した'+ctx.generatorSelectedCandidatesV158.size+'問を追加';}});
  vm.runInContext(source,ctx);ctx.bindGeneratorCandidateInputsV44();
  all[1].listeners.click();assert.deepEqual(Array.from(ctx.generatorSelectedCandidatesV158),[0,3]);assert.deepEqual(checks.map(c=>c.checked),[true,false,false,true]);assert.equal(add[0].textContent,'選択した2問を追加');
  checks[0].checked=false;checks[0].listeners.change({currentTarget:checks[0]});assert.deepEqual(Array.from(ctx.generatorSelectedCandidatesV158),[3]);
  clear[0].listeners.click();assert.equal(ctx.generatorSelectedCandidatesV158.size,0);assert.ok(checks.every(c=>!c.checked));assert.equal(ctx.generatorCommentDraftsV273.get('a'),draft.value);
});

test('all-question study honors reaction-only conditions while unanswered and weak remain independent',()=>{
  const api=search(),rows=[{id:'a',reactionKeysV356:['like']},{id:'b',reactionKeysV356:['important']}];api.choose('important');
  const ctx=vm.createContext({window:{MinkiruReactionSearchV356:api},learningLatestAnswersV189:()=>new Map(),learningScopeQuestionsV184:()=>rows,isPlayableV16:()=>true,learningQuestionMatchesGenreV189:()=>true,learningQuestionMatchesHistoryV189:()=>true,learningCommentTagV273:'',learningWeakQuestionsV189:()=>rows,questionKeyV16:q=>q.id,questionMatchesCommentSearchV284:q=>api.matches(q)});
  vm.runInContext(code('learningCandidatesV189'),ctx);
  assert.deepEqual(Array.from(ctx.learningCandidatesV189('all',{ordered:false}),q=>q.id),['b']);
  assert.equal(ctx.learningCandidatesV189('unanswered',{ordered:false}).length,2);assert.equal(ctx.learningCandidatesV189('weak',{ordered:false}).length,2);
});
