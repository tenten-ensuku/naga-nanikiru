import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/library-order-v215.js', import.meta.url), 'utf8');
const sandbox = vm.createContext({});
vm.runInContext(source, sandbox, { filename: 'library-order-v215.js' });
const order = sandbox.MinkiruLibraryOrderV215;

const book = (slug, title, volume, extra = {}) => ({
  slug,
  spineTitle: title,
  fullTitle: `${title} 第${volume}巻`,
  volume,
  seriesParentSlug: extra.seriesParentSlug ?? null,
  series_key: extra.series_key ?? slug,
  questionCount: extra.questionCount,
  updated_at: extra.updated_at,
  last_activity_at: extra.last_activity_at,
});

test('exports the frozen V215 API', () => {
  assert.deepEqual(Object.keys(order).sort(), [
    'applySavedOrder',
    'defaultOrder',
    'moveBook',
    'normaliseOrder',
  ]);
  assert.equal(Object.isFrozen(order), true);
});

test('defaultOrder prioritises named groups and sorts child volumes numerically', () => {
  const entries = [
    book('other-1', 'その他', 1, {questionCount: 99, series_key: 'other'}),
    book('pierre-10', 'ピエール', 10, {questionCount: 1, series_key: 'pierre'}),
    book('basic-10', '基本序列', 10, {questionCount: 1, series_key: 'basic'}),
    book('kuni-10', 'くにたそ', 10, {questionCount: 1, series_key: 'kuni'}),
    book('basic-2', '基本序列', 2, {questionCount: 1, series_key: 'basic'}),
    book('kuni-2', 'くにたそ', 2, {questionCount: 1, series_key: 'kuni'}),
    book('nima-1', '垣崎にま', 1, {questionCount: 1, series_key: 'nima'}),
    book('kuni-9', 'くにたそ', 9, {questionCount: 1, series_key: 'kuni'}),
    book('pierre-1', 'ピエール', 1, {questionCount: 1, series_key: 'pierre'}),
    book('kuni-1', 'くにたそ', 1, {questionCount: 1, series_key: 'kuni'}),
  ];

  assert.deepEqual(Array.from(order.defaultOrder(entries)), [
    'basic-2', 'basic-10',
    'kuni-1', 'kuni-2', 'kuni-9', 'kuni-10',
    'pierre-1', 'pierre-10',
    'nima-1',
    'other-1',
  ]);
});

test('preferNamedOrder false uses statistics for every non-basic group', () => {
  const entries = [
    book('kuni', 'くにたそ', 1, {questionCount: 1, series_key: 'kuni'}),
    book('other', 'その他', 1, {questionCount: 10, series_key: 'other'}),
    book('pierre', 'ピエール', 1, {questionCount: 2, series_key: 'pierre'}),
    book('basic', '基本序列', 1, {questionCount: 0, series_key: 'basic'}),
  ];
  assert.deepEqual(Array.from(order.defaultOrder(entries, {preferNamedOrder: false})), [
    'basic', 'other', 'pierre', 'kuni',
  ]);
});

test('groups a parent and its children by seriesParentSlug', () => {
  const entries = [
    book('series-root', '系列', 1, {series_key: 'root-key', questionCount: 1}),
    book('series-10', '系列', 10, {
      series_key: 'child-key-10',
      seriesParentSlug: 'series-root',
      questionCount: 1,
    }),
    book('series-2', '系列', 2, {
      series_key: 'child-key-2',
      seriesParentSlug: 'series-root',
      questionCount: 1,
    }),
  ];
  assert.deepEqual(Array.from(order.defaultOrder(entries)), [
    'series-root', 'series-2', 'series-10',
  ]);
});

test('orders known positive, active unknown, known empty, and unknown empty groups safely', () => {
  const entries = [
    book('unknown-empty', 'ん unknown', 1, {series_key: 'unknown-empty'}),
    book('known-two', 'い 既知2', 1, {questionCount: 2, series_key: 'known-two'}),
    book('empty', 'え 空', 1, {questionCount: 0, series_key: 'empty'}),
    book('unknown-active', 'お 未知active', 1, {
      series_key: 'unknown-active',
      last_activity_at: '2026-08-30T00:00:00Z',
    }),
    book('known-five', 'あ 既知5', 1, {questionCount: 5, series_key: 'known-five'}),
  ];
  assert.deepEqual(Array.from(order.defaultOrder(entries, {preferNamedOrder: false})), [
    'known-five', 'known-two', 'unknown-active', 'empty', 'unknown-empty',
  ]);
});

test('uses latest activity or updated time, then a deterministic Japanese title', () => {
  const entries = [
    book('older', 'あ 古い', 1, {
      series_key: 'older',
      questionCount: 1,
      updated_at: '2026-08-01T00:00:00Z',
    }),
    book('newer', 'ん 新しい', 1, {
      series_key: 'newer',
      questionCount: 1,
      last_activity_at: '2026-08-30T00:00:00Z',
    }),
    book('title-z', 'ん ん', 1, {series_key: 'title-z', questionCount: 1}),
    book('title-a', 'あ あ', 1, {series_key: 'title-a', questionCount: 1}),
  ];
  assert.deepEqual(Array.from(order.defaultOrder(entries, {preferNamedOrder: false})), [
    'newer', 'older', 'title-a', 'title-z',
  ]);
});

test('defaultOrder is nonmutating and ignores invalid or duplicate entries', () => {
  const entries = [
    {slug: 'valid', spineTitle: '有効', volume: 1, series_key: 's'},
    {slug: 'valid', spineTitle: '重複', volume: 2, series_key: 's'},
    {slug: '', spineTitle: '空'},
    {slug: 'x'.repeat(161), spineTitle: '長すぎる'},
    null,
    ['nested'],
  ];
  const snapshot = structuredClone(entries);
  assert.deepEqual(Array.from(order.defaultOrder(entries)), ['valid']);
  assert.deepEqual(entries, snapshot);
});

test('applySavedOrder keeps only accessible saved IDs and appends a new book', () => {
  const entries = [
    book('a', 'あ', 1, {series_key: 'a', questionCount: 1}),
    book('b', 'い', 1, {series_key: 'b', questionCount: 2}),
    book('new-book', 'う 新規', 1, {series_key: 'new', questionCount: 3}),
  ];
  const savedIds = ['missing', 'a', 'a', {slug: 'b'}, 'b'];
  assert.deepEqual(Array.from(order.normaliseOrder(savedIds)), ['missing', 'a', 'b']);
  assert.deepEqual(Array.from(order.applySavedOrder(entries, savedIds)), ['a', 'b', 'new-book']);
  assert.deepEqual(savedIds, ['missing', 'a', 'a', {slug: 'b'}, 'b']);
});

test('normaliseOrder filters malicious values, trims, deduplicates, and caps size', () => {
  const exactlyMax = 'x'.repeat(160);
  const tooLong = 'y'.repeat(161);
  assert.deepEqual(Array.from(order.normaliseOrder([
    '  kept  ',
    'kept',
    '',
    '   ',
    {},
    ['nested'],
    tooLong,
    '\u0000bad',
    exactlyMax,
  ])), ['kept', exactlyMax]);
  assert.deepEqual(Array.from(order.normaliseOrder(null)), []);
  assert.deepEqual(Array.from(order.normaliseOrder({0: 'object'})), []);

  const many = Array.from({length: 3005}, (_, index) => `id-${index}`);
  const normalised = order.normaliseOrder(many);
  assert.equal(normalised.length, 3000);
  assert.equal(normalised.at(-1), 'id-2999');
});

test('moveBook is pure, supports before and after, and sanitizes duplicates', () => {
  const ids = ['a', 'b', 'c', 'b'];
  const beforeSnapshot = [...ids];
  const before = order.moveBook(ids, 'c', 'a');
  const after = order.moveBook(ids, 'c', 'a', {after: true});
  assert.deepEqual(Array.from(before), ['c', 'a', 'b']);
  assert.deepEqual(Array.from(after), ['a', 'c', 'b']);
  assert.deepEqual(ids, beforeSnapshot);
  assert.notEqual(before, ids);
  assert.deepEqual(Array.from(order.moveBook(ids, 'missing', 'a')), ['a', 'b', 'c']);
  assert.deepEqual(Array.from(order.moveBook(ids, 'a', 'a')), ['a', 'b', 'c']);
  assert.deepEqual(Array.from(order.moveBook(ids, {}, 'a')), ['a', 'b', 'c']);
});
