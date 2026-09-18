import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const names = ['learningLatestAnswersV189', 'learningQuestionGenreKeyV189', 'learningQuestionMatchesGenreV189',
  'learningQuestionHistoryKeyV189', 'learningQuestionMatchesHistoryV189', 'bookListFilteredV281',
  'bookListFiltersActiveV281', 'resetBookListConditionsV281', 'recentScoresV16', 'restoreNavigationFiltersV234', 'navigationFiltersV234'];
function fixture() {
  const types = {discard:'打牌判断', riichi:'リーチ判断', call:'副露判断'};
  const context = vm.createContext({
    Date, Math, Set, Map, window: {MinkiruCommentTagsV270:{normalizeTag:value=>String(value||'')}},
    document: {getElementById:()=>null,querySelectorAll:()=>[]},
    userStateV16:{answerHistory:[]}, questionKeyV16:q=>q.id, questionTypeV44:q=>types[q.type],
    questionCommentTagsV270:q=>q.tags||[], normalizeScoreMarkV159:mark=>mark==='○'?'〇':mark||'',
    menuQuestionSortKeyV99:q=>q.number, navigationScopeV234:()=> 'book-a',
    learningOrderV189:'sequential', learningGenresV189:new Set(Object.keys(types)),
    learningHistoryFiltersV189:new Set(['unanswered','×','△','〇','◎']), learningCommentTagV273:'',
    LEARNING_GENRE_ORDER_V189:Object.keys(types), LEARNING_HISTORY_ORDER_V189:['unanswered','×','△','〇','◎'],
    bookListShuffleV281:new Map(), bookListShuffleScopeV281:'', refreshBookListConditionsV281:()=>{},
    menuSearchV44:'',menuCommentTagV270:'',menuStatusFiltersV92:[],menuTypeV44:'all',menuRangeV60:'all',
    menuFavoritesOnlyV137:false,menuRenderLimitV119:40,menuOrderV92:'sequential',MENU_RENDER_BATCH_V119:40
  });
  for (const name of names) {
    const source=html.match(new RegExp(`^      function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^      \\}`, 'm'))?.[0];
    assert.ok(source,name); vm.runInContext(source,context);
  }
  return context;
}
const questions=[{id:'a',number:3,type:'discard',tags:['押し引き']},{id:'b',number:1,type:'call',tags:['押し引き']},
  {id:'c',number:4,type:'riichi',tags:[]},{id:'d',number:2,type:'call',tags:['押し引き']}];
const ids=items=>Array.from(items,q=>q.id);
test('list intersects shared genre, latest grade and tag; latest is determined by time',()=>{
  const ctx=fixture();ctx.userStateV16.answerHistory=[
    {questionKey:'b',scoreMark:'〇',answeredAt:'2026-09-18T12:00:00Z'},
    {questionKey:'d',scoreMark:'×',answeredAt:'2026-09-18T12:00:00Z'},
    {questionKey:'b',scoreMark:'×',answeredAt:'2026-09-17T12:00:00Z'}];
  const original=JSON.stringify({questions,history:ctx.userStateV16.answerHistory});
  ctx.learningGenresV189=new Set(['call']);ctx.learningHistoryFiltersV189=new Set(['〇']);ctx.learningCommentTagV273='押し引き';
  assert.deepEqual(ids(ctx.bookListFilteredV281(questions)),['b']);
  ctx.learningHistoryFiltersV189=new Set(['×']);assert.deepEqual(ids(ctx.bookListFilteredV281(questions)),['d']);
  ctx.learningCommentTagV273='別のタグ';assert.deepEqual(ids(ctx.bookListFilteredV281(questions)),[]);
  assert.equal(JSON.stringify({questions,history:ctx.userStateV16.answerHistory}),original);
});
test('unanswered is independent of wrong answers and keeps sequential problem order',()=>{
  const ctx=fixture();ctx.userStateV16.answerHistory=[{questionKey:'b',scoreMark:'×',answeredAt:'2026-09-18'}];
  ctx.learningHistoryFiltersV189=new Set(['unanswered']);
  assert.deepEqual(ids(ctx.bookListFilteredV281(questions)),['d','a','c']);
});
test('random order remains stable on return and the source array stays intact',()=>{
  const ctx=fixture();ctx.learningOrderV189='random';let n=0;
  ctx.Math={random:()=>[.9,.4,.1,.7,.2,.8,.3,.6][n++]};
  assert.deepEqual(ids(ctx.bookListFilteredV281(questions)),['c','b','d','a']);
  assert.deepEqual(ids(ctx.bookListFilteredV281(questions)),['c','b','d','a']);assert.equal(n,4);
  ctx.navigationScopeV234=()=> 'book-b';ctx.bookListFilteredV281(questions);assert.equal(n,8);
  assert.deepEqual(ids(questions),['a','b','c','d']);
});
test('recent result display uses newest first without deleting the complete saved history',()=>{
  const ctx=fixture();ctx.userStateV16.answerHistory=[1,5,3,6,2,4].map(n=>({questionKey:'a',scoreMark:n%2?'×':'○',answeredAt:`2026-09-${10+n}`,attempt:n}));
  const original=JSON.stringify(ctx.userStateV16.answerHistory);
  const recent=ctx.recentScoresV16(questions[0]).slice(0,3);
  assert.deepEqual(Array.from(recent,x=>x.attempt),[6,5,4]);assert.equal(recent[0].scoreMark,'〇');
  assert.equal(JSON.stringify(ctx.userStateV16.answerHistory),original);
});
test('reset restores shared defaults without clearing the favorite filter',()=>{
  const ctx=fixture();ctx.learningOrderV189='random';ctx.learningGenresV189=new Set(['call']);ctx.learningCommentTagV273='押し引き';ctx.menuFavoritesOnlyV137=true;
  let refreshed=0;ctx.refreshBookListConditionsV281=()=>refreshed++;
  assert.equal(ctx.bookListFiltersActiveV281(),true);ctx.resetBookListConditionsV281();
  assert.equal(ctx.bookListFiltersActiveV281(),false);assert.equal(ctx.menuFavoritesOnlyV137,true);assert.equal(refreshed,1);
});
test('navigation accepts old snapshots and validates new shared filter values',()=>{
  const ctx=fixture();ctx.restoreNavigationFiltersV234({commentTag:'押し引き'});
  assert.equal(ctx.learningCommentTagV273,'押し引き');
  ctx.restoreNavigationFiltersV234({learning:{genres:['call','invalid'],history:['×','invalid'],order:'random',tag:'安全度比較'}});
  assert.deepEqual(Array.from(ctx.learningGenresV189),['call']);assert.deepEqual(Array.from(ctx.learningHistoryFiltersV189),['×']);
  assert.equal(ctx.navigationFiltersV234().learning.tag,'安全度比較');
  ctx.restoreNavigationFiltersV234({learning:{genres:[],history:['invalid'],order:'invalid'}});
  assert.deepEqual(Array.from(ctx.learningGenresV189),['discard','riichi','call']);
  assert.equal(ctx.learningHistoryFiltersV189.size,5);assert.equal(ctx.learningOrderV189,'sequential');
});
