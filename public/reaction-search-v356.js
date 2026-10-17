(function (host) {
  'use strict';
  let selected = '';
  const key = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : '';
  const keys = values => [...new Set((Array.isArray(values) ? values : []).map(key).filter(Boolean))];
  host.MinkiruReactionSearchV356 = Object.freeze({
    get selected() { return selected; },
    choose(value) { selected = key(value); return selected; },
    keys,
    matches(question) { return !selected || keys(question?.reactionKeysV356).includes(selected); },
    fromSummary(summary, definition) {
      return keys([summary?.question, ...Object.values(summary?.comments || {})].flatMap(bucket =>
        Object.entries(bucket || {}).filter(([, value]) => Number(value?.reactionCount) > 0)
          .map(([id]) => definition(id)?.storageKey || id)));
    }
  });
}(typeof window !== 'undefined' ? window : globalThis));
