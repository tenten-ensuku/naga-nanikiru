(function installDrillUxV44(globalObject) {
  "use strict";

  var STORAGE_KEY = "naga-nanikiru-user-state-v1";
  var DAY_MS = 24 * 60 * 60 * 1000;
  var SCORE_MARKS = ["×", "△", "〇", "◎"];

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function hasOwn(value, key) {
    return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
  }

  function cloneValue(value) {
    if (value === undefined) {
      return undefined;
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return value;
    }
  }

  function asArray(value) {
    if (Array.isArray(value)) {
      return value.slice();
    }
    if (value === undefined || value === null) {
      return [];
    }
    return [value];
  }

  function normalizeKey(value) {
    if (value === undefined || value === null || value === "") {
      return "";
    }
    if (isRecord(value)) {
      return questionKey(value);
    }
    return String(value);
  }

  function uniqueKeys(value) {
    var result = [];
    var seen = Object.create(null);
    asArray(value).forEach(function (item) {
      var key = normalizeKey(item);
      if (key && !seen[key]) {
        seen[key] = true;
        result.push(key);
      }
    });
    return result;
  }

  function cloneObject(value) {
    return isRecord(value) ? cloneValue(value) : {};
  }

  function questionKey(question) {
    if (question === undefined || question === null) {
      return "";
    }
    if (typeof question !== "object") {
      return String(question);
    }
    var fields = ["key", "id", "questionId", "questionKey"];
    for (var index = 0; index < fields.length; index += 1) {
      var field = fields[index];
      if (question[field] !== undefined && question[field] !== null && question[field] !== "") {
        return String(question[field]);
      }
    }
    if (question.number !== undefined && question.number !== null && question.number !== "") {
      return "number-" + String(question.number);
    }
    return "";
  }

  function timeMs(value) {
    if (value instanceof Date) {
      var dateValue = value.getTime();
      return Number.isFinite(dateValue) ? dateValue : null;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string" && value.trim()) {
      var numeric = Number(value);
      if (Number.isFinite(numeric) && /^-?\d+(?:\.\d+)?$/.test(value.trim())) {
        return numeric;
      }
      var parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function nowMs(value) {
    var parsed = timeMs(value);
    return parsed === null ? Date.now() : parsed;
  }

  function isoTime(value) {
    var parsed = timeMs(value);
    return parsed === null ? null : new Date(parsed).toISOString();
  }

  function dateOnly(value) {
    var parsed = timeMs(value);
    if (parsed === null) {
      return "";
    }
    var date = new Date(parsed);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function createDefaultState() {
    return {
      schemaVersion: 2,
      favorites: [],
      trashed: [],
      hidden: [],
      answerHistory: [],
      snoozed: {},
      studyDates: [],
      sessions: {},
      activeSessionId: null,
      lastSessionResult: null,
      customQuestions: [],
      pendingGenerated: [],
      settings: {}
    };
  }

  function migrateState(input) {
    var source = isRecord(input) ? input : {};
    var result = cloneObject(source);
    result.schemaVersion = 2;
    result.favorites = uniqueKeys(source.favorites);
    result.trashed = uniqueKeys(source.trashed !== undefined ? source.trashed : source.trash);
    result.hidden = uniqueKeys(source.hidden);
    result.answerHistory = Array.isArray(source.answerHistory) ? cloneValue(source.answerHistory) : [];
    result.snoozed = cloneObject(source.snoozed);
    delete result.reviewSchedule;
    result.studyDates = Array.from(new Set(asArray(source.studyDates).map(function (value) {
      return String(value);
    }).filter(Boolean)));
    result.sessions = cloneObject(source.sessions);
    result.activeSessionId = source.activeSessionId === undefined ? null : source.activeSessionId;
    result.lastSessionResult = source.lastSessionResult === undefined ? null : cloneValue(source.lastSessionResult);
    result.customQuestions = Array.isArray(source.customQuestions) ? cloneValue(source.customQuestions) : [];
    result.pendingGenerated = Array.isArray(source.pendingGenerated) ? cloneValue(source.pendingGenerated) : [];
    result.settings = cloneObject(source.settings);
    return result;
  }

  function getStorage(storage) {
    if (storage && typeof storage.getItem === "function") {
      return storage;
    }
    try {
      if (globalObject && globalObject.localStorage && typeof globalObject.localStorage.getItem === "function") {
        return globalObject.localStorage;
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  function loadState(storage, key) {
    var storageObject = getStorage(storage);
    var storageKey = key || STORAGE_KEY;
    if (!storageObject) {
      return createDefaultState();
    }
    try {
      var raw = storageObject.getItem(storageKey);
      return migrateState(raw ? JSON.parse(raw) : null);
    } catch (error) {
      return createDefaultState();
    }
  }

  function saveState(state, storage, key) {
    var migrated = migrateState(state);
    var storageObject = getStorage(storage);
    var storageKey = key || STORAGE_KEY;
    if (storageObject && typeof storageObject.setItem === "function") {
      storageObject.setItem(storageKey, JSON.stringify(migrated));
    }
    return migrated;
  }

  function isForeverSnooze(value) {
    if (value === true || value === Infinity) {
      return true;
    }
    if (typeof value === "string") {
      var normalized = value.trim().toLowerCase();
      return normalized === "forever" || normalized === "indefinite" || normalized === "never" || normalized === "無期限";
    }
    if (isRecord(value)) {
      if (value.forever === true || value.indefinite === true || value.never === true) {
        return true;
      }
      return isForeverSnooze(value.until) || isForeverSnooze(value.snoozeUntil);
    }
    return false;
  }

  function snoozeUntil(value) {
    if (isRecord(value)) {
      var fields = ["until", "snoozeUntil", "expiresAt", "endAt"];
      for (var index = 0; index < fields.length; index += 1) {
        if (value[fields[index]] !== undefined) {
          return timeMs(value[fields[index]]);
        }
      }
      return null;
    }
    return timeMs(value);
  }

  function isSnoozed(state, key, now) {
    var stateObject = isRecord(state) ? state : {};
    var snoozed = isRecord(stateObject.snoozed) ? stateObject.snoozed : {};
    var questionId = normalizeKey(key);
    if (!questionId || !hasOwn(snoozed, questionId)) {
      return false;
    }
    var value = snoozed[questionId];
    if (value === false || value === null || value === undefined) {
      return false;
    }
    if (isForeverSnooze(value)) {
      return true;
    }
    var until = snoozeUntil(value);
    return until !== null && until > nowMs(now);
  }

  function hasKey(container, key) {
    if (Array.isArray(container)) {
      return container.map(normalizeKey).indexOf(key) >= 0;
    }
    if (isRecord(container) && hasOwn(container, key)) {
      return container[key] !== false && container[key] !== null;
    }
    return false;
  }

  function isPlayable(state, question, now) {
    var stateObject = isRecord(state) ? state : {};
    var key = questionKey(question);
    if (!key) {
      return false;
    }
    if (hasKey(stateObject.hidden, key) || hasKey(stateObject.trashed, key)) {
      return false;
    }
    return !isSnoozed(stateObject, key, now);
  }

  function historyArray(source) {
    if (Array.isArray(source)) {
      return source;
    }
    if (isRecord(source) && Array.isArray(source.answerHistory)) {
      return source.answerHistory;
    }
    return [];
  }

  function answerKey(entry) {
    if (!isRecord(entry)) {
      return "";
    }
    var fields = ["questionKey", "questionId", "key", "question"];
    for (var index = 0; index < fields.length; index += 1) {
      var field = fields[index];
      if (entry[field] !== undefined && entry[field] !== null && entry[field] !== "") {
        return normalizeKey(entry[field]);
      }
    }
    return "";
  }

  function answerMark(entry) {
    if (!isRecord(entry)) {
      return "";
    }
    var raw = entry.scoreMark;
    if (raw === undefined) {
      raw = entry.mark;
    }
    if (raw === undefined) {
      raw = entry.score;
    }
    if (raw === undefined || raw === null) {
      return "";
    }
    var value = String(raw).replace(/💮/g, "◎");
    for (var index = 0; index < SCORE_MARKS.length; index += 1) {
      if (value.indexOf(SCORE_MARKS[index]) >= 0) {
        return SCORE_MARKS[index];
      }
    }
    if (value.indexOf("○") >= 0 || value.indexOf("◯") >= 0) {
      return "〇";
    }
    if (value.indexOf("✕") >= 0) {
      return "×";
    }
    return "";
  }

  function answerAt(entry) {
    if (!isRecord(entry)) {
      return null;
    }
    var fields = ["answeredAt", "completedAt", "createdAt", "timestamp", "time"];
    for (var index = 0; index < fields.length; index += 1) {
      if (entry[fields[index]] !== undefined) {
        var parsed = timeMs(entry[fields[index]]);
        if (parsed !== null) {
          return parsed;
        }
      }
    }
    return null;
  }

  function responseMs(entry) {
    if (!isRecord(entry)) {
      return null;
    }
    var value = entry.responseTimeMs;
    if (value === undefined) {
      value = entry.responseMs;
    }
    if (value === undefined) {
      value = entry.durationMs;
    }
    var parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function historySort(items) {
    return items.map(function (entry, index) {
      return { entry: entry, index: index, at: answerAt(entry) };
    }).sort(function (left, right) {
      var leftTime = left.at === null ? -Infinity : left.at;
      var rightTime = right.at === null ? -Infinity : right.at;
      if (leftTime !== rightTime) {
        return leftTime - rightTime;
      }
      return left.index - right.index;
    });
  }

  function latestAnswerMap(source) {
    var map = {};
    historySort(historyArray(source)).forEach(function (item) {
      var key = answerKey(item.entry);
      if (key) {
        map[key] = cloneValue(item.entry);
      }
    });
    return map;
  }

  function history(source, key) {
    var normalizedKey = key === undefined ? null : normalizeKey(key);
    return historySort(historyArray(source)).filter(function (item) {
      return normalizedKey === null || answerKey(item.entry) === normalizedKey;
    }).map(function (item) {
      return cloneValue(item.entry);
    });
  }

  function isWeakMark(mark) {
    return mark === "×" || mark === "△";
  }

  // Answer history is stored oldest-first internally.  Learning decisions
  // need the newest attempts first so that every screen uses the same rule.
  function recentAnswers(source, key, limit) {
    var normalizedKey = normalizeKey(key);
    var numericLimit = Number(limit);
    var maximum = Number.isFinite(numericLimit) ? Math.max(0, Math.floor(numericLimit)) : Infinity;
    return historySort(historyArray(source)).filter(function (item) {
      return !normalizedKey || answerKey(item.entry) === normalizedKey;
    }).reverse().slice(0, maximum).map(function (item) {
      return cloneValue(item.entry);
    });
  }

  function hasWeakInRecentAnswers(source, key, limit) {
    return recentAnswers(source, key, limit === undefined ? 3 : limit).some(function (entry) {
      return isWeakMark(answerMark(entry));
    });
  }

  function isMasteredByRecentAnswers(source, key, required) {
    var count = Number(required);
    var requiredCount = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 2;
    var answers = recentAnswers(source, key, requiredCount);
    return answers.length >= requiredCount && answers.every(function (entry) {
      return answerMark(entry) === "◎";
    });
  }

  function positiveValue(value) {
    if (Array.isArray(value)) {
      return value.some(function (item) {
        return Number(item) > 0;
      });
    }
    return Number(value) > 0;
  }

  function rawDecisionType(question) {
    if (!isRecord(question)) {
      return "";
    }
    return String(question.decisionType || question.questionType || question.type || question.category || "").toLowerCase();
  }

  function isRiichiQuestion(question) {
    var raw = rawDecisionType(question);
    if (raw.indexOf("riichi") >= 0 || raw.indexOf("reach") >= 0 || raw.indexOf("立直") >= 0 || raw.indexOf("リーチ") >= 0) {
      return true;
    }
    return Boolean(isRecord(question) && (question.hasRiichiJudgment === true || positiveValue(question.reach)));
  }

  function isCallQuestion(question) {
    var raw = rawDecisionType(question);
    if (raw.indexOf("call") >= 0 || raw.indexOf("meld") >= 0 || raw.indexOf("furo") >= 0 || raw.indexOf("副露") >= 0 || raw.indexOf("鳴") >= 0) {
      return true;
    }
    if (!isRecord(question)) {
      return false;
    }
    return question.hasCallJudgment === true || (Array.isArray(question.callOptions) && question.callOptions.length > 0) || question.callRecommended !== null && question.callRecommended !== undefined;
  }

  function questionType(question) {
    if (isRiichiQuestion(question)) {
      return "riichi";
    }
    if (isCallQuestion(question)) {
      return "call";
    }
    return "discard";
  }

  function normalizedMode(mode) {
    var value = String(mode || "today").toLowerCase();
    var aliases = {
      daily: "today",
      today10: "today",
      new: "unanswered",
      unanswered: "unanswered",
      weak: "weak",
      riichi: "riichi",
      reach: "riichi",
      call: "call",
      furo: "call",
      meld: "call",
      favorites: "favorites",
      favorite: "favorites",
      all: "all"
    };
    return aliases[value] || value;
  }

  function buildQueue(options) {
    var settings = isRecord(options) ? options : {};
    var questions = Array.isArray(settings.questions) ? settings.questions : [];
    var state = migrateState(settings.state);
    var mode = normalizedMode(settings.mode);
    var now = settings.now;
    var latest = latestAnswerMap(state);
    var seen = Object.create(null);
    var candidates = [];

    questions.forEach(function (question, index) {
      var key = questionKey(question);
      if (!key || seen[key] || !isPlayable(state, question, now)) {
        return;
      }
      seen[key] = true;
      var latestEntry = latest[key];
      var unanswered = !latestEntry;
      var weak = hasWeakInRecentAnswers(state, key, 3);
      var type = questionType(question);
      var favorite = hasKey(state.favorites, key);
      var matches = true;
      if (mode === "today" || mode === "recommended") {
        matches = weak || unanswered;
      } else if (mode === "unanswered") {
        matches = unanswered;
      } else if (mode === "weak") {
        matches = weak;
      } else if (mode === "riichi" || mode === "call") {
        matches = type === mode;
      } else if (mode === "favorites") {
        matches = favorite;
      }
      if (matches) {
        candidates.push({ question: question, index: index, weak: weak, unanswered: unanswered });
      }
    });

    candidates.sort(function (left, right) {
      function priority(item) {
        if (item.weak) {
          return 0;
        }
        if (item.unanswered) {
          return 1;
        }
        return 2;
      }
      var leftPriority = priority(left);
      var rightPriority = priority(right);
      return leftPriority - rightPriority || left.index - right.index;
    });

    var numericLimit = Number(settings.limit);
    var limit = Number.isFinite(numericLimit) ? Math.max(0, Math.floor(numericLimit)) : candidates.length;
    return candidates.slice(0, limit).map(function (item) {
      return item.question;
    });
  }

  function createSession(mode, questionKeys, now) {
    var keys = uniqueKeys(questionKeys);
    var startedAt = isoTime(now);
    if (!startedAt) {
      startedAt = new Date(nowMs()).toISOString();
    }
    var safeMode = String(mode || "today");
    var id = "session-" + safeMode + "-" + new Date(startedAt).getTime() + "-" + keys.join(",");
    return {
      id: id,
      sessionId: id,
      mode: safeMode,
      questionKeys: keys,
      cursor: 0,
      status: "active",
      startedAt: startedAt,
      updatedAt: startedAt,
      completedAt: null,
      result: null
    };
  }

  function emptyScoreCounts() {
    return { "×": 0, "△": 0, "〇": 0, "◎": 0 };
  }

  function scoreRates(counts, denominator) {
    var total = denominator || 0;
    var result = {};
    SCORE_MARKS.forEach(function (mark) {
      result[mark] = total ? counts[mark] / total : 0;
    });
    return result;
  }

  function summarizeAnswers(entries) {
    var scoreCounts = emptyScoreCounts();
    var responseTotal = 0;
    var responseCount = 0;
    var keys = Object.create(null);
    entries.forEach(function (entry) {
      var key = answerKey(entry);
      if (key) {
        keys[key] = true;
      }
      var mark = answerMark(entry);
      if (mark && hasOwn(scoreCounts, mark)) {
        scoreCounts[mark] += 1;
      }
      var response = responseMs(entry);
      if (response !== null) {
        responseTotal += response;
        responseCount += 1;
      }
    });
    var average = responseCount ? responseTotal / responseCount : 0;
    var rates = scoreRates(scoreCounts, entries.length);
    return {
      attempts: entries.length,
      totalAttempts: entries.length,
      uniqueAnswered: Object.keys(keys).length,
      avgResponseMs: average,
      averageResponseMs: average,
      averageResponseTimeMs: average,
      scoreCounts: scoreCounts,
      rates: rates,
      scoreRates: rates,
      safeRate: entries.length
        ? ((scoreCounts["◎"] || 0) + (scoreCounts["〇"] || 0)) / entries.length * 100
        : 0
    };
  }

  function studyStreak(state, entries, now) {
    var dates = Object.create(null);
    asArray(state.studyDates).forEach(function (value) {
      var day = dateOnly(value);
      if (day) {
        dates[day] = true;
      }
    });
    entries.forEach(function (entry) {
      var day = dateOnly(answerAt(entry));
      if (day) {
        dates[day] = true;
      }
    });
    var sorted = Object.keys(dates).sort().reverse();
    if (!sorted.length) {
      return 0;
    }
    var today = dateOnly(now === undefined ? Date.now() : now);
    var anchor = sorted[0];
    if (today && anchor !== today) {
      var todayMs = timeMs(today + "T00:00:00.000Z");
      var anchorMs = timeMs(anchor + "T00:00:00.000Z");
      if (todayMs === null || anchorMs === null || todayMs - anchorMs > DAY_MS) {
        return 0;
      }
    }
    var count = 1;
    for (var index = 1; index < sorted.length; index += 1) {
      var previousMs = timeMs(sorted[index - 1] + "T00:00:00.000Z");
      var currentMs = timeMs(sorted[index] + "T00:00:00.000Z");
      if (previousMs === null || currentMs === null || previousMs - currentMs !== DAY_MS) {
        break;
      }
      count += 1;
    }
    return count;
  }

  function analytics(options) {
    var settings = isRecord(options) ? options : {};
    var questions = Array.isArray(settings.questions) ? settings.questions : [];
    var state = migrateState(settings.state);
    var entries = historyArray(state).slice();
    var summary = summarizeAnswers(entries);
    var questionMap = Object.create(null);
    questions.forEach(function (question) {
      var key = questionKey(question);
      if (key && !questionMap[key]) {
        questionMap[key] = question;
      }
    });

    var breakdownEntries = { discard: [], call: [], riichi: [] };
    entries.forEach(function (entry) {
      var question = questionMap[answerKey(entry)];
      var type = question ? questionType(question) : "discard";
      breakdownEntries[type].push(entry);
    });
    var breakdowns = {
      discard: summarizeAnswers(breakdownEntries.discard),
      call: summarizeAnswers(breakdownEntries.call),
      riichi: summarizeAnswers(breakdownEntries.riichi)
    };

    var masteredSeen = Object.create(null);
    var masteredCount = 0;
    questions.forEach(function (question) {
      var key = questionKey(question);
      if (!key || masteredSeen[key]) {
        return;
      }
      if (isMasteredByRecentAnswers(state, key, 2)) {
        masteredSeen[key] = true;
        masteredCount += 1;
      }
    });

    var result = {
      totalAttempts: summary.totalAttempts,
      uniqueAnswered: summary.uniqueAnswered,
      avgResponseMs: summary.avgResponseMs,
      averageResponseMs: summary.averageResponseMs,
      averageResponseTimeMs: summary.averageResponseMs,
      scoreCounts: summary.scoreCounts,
      rates: summary.rates,
      scoreRates: summary.scoreRates,
      streakDays: studyStreak(state, entries, settings.now),
      masteredCount: masteredCount,
      breakdowns: breakdowns
    };
    result.studyStreakDays = result.streakDays;
    return result;
  }

  function textFields(question) {
    if (!isRecord(question)) {
      return [];
    }
    return [question.id, question.number, question.title, question.label, question.name, question.decisionType, question.type].filter(function (value) {
      return value !== undefined && value !== null;
    }).map(String);
  }

  function statusMatches(status, state, question, latest, now) {
    var value = String(status || "all").toLowerCase();
    var key = questionKey(question);
    var entry = latest[key];
    if (value === "all") {
      return true;
    }
    if (value === "unanswered" || value === "new") {
      return !entry;
    }
    if (value === "answered") {
      return Boolean(entry);
    }
    if (value === "weak") {
      return hasWeakInRecentAnswers(state, key, 3);
    }
    if (value === "mastered") {
      return isMasteredByRecentAnswers(state, key, 2);
    }
    if (value === "snoozed") {
      return isSnoozed(state, key, now);
    }
    if (value === "favorite" || value === "favorites") {
      return hasKey(state.favorites, key);
    }
    if (value === "trash" || value === "trashed") {
      return hasKey(state.trashed, key);
    }
    if (value === "hidden") {
      return hasKey(state.hidden, key);
    }
    return true;
  }

  function viewMatches(view, state, question, latest, now) {
    var value = String(view || "my").toLowerCase();
    var key = questionKey(question);
    if (value === "all") {
      return true;
    }
    if (value === "trash" || value === "trashed" || value === "ゴミ箱") {
      return hasKey(state.trashed, key) || isSnoozed(state, key, now);
    }
    if (value === "hidden") {
      return hasKey(state.hidden, key);
    }
    if (value === "favorite" || value === "favorites" || value === "お気に入り") {
      return hasKey(state.favorites, key) && isPlayable(state, question, now);
    }
    return isPlayable(state, question, now);
  }

  function filterQuestions(options) {
    var settings = isRecord(options) ? options : {};
    var questions = Array.isArray(settings.questions) ? settings.questions : [];
    var state = migrateState(settings.state);
    var latest = latestAnswerMap(state);
    var query = String(settings.query || "").trim().toLowerCase();
    var type = settings.type ? String(settings.type).toLowerCase() : "all";
    var seen = Object.create(null);
    return questions.filter(function (question) {
      var key = questionKey(question);
      if (!key || seen[key]) {
        return false;
      }
      seen[key] = true;
      if (!viewMatches(settings.view, state, question, latest, settings.now)) {
        return false;
      }
      if (!statusMatches(settings.status, state, question, latest, settings.now)) {
        return false;
      }
      if (type !== "all" && type !== "any" && questionType(question) !== type) {
        return false;
      }
      if (query) {
        var haystack = [key].concat(textFields(question)).join(" ").toLowerCase();
        if (haystack.indexOf(query) < 0) {
          return false;
        }
      }
      return true;
    });
  }

  function sessionResult(session, source) {
    var sessionObject = isRecord(session) ? session : {};
    var keys = uniqueKeys(sessionObject.questionKeys || sessionObject.keys);
    var sessionId = sessionObject.sessionId || sessionObject.id || null;
    var scoped = historyArray(source).filter(function (entry) {
      var key = answerKey(entry);
      if (keys.length && keys.indexOf(key) < 0) {
        return false;
      }
      if (sessionId && entry.sessionId !== undefined && entry.sessionId !== sessionId) {
        return false;
      }
      return Boolean(key) || Boolean(sessionId && entry.sessionId === sessionId);
    });
    var latest = latestAnswerMap(scoped);
    var answeredEntries = keys.length ? keys.map(function (key) {
      return latest[key];
    }).filter(Boolean) : Object.keys(latest).map(function (key) {
      return latest[key];
    });
    var summary = summarizeAnswers(answeredEntries);
    var total = keys.length || summary.uniqueAnswered;
    var answered = answeredEntries.length;
    var unanswered = Math.max(0, total - answered);
    var completed = total > 0 && answered >= total;
    var results = answeredEntries.map(function (entry) {
      return {
        questionKey: answerKey(entry),
        scoreMark: answerMark(entry),
        scoreLabel: entry.scoreLabel || entry.label || "",
        responseTimeMs: responseMs(entry) || 0,
        answeredAt: answerAt(entry),
        selected: entry.selected,
        callDecision: entry.callDecision,
        riichi: entry.riichi
      };
    });
    return {
      sessionId: sessionId,
      mode: sessionObject.mode || null,
      questionKeys: keys,
      total: total,
      answered: answered,
      unanswered: unanswered,
      completed: completed,
      status: completed ? "complete" : "active",
      totalAttempts: scoped.length,
      avgResponseMs: summary.avgResponseMs,
      averageResponseMs: summary.averageResponseMs,
      scoreCounts: summary.scoreCounts,
      rates: summary.rates,
      scoreRates: summary.scoreRates,
      results: results
    };
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    storageKey: STORAGE_KEY,
    SCORE_MARKS: SCORE_MARKS.slice(),
    createDefaultState: createDefaultState,
    defaultState: createDefaultState,
    migrateState: migrateState,
    loadState: loadState,
    saveState: saveState,
    questionKey: questionKey,
    isSnoozed: isSnoozed,
    isPlayable: isPlayable,
    latestAnswerMap: latestAnswerMap,
    history: history,
    historyForQuestion: history,
    answerHistory: historyArray,
    recentAnswers: recentAnswers,
    hasWeakInRecentAnswers: hasWeakInRecentAnswers,
    isMasteredByRecentAnswers: isMasteredByRecentAnswers,
    buildQueue: buildQueue,
    createSession: createSession,
    analytics: analytics,
    filterQuestions: filterQuestions,
    sessionResult: sessionResult,
    questionType: questionType
  };

  globalObject.DrillUxV44 = api;
}(typeof globalThis === "object" ? globalThis : this));
