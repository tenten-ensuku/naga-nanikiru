import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/menu-polish-v238.css', import.meta.url), 'utf8');
const libraryCss = fs.readFileSync(new URL('../public/library-v214.css', import.meta.url), 'utf8');
const libraryJs = fs.readFileSync(new URL('../public/library-v214.js', import.meta.url), 'utf8');
function source(name) {
  const match = html.match(new RegExp(`^      (?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^      \\}`, 'm'));
  assert.ok(match, name);
  return match[0];
}
function fixture() {
  const nodes = [0, 1].map(() => ({ classList: new Set(['book-context-v234', 'library-tone-plum']), dataset: { bookTone: 'plum' } }));
  for (const node of nodes) node.classList.remove = node.classList.delete.bind(node.classList);
  const context = vm.createContext({ console, window: {}, sharedCollectionV46: null,
    document: { querySelectorAll(selector) { assert.equal(selector, '#bookContextV234, .active-collection-button'); return nodes; } } });
  vm.runInContext(libraryJs.replace(/\}\)\(typeof window[\s\S]*$/, '})(window);'), context);
  vm.runInContext(source('syncBookToneV238'), context);
  return { nodes, context };
}

test('V238 base menu styles follow builder CSS and keep question CSS and data out of the menu change', () => {
  assert.match(html, /const APP_VERSION = 239;/);
  assert.match(html, /book-builder-v235\.css\?v=239[\s\S]*menu-polish-v238\.css\?v=239/);
  assert.doesNotMatch(css, /@import|@font-face|https?:|\.scene-frame|\.hand-mask|\.riichi|--ux-gold\s*:/);
  assert.doesNotMatch(css, /\.learning-header-progress-track/);
});

test('only the home heading is visually hidden, preserving its accessible name and progress', () => {
  assert.match(html, /<h2 id="menuTitle">学習する<\/h2>/);
  assert.match(html, /id="menuPanel" aria-labelledby="menuTitle"/);
  assert.match(css, /#menuPanel\[data-view="today"\] #menuTitle \{[^}]*clip-path: inset\(50%\);/);
  assert.doesNotMatch(css.match(/#menuTitle \{[^}]+\}/)?.[0] || '', /display:\s*none|visibility:\s*hidden/);
  assert.match(css, /#menuPanel\[data-view="today"\] \.menu-heading \{[^}]*display: block;[^}]*padding: 0;/);
  assert.match(html, /document.getElementById\("menuTitle"\).textContent = copy.title/);
  assert.match(html, /class="learning-header-progress-track"[^>]*><span style="width:\$\{progressPercent\}%"/);
  assert.match(html, /data-menu-view="today"[^>]*>[\s\S]*?<span>学ぶ<\/span>/);
});

test('all eight saved tones match bookshelf identity on both book bands without mutations', () => {
  const { context, nodes } = fixture();
  for (const tone of ['walnut', 'navy', 'forest', 'burgundy', 'ivory', 'plum', 'teal', 'ochre']) {
    const book = Object.freeze({ title: '本棚と同じ問題集', book_tone: tone });
    context.syncBookToneV238(book);
    for (const node of nodes) {
      assert.equal(node.dataset.bookTone, tone);
      assert.deepEqual([...node.classList].filter(s => s.startsWith('library-tone-')), [`library-tone-${tone}`]);
      assert.ok(node.classList.has('book-context-v234'));
    }
    assert.match(libraryCss, new RegExp(`\\.library-tone-${tone} \\{ --book-tint:`));
  }
  assert.doesNotMatch(source('syncBookToneV238'), /fetch|localStorage|setBookTone|NagaSupabase/);
});

test('legacy/no-tone books reuse the bookshelf fallback, and clearing selection clears the old color', () => {
  const { context, nodes } = fixture();
  for (const title of ['基本序列問題集', 'ピエール問題集 第1巻', 'くにたそ問題集', '垣崎にま問題集', '新しい問題集']) {
    const book = { title, book_tone: 'invalid-color' };
    context.syncBookToneV238(book);
    assert.equal(nodes[0].dataset.bookTone, context.window.MinkiruLibraryV214.bookTone(book));
  }
  context.syncBookToneV238(null);
  assert.equal(nodes[0].dataset.bookTone, undefined);
  assert.deepEqual([...nodes[0].classList], ['book-context-v234']);
  context.window.MinkiruLibraryV214 = undefined;
  assert.doesNotThrow(() => context.syncBookToneV238({ title: 'fallback' }));
});

test('book switches and successful color saves refresh the band immediately', () => {
  assert.match(source('renderActiveCollectionContextV165'), /syncBookToneV238\(\)/);
  assert.match(source('bindCollectionManagementV100'), /target\.book_tone = selected;[\s\S]*syncBookToneV238\(\)/);
});

test('gold navigation selection stays separate from categories and keyboard focus', () => {
  assert.match(css, /--menu-selected-v238: #f4cb63;/);
  assert.match(css, /--menu-selected-ink-v238: #15212b;/);
  assert.match(css, /:is\(\.book-tabs-v234 button, \.menu-nav-button\)\.is-active \{[^}]*background: var\(--menu-selected-v238\);[^}]*inset 0 -3px 0 var\(--menu-selected-ink-v238\)/);
  assert.match(css, /:focus-visible \{\s*outline: 2px solid #f6fbff;\s*outline-offset: 3px;/);
  assert.match(css, /\[data-book-tone="ivory"\].*\[data-book-tone="ochre"\]/);
  const menu = source('renderBookNavigationV234');
  assert.match(menu, /aria-pressed/);
  assert.match(menu, /aria-current/);
});

test('whole-card interaction and disabled/permissions rules are unchanged', () => {
  const card = source('renderLearningActionButtonV194');
  assert.equal((card.match(/<button/g) || []).length, 1);
  assert.match(card, /\$\{disabled\}/);
  assert.match(card, /<span class="learning-action-link" aria-hidden="true">\$\{icon\("chevron-right"\)\}<\/span>/);
  assert.doesNotMatch(card, /プレイ/);
  assert.match(source('renderBookNavigationV234'), /collectionManagementCanManageV197/);
  assert.match(html, /<div class="learning-all-action">[\s\S]*?<details class="learning-custom-settings"/);
  assert.doesNotMatch(css, /position:\s*fixed|\.learning-custom-settings[^}]*position:\s*absolute/);
  assert.match(css, /min-height: 44px;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
