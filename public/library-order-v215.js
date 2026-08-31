(function (host) {
  'use strict';

  // Small, dependency-free order helper for the V215 bookshelf. It only returns
  // slugs; callers decide how and where those slugs are rendered.
  var MAX_KEY_LENGTH = 160;
  var MAX_ORDER_LENGTH = 3000;
  var TITLE_FIELDS = ['seriesTitle', 'series_title', 'spineTitle', 'fullTitle', 'title', 'name'];
  var collator = null;

  try {
    if (typeof Intl !== 'undefined' && Intl.Collator) {
      collator = new Intl.Collator('ja-JP', {numeric: true, sensitivity: 'base'});
    }
  } catch (_) {
    collator = null;
  }

  function finiteNumber(value) {
    return typeof value === 'number' && value === value && value !== Infinity && value !== -Infinity;
  }

  function keyOf(value) {
    if (typeof value !== 'string') return '';
    var key = value.trim();
    if (!key || key.length > MAX_KEY_LENGTH || /[\u0000-\u001f\u007f-\u009f]/.test(key)) return '';
    return key;
  }

  function read(entry, field) {
    try {
      return entry == null ? undefined : entry[field];
    } catch (_) {
      return undefined;
    }
  }

  function textOf(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function matchText(value) {
    var text = textOf(value);
    try {
      text = text.normalize('NFKC');
    } catch (_) {
      // Older browsers can still use the unnormalised Japanese text.
    }
    return text.replace(/\s+/g, '');
  }

  function compareText(left, right) {
    left = textOf(left);
    right = textOf(right);
    if (collator) {
      var compared = collator.compare(left, right);
      if (compared) return compared;
    }
    return left < right ? -1 : left > right ? 1 : 0;
  }

  function normaliseOrder(value) {
    if (!Array.isArray(value)) return [];
    var result = [];
    var seen = new Set();
    var limit = Math.min(value.length, MAX_ORDER_LENGTH);
    for (var index = 0; index < limit; index += 1) {
      var key = keyOf(value[index]);
      if (key && !seen.has(key)) {
        seen.add(key);
        result.push(key);
      }
    }
    return result;
  }

  function collectEntries(entries) {
    if (!Array.isArray(entries)) return [];
    var records = [];
    var seen = new Set();
    for (var index = 0; index < entries.length; index += 1) {
      var entry = entries[index];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      var slug = keyOf(read(entry, 'slug'));
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      records.push({entry: entry, slug: slug});
    }
    return records;
  }

  function seriesKey(record, parentSlugs) {
    var key = keyOf(read(record.entry, 'seriesParentSlug'));
    if (key) return 'parent:' + key;
    if (parentSlugs && parentSlugs.has(record.slug)) return 'parent:' + record.slug;
    key = keyOf(read(record.entry, 'series_key'));
    if (key) return 'key:' + key;
    return 'book:' + record.slug;
  }

  function titleOf(entry) {
    for (var index = 0; index < TITLE_FIELDS.length; index += 1) {
      var title = textOf(read(entry, TITLE_FIELDS[index]));
      if (title) return title;
    }
    return '';
  }

  function matches(entry, pattern) {
    for (var index = 0; index < TITLE_FIELDS.length; index += 1) {
      if (pattern.test(matchText(read(entry, TITLE_FIELDS[index])))) return true;
    }
    return false;
  }

  function namedRank(group) {
    var rank = 999;
    for (var index = 0; index < group.records.length; index += 1) {
      var entry = group.records[index].entry;
      if (matches(entry, /基本序列/)) rank = Math.min(rank, -1);
      else if (matches(entry, /くにたそ/)) rank = Math.min(rank, 0);
      else if (matches(entry, /ピエール/)) rank = Math.min(rank, 1);
      else if (matches(entry, /垣崎にま/)) rank = Math.min(rank, 2);
    }
    return rank;
  }

  function questionCountOf(value) {
    if (finiteNumber(value)) return value >= 0 ? value : null;
    if (typeof value !== 'string') return null;
    var text = value.trim();
    if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
    var number = Number(text);
    return finiteNumber(number) && number >= 0 ? number : null;
  }

  function volumeOf(value) {
    if (finiteNumber(value)) return value >= 0 ? value : null;
    if (typeof value !== 'string') return null;
    var match = value.normalize ? value.normalize('NFKC').match(/\d+(?:\.\d+)?/) : value.match(/\d+(?:\.\d+)?/);
    if (!match) return null;
    var number = Number(match[0]);
    return finiteNumber(number) && number >= 0 ? number : null;
  }

  function timeOf(value) {
    if (finiteNumber(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return null;
    var time = Date.parse(value);
    return finiteNumber(time) ? time : null;
  }

  function groupTitle(group) {
    var title = '';
    for (var index = 0; index < group.records.length; index += 1) {
      var candidate = titleOf(group.records[index].entry);
      if (candidate && (!title || compareText(candidate, title) < 0)) title = candidate;
    }
    return title || group.key;
  }

  function inspectGroup(group) {
    var hasKnownCount = false;
    var countSum = 0;
    var latestTime = -Infinity;
    for (var index = 0; index < group.records.length; index += 1) {
      var entry = group.records[index].entry;
      var count = questionCountOf(read(entry, 'questionCount'));
      if (count !== null) {
        hasKnownCount = true;
        countSum += count;
        if (!finiteNumber(countSum)) countSum = Number.MAX_VALUE;
      }
      var activity = timeOf(read(entry, 'last_activity_at'));
      var updated = timeOf(read(entry, 'updated_at'));
      if (activity !== null && activity > latestTime) latestTime = activity;
      if (updated !== null && updated > latestTime) latestTime = updated;
    }
    group.hasKnownCount = hasKnownCount;
    group.countSum = countSum;
    group.latestTime = latestTime;
    group.title = groupTitle(group);
    group.namedRank = namedRank(group);
    group.isBasic = group.namedRank === -1;
    return group;
  }

  function compareRecords(left, right) {
    var leftVolume = volumeOf(read(left.entry, 'volume'));
    var rightVolume = volumeOf(read(right.entry, 'volume'));
    if (leftVolume === null && rightVolume !== null) return 1;
    if (leftVolume !== null && rightVolume === null) return -1;
    if (leftVolume !== null && rightVolume !== null && leftVolume !== rightVolume) {
      return leftVolume < rightVolume ? -1 : 1;
    }
    var titleComparison = compareText(titleOf(left.entry), titleOf(right.entry));
    return titleComparison || compareText(left.slug, right.slug);
  }

  // Positive known counts first; timestamp-only groups are still active; empty
  // groups and entirely unknown/no-activity groups trail them.
  function groupBucket(group) {
    if (group.hasKnownCount && group.countSum > 0) return 0;
    if (group.latestTime !== -Infinity) return 1;
    if (group.hasKnownCount) return 2;
    return 3;
  }

  function compareGroups(left, right, preferNamedOrder) {
    if (left.isBasic !== right.isBasic) return left.isBasic ? -1 : 1;
    if (preferNamedOrder && left.namedRank !== right.namedRank) {
      return left.namedRank < right.namedRank ? -1 : 1;
    }

    var leftBucket = groupBucket(left);
    var rightBucket = groupBucket(right);
    if (leftBucket !== rightBucket) return leftBucket < rightBucket ? -1 : 1;
    if (leftBucket === 0 && left.countSum !== right.countSum) {
      return left.countSum > right.countSum ? -1 : 1;
    }
    if (left.latestTime !== right.latestTime) {
      return left.latestTime > right.latestTime ? -1 : 1;
    }
    var titleComparison = compareText(left.title, right.title);
    return titleComparison || compareText(left.key, right.key);
  }

  /** Return unique, valid slugs in grouped bookshelf order. */
  function defaultOrder(entries, options) {
    var records = collectEntries(entries);
    var groups = [];
    var byKey = new Map();
    var parentSlugs = new Set();
    for (var parentIndex = 0; parentIndex < records.length; parentIndex += 1) {
      var parent = keyOf(read(records[parentIndex].entry, 'seriesParentSlug'));
      if (parent) parentSlugs.add(parent);
    }
    for (var index = 0; index < records.length; index += 1) {
      var record = records[index];
      var key = seriesKey(record, parentSlugs);
      var group = byKey.get(key);
      if (!group) {
        group = {key: key, records: []};
        byKey.set(key, group);
        groups.push(group);
      }
      group.records.push(record);
    }

    for (var groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      inspectGroup(groups[groupIndex]);
      groups[groupIndex].records.sort(compareRecords);
    }

    var preferNamedOrder = !options || options.preferNamedOrder !== false;
    groups.sort(function (left, right) {
      return compareGroups(left, right, preferNamedOrder);
    });

    var result = [];
    for (var sortedGroupIndex = 0; sortedGroupIndex < groups.length; sortedGroupIndex += 1) {
      var sortedRecords = groups[sortedGroupIndex].records;
      for (var recordIndex = 0; recordIndex < sortedRecords.length; recordIndex += 1) {
        result.push(sortedRecords[recordIndex].slug);
      }
    }
    return result;
  }

  /** Apply saved UI order, dropping IDs that are not currently accessible. */
  function applySavedOrder(defaultEntries, savedIds) {
    var defaults = defaultOrder(defaultEntries);
    var saved = normaliseOrder(savedIds);
    var visible = new Set(defaults);
    var used = new Set();
    var result = [];

    for (var index = 0; index < saved.length; index += 1) {
      if (visible.has(saved[index]) && !used.has(saved[index])) {
        used.add(saved[index]);
        result.push(saved[index]);
      }
    }
    for (var defaultIndex = 0; defaultIndex < defaults.length; defaultIndex += 1) {
      if (!used.has(defaults[defaultIndex])) {
        used.add(defaults[defaultIndex]);
        result.push(defaults[defaultIndex]);
      }
    }
    return result;
  }

  /** Move one ID before/after another without changing the input array. */
  function moveBook(ids, slug, targetSlug, options) {
    var order = normaliseOrder(ids);
    var item = keyOf(slug);
    var target = keyOf(targetSlug);
    if (!item || !target || item === target) return order.slice();

    var itemIndex = order.indexOf(item);
    var targetIndex = order.indexOf(target);
    if (itemIndex < 0 || targetIndex < 0) return order.slice();

    order.splice(itemIndex, 1);
    targetIndex = order.indexOf(target);
    var after = !!(options && options.after);
    order.splice(targetIndex + (after ? 1 : 0), 0, item);
    return order;
  }

  host.MinkiruLibraryOrderV215 = Object.freeze({
    defaultOrder: defaultOrder,
    applySavedOrder: applySavedOrder,
    moveBook: moveBook,
    normaliseOrder: normaliseOrder
  });
}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this));
