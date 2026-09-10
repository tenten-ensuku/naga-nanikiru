import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
function source(name) {
  const match = html.match(new RegExp(`^      (?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^      \\}`, 'm'));
  assert.ok(match, `function ${name} remains testable`);
  return match[0];
}
function load(names, globals = {}) {
  const context = vm.createContext({ console, Date, ...globals });
  vm.runInContext(names.map(source).join('\n'), context);
  return context;
}

test('global navigation has four app-level destinations, not book analytics', () => {
  const nav = html.match(/<nav[^>]+aria-label="アプリ全体のメニュー"[^>]*>[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav);
  assert.deepEqual([...nav.matchAll(/data-menu-view="([^"]+)"/g)].map(row => row[1]), ['collections', 'today', 'generator', 'settings']);
  assert.match(html, /id="bookContextV234"/);
  for (const view of ['today', 'my', 'analysis']) assert.match(html, new RegExp(`data-book-view="${view}"`));
});

test('generation never treats empty or revoked destinations as local storage', () => {
  const select = { value: '' };
  const row = { share_slug: 'editable-book', can_edit: true };
  const context = load(['currentGeneratorDestinationV130', 'canAddGeneratedQuestionV130'], {
    document: { getElementById: () => select }, generatorDestinationRowsV130: () => [row],
    collectionDisplayNameV101: () => '保存先の本', supabaseSessionV46: { user: { id: 'u' } }
  });
  for (const value of ['', 'revoked-book']) {
    select.value = value;
    assert.equal(context.currentGeneratorDestinationV130().kind, 'unselected');
    assert.equal(context.canAddGeneratedQuestionV130(), false);
  }
  select.value = 'local'; assert.equal(context.canAddGeneratedQuestionV130(), true);
  select.value = 'editable-book'; assert.equal(context.currentGeneratorDestinationV130().label, '保存先の本');
  context.supabaseSessionV46 = null; assert.equal(context.canAddGeneratedQuestionV130(), false);
});

function generatorContext(draft, destination) {
  return load(['openGeneratorNavigationV234'], {
    persistGeneratorFormDraftV157() {}, navigationScopeV234: () => 'book-b',
    generatorDestinationRowsV130: () => [{ share_slug: 'book-b' }],
    generatorFormDraftV157: draft, generatorCandidatesV44: [], generatorDestinationV130: destination,
    generatorDestinationExplicitV157: false, generatorEntryV234: 'global', shown: [],
    showMenuV16(view) { this.shown.push(view); }
  });
}
test('this-book creation preserves a draft with an explicitly selected different destination', () => {
  const context = generatorContext({ url: 'https://example.invalid/draft', destination: 'local' }, 'local');
  context.showMenuV16 = view => context.shown.push(view);
  context.openGeneratorNavigationV234(true);
  assert.equal(context.generatorDestinationV130, 'local');
  assert.equal(context.generatorFormDraftV157.url, 'https://example.invalid/draft');
  assert.deepEqual(context.shown, ['generator']);
});
test('this-book creation selects that book only when no unfinished draft exists', () => {
  const context = generatorContext({ url: '', destination: '' }, '');
  context.showMenuV16 = view => context.shown.push(view);
  context.openGeneratorNavigationV234(true);
  assert.equal(context.generatorDestinationV130, 'book-b');
  assert.equal(context.generatorDestinationExplicitV157, true);
});
test('a viewer cannot enter this-book creation', () => {
  const context = generatorContext({ url: '', destination: '' }, '');
  context.generatorDestinationRowsV130 = () => [];
  context.openGeneratorNavigationV234(true);
  assert.deepEqual(context.shown, []);
  assert.equal(context.generatorDestinationV130, '');
});
test('book management never falls back to another owned book', () => {
  const current = { share_slug: 'current' };
  const context = load(['collectionManagementTargetV197'], {
    menuViewV16: 'book-settings', sharedCollectionV46: current,
    collectionManagementCanManageV197: () => false,
    ownedCollectionOptionsV197() { throw new Error('must not select another book'); }
  });
  assert.equal(context.collectionManagementTargetV197(), null);
  context.collectionManagementCanManageV197 = () => true;
  assert.equal(context.collectionManagementTargetV197(), current);
});
test('personal settings do not render book permission or membership forms', () => {
  const context = load(['renderSettingsViewV67'], {
    userStateV16: { settings: {} }, currentUserDisplayNameV47: () => 'テスト',
    supabaseSessionV46: {}, escapeHtml: String, customReactionSettingsMarkupV211: () => '<section>共通リアクション</section>'
  });
  const output = context.renderSettingsViewV67();
  assert.match(output, /この本の管理/);
  assert.doesNotMatch(output, /collectionManagement|collectionMember|collectionVisibility/);
  const transfer = fs.readFileSync(new URL('../public/legacy-transfer-v232.js', import.meta.url), 'utf8');
  assert.match(transfer, /#menuPanel\[data-view="settings"\] \.settings-section/);
});
test('analytics explicitly asks for only the loaded collection', () => {
  let received;
  const questions = [{ id: 'q1' }];
  const context = load(['renderAnalysisViewV44'], {
    questionsV16: questions, userStateV16: { answers: { other: { attempts: 999 } } },
    personalCollectionStateV131: () => ({ archived: [] }),
    window: { DrillUxV44: { analytics(options) { received = options; return { totalAttempts: 2 }; } } }
  });
  const output = context.renderAnalysisViewV44();
  assert.equal(received.scope, 'collection'); assert.equal(received.questions, questions);
  assert.match(output, /stat-value">2</); assert.doesNotMatch(output, /999/);
});
test('list filters restore search, marks, type, range, favorites, count and order', () => {
  const search = { value: '' };
  const context = load(['restoreNavigationFiltersV234', 'navigationFiltersV234'], {
    menuSearchV44: '', menuStatusFiltersV92: [], menuTypeV44: 'all', menuRangeV60: 'all',
    menuFavoritesOnlyV137: false, menuRenderLimitV119: 40, menuOrderV92: 'sequential', MENU_RENDER_BATCH_V119: 40,
    document: { getElementById: () => search, querySelectorAll: () => [] }
  });
  const filters = { search: '16', statuses: ['wrong'], type: 'discard', range: '1-50', favorites: true, limit: 80, order: 'random' };
  context.restoreNavigationFiltersV234(filters);
  assert.deepEqual(JSON.parse(JSON.stringify(context.navigationFiltersV234())), filters);
  assert.equal(search.value, '16');
});
test('question draft saves tentative answer and composer without an answer write', () => {
  let saved;
  const state = { selected: '4m', selectedIndex: 2, revealed: false, answerRecorded: false,
    answerAttemptId: 'attempt-1', questionStartedAt: Date.now() - 3000, commentAttachments: [{ name: 'local.png' }] };
  const context = load(['saveQuestionNavigationDraftV234'], {
    questionsV16: [{ id: 'q1' }], currentQuestionIndexV16: 0, appliedQuestionKeyV234: 'applied', state,
    document: { getElementById: () => ({ value: 'まだ投稿していない文章' }) },
    questionOriginViewV234: 'my', navigationScopeV234: () => 'book-a', questionKeyV16: q => q.id,
    navigationMemoryV234: { saveQuestion(slug, key, draft) { saved = { slug, key, draft }; } }
  });
  context.saveQuestionNavigationDraftV234();
  assert.equal(saved.slug, 'book-a'); assert.equal(saved.key, 'q1');
  assert.equal(saved.draft.selected, '4m'); assert.equal(saved.draft.answerRecorded, false);
  assert.equal(saved.draft.commentText, 'まだ投稿していない文章');
  assert.equal(saved.draft.commentAttachments, state.commentAttachments);
  assert.doesNotMatch(source('saveQuestionNavigationDraftV234'), /fetch\(|recordAnswer|saveUserState|invokeSharedMutation/);
});
test('Back restores book first, then filters and the unfinished question without writing history', async () => {
  const calls = [];
  const route = { slug: 'book-b', view: 'question', questionKey: 'q2', filters: { favorites: true }, originView: 'archive' };
  const context = load(['restoreNavigationRouteV234'], {
    navigationMemoryV234: { accepts: () => true }, requireLoginForPlayV187: () => true, navigationRestoringV234: false,
    navigationScopeV234: () => 'book-a', navigateToCollectionV106: async (slug, options) => { calls.push(['book', slug, options.historyMode]); return true; },
    restoreNavigationFiltersV234: filters => calls.push(['filters', filters.favorites]), questionOriginViewV234: 'my',
    questionIndexByKeyV44: key => key === 'q2' ? 4 : -1,
    openQuestionV16: async (index, options) => { calls.push(['question', index, options.resume, options.historyMode]); return true; },
    restoreNavigationPositionV234: value => calls.push(['scroll', value.slug]), showMenuV16: () => assert.fail('must restore question')
  });
  assert.equal(await context.restoreNavigationRouteV234(route), true);
  assert.deepEqual(calls, [['book', 'book-b', 'none'], ['filters', true], ['question', 4, true, 'none'], ['scroll', 'book-b']]);
  assert.equal(context.questionOriginViewV234, 'archive'); assert.equal(context.navigationRestoringV234, false);
  context.navigationMemoryV234.accepts = () => false;
  assert.equal(await context.restoreNavigationRouteV234(route), false); assert.equal(calls.length, 4);
});
test('bulk generation stops if the destination changes after confirming, retaining unfinished selections', async () => {
  let destination = { kind: 'shared', shareSlug: 'book-a', label: '本A' };
  let writes = 0;
  const selected = new Set([0, 1]);
  const context = load(['addSelectedGeneratorQuestionsV158'], {
    generatorSelectedCandidatesV158: selected, generatorCandidatesV44: [{ id: 'q1' }, { id: 'q2' }],
    canAddGeneratedQuestionV130: () => true, currentGeneratorDestinationV130: () => destination,
    supabaseSessionV46: {}, window: { confirm: text => { assert.match(text, /本A/); return true; } },
    setGeneratorStatusV44() {}, setGeneratorStageV159() {}, document: { getElementById: () => null },
    addGeneratedQuestionV44: async (_index, options) => {
      assert.equal(options.expectedDestinationKey, 'book-a'); writes++;
      destination = { kind: 'shared', shareSlug: 'book-b', label: '本B' }; return true;
    }
  });
  await context.addSelectedGeneratorQuestionsV158();
  assert.equal(writes, 1); assert.deepEqual([...selected], [1]);
});
test('question navigation restores existing answer state without recording it again', () => {
  const fn = source('openQuestionV16');
  assert.match(fn, /const restoreDraft = draft && \(resume \|\| !draft.revealed\)/);
  assert.match(fn, /Object.assign\(state, fields\)/);
  assert.match(fn, /savedQuestionRoute\?\.questionKey === requestedKey/);
  assert.doesNotMatch(fn, /recordAnswer|confirmAnswer|invokeSharedMutation/);
});
