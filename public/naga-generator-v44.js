(function attachNagaGeneratorV44(root) {
  "use strict";

  var HONOR_TO_APP = {
    E: "ji1",
    S: "ji2",
    W: "ji3",
    N: "ji4",
    P: "ji5",
    F: "ji6",
    C: "ji7"
  };

  var APP_TO_INDEX = {
    ji1: 27,
    ji2: 28,
    ji3: 29,
    ji4: 30,
    ji5: 31,
    ji6: 32,
    ji7: 33
  };

  var NAGA_CALL_TYPES = {
    chi: true,
    pon: true,
    daiminkan: true,
    minkan: true,
    ankan: true,
    kakan: true
  };

  var REPLAY_MELD_TYPES = {
    chi: true,
    pon: true,
    daiminkan: true,
    minkan: true,
    ankan: true,
    kakan: true
  };

  function own(object, key) {
    return object != null && Object.prototype.hasOwnProperty.call(object, key);
  }

  function asInteger(value) {
    var number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
  }

  function validSeat(value) {
    var seat = asInteger(value);
    return seat != null && seat >= 0 && seat < 4 ? seat : null;
  }

  function optionalSceneIndex(url, name) {
    var raw = url.searchParams.get(name);
    if (raw == null || raw === "") return null;
    if (!/^[0-9]+$/.test(raw)) return null;
    var value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function safeDecoded(value) {
    try {
      return decodeURIComponent(value);
    } catch (_error) {
      return value;
    }
  }

  function validReportId(value) {
    return typeof value === "string"
      && value.length > 0
      && value.length <= 256
      && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
  }

  function requireReportId(value) {
    var reportId = safeDecoded(String(value || ""));
    if (!validReportId(reportId)) {
      throw new TypeError("invalid NAGA report id");
    }
    return reportId;
  }

  function sceneUrl(reportId, tw, ts, tv) {
    var URLCtor = root.URL || (typeof URL !== "undefined" ? URL : null);
    if (!URLCtor) throw new Error("URL is unavailable");
    var url = new URLCtor("https://naga.dmv.nico/htmls/report_viewer.html");
    url.searchParams.set("report_id", reportId);
    if (tw != null) url.searchParams.set("tw", String(tw));
    if (ts != null) url.searchParams.set("ts", String(ts));
    if (tv != null) url.searchParams.set("tv", String(tv));
    return url.href;
  }

  function reportBaseUrl(reportId) {
    return sceneUrl(reportId, null, null, null);
  }

  function parseNagaUrl(input) {
    var URLCtor = root.URL || (typeof URL !== "undefined" ? URL : null);
    if (!URLCtor) throw new Error("URL is unavailable");

    var url;
    try {
      url = new URLCtor(String(input));
    } catch (_error) {
      throw new TypeError("invalid NAGA URL");
    }

    if (url.hostname.toLowerCase() !== "naga.dmv.nico") {
      throw new TypeError("non-NAGA domain");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new TypeError("invalid NAGA protocol");
    }

    var path = url.pathname.replace(/\/+$/, "");
    var parts = path.split("/").filter(Boolean);
    if (parts.length !== 2 || parts[0].toLowerCase() !== "htmls") {
      throw new TypeError("unsupported NAGA path");
    }

    var fileName = safeDecoded(parts[1]);
    var reportId;
    if (fileName.toLowerCase() === "report_viewer.html") {
      reportId = requireReportId(url.searchParams.get("report_id"));
    } else if (/\.html$/i.test(fileName)) {
      reportId = requireReportId(fileName.slice(0, -5));
    } else {
      throw new TypeError("unsupported NAGA report path");
    }

    var tw = optionalSceneIndex(url, "tw");
    var ts = optionalSceneIndex(url, "ts");
    var tv = optionalSceneIndex(url, "tv");
    var canonicalSceneUrl = sceneUrl(reportId, tw, ts, tv);
    var dedupeBase = reportBaseUrl(reportId);
    return {
      reportId: reportId,
      tw: tw,
      ts: ts,
      tv: tv,
      canonicalSceneUrl: canonicalSceneUrl,
      canonicalUrl: canonicalSceneUrl,
      dedupeBase: dedupeBase,
      dedupeKey: reportId,
      jsonUrl: "https://naga.dmv.nico/reports/" + encodeURIComponent(reportId) + ".json",
      originalUrl: url.href
    };
  }

  function parseTile(value) {
    if (typeof value !== "string") return null;
    var token = value.trim();
    var appMatch = /^(man|pin|sou)([1-9])$/.exec(token);
    if (appMatch) {
      return {
        app: appMatch[1] + appMatch[2],
        index: appMatch[1] === "man"
          ? Number(appMatch[2]) - 1
          : appMatch[1] === "pin"
            ? 9 + Number(appMatch[2]) - 1
            : 18 + Number(appMatch[2]) - 1,
        red: false
      };
    }

    var redAppMatch = /^aka([1-3])$/.exec(token);
    if (redAppMatch) {
      var redSuit = ["m", "p", "s"][Number(redAppMatch[1]) - 1];
      return {
        app: token,
        index: redSuit === "m" ? 4 : redSuit === "p" ? 13 : 22,
        red: true
      };
    }

    if (own(APP_TO_INDEX, token)) {
      return { app: token, index: APP_TO_INDEX[token], red: false };
    }

    var suited = /^([1-9])([mps])$/.exec(token);
    if (suited) {
      var number = Number(suited[1]);
      var suitOffset = suited[2] === "m" ? 0 : suited[2] === "p" ? 9 : 18;
      return {
        app: (suited[2] === "m" ? "man" : suited[2] === "p" ? "pin" : "sou") + number,
        index: suitOffset + number - 1,
        red: false
      };
    }

    var red = /^5([mps])r$/.exec(token);
    if (red) {
      return {
        app: red[1] === "m" ? "aka1" : red[1] === "p" ? "aka2" : "aka3",
        index: red[1] === "m" ? 4 : red[1] === "p" ? 13 : 22,
        red: true
      };
    }

    if (own(HONOR_TO_APP, token)) {
      return {
        app: HONOR_TO_APP[token],
        index: APP_TO_INDEX[HONOR_TO_APP[token]],
        red: false
      };
    }

    return null;
  }

  function tileToAppCode(value) {
    var parsed = parseTile(value);
    return parsed ? parsed.app : null;
  }

  function tileIndex(value) {
    var parsed = parseTile(value);
    return parsed ? parsed.index : null;
  }

  function standardAppCode(index) {
    if (!Number.isInteger(index) || index < 0 || index > 33) return null;
    if (index < 9) return "man" + (index + 1);
    if (index < 18) return "pin" + (index - 9 + 1);
    if (index < 27) return "sou" + (index - 18 + 1);
    return "ji" + (index - 27 + 1);
  }

  function modelNames(report) {
    var source = report && report.naga_types;
    if (Array.isArray(source)) return source.map(function (name) { return String(name); });
    if (!source || typeof source !== "object") return [];
    var keys = Object.keys(source)
      .filter(function (key) { return /^[0-9]+$/.test(key); })
      .sort(function (left, right) { return Number(left) - Number(right); });
    return keys.map(function (key) { return String(source[key]); });
  }

  function getMessage(entry) {
    if (!entry || !entry.info || !entry.info.msg || typeof entry.info.msg !== "object") {
      return null;
    }
    return entry.info.msg;
  }

  function appList(values) {
    if (!Array.isArray(values)) return [];
    return values.map(tileToAppCode).filter(Boolean);
  }

  function sameTile(left, right) {
    if (left === right) return true;
    var leftIndex = tileIndex(left);
    var rightIndex = tileIndex(right);
    return leftIndex != null && leftIndex === rightIndex;
  }

  function removeTile(hand, value) {
    var exact = hand.indexOf(value);
    if (exact >= 0) {
      hand.splice(exact, 1);
      return true;
    }
    for (var index = 0; index < hand.length; index += 1) {
      if (sameTile(hand[index], value)) {
        hand.splice(index, 1);
        return true;
      }
    }
    return false;
  }

  // A legacy question can contain the two/three tiles used by the current
  // call in handBeforeDraw even though the same tiles are also represented in
  // the latest meld.  Keep this repair display-only and apply it only when
  // the question itself is the discard immediately following that call.
  function isImmediateCallDiscardQuestion(question) {
    if (!question || question.decisionType !== "discard") return false;
    var predictionType = String(question.predictionType || "");
    var melds = Array.isArray(question.melds) ? question.melds : [];
    var handBeforeDraw = Array.isArray(question.handBeforeDraw) ? question.handBeforeDraw : [];
    var hasNoDraw = question.draw == null || question.draw === ""
      || (Array.isArray(question.draw) && question.draw.length === 0);
    // Legacy shared rows did not persist predictionType/immediateCallDiscard.
    // A discard with an existing meld, no draw, and a shortened concealed hand
    // is the discard immediately following that call.  Do not infer this from
    // meld count alone: later drawn discards have a draw tile and must use the
    // ordinary layout.
    var isLegacyImmediate = melds.length > 0
      && hasNoDraw
      && handBeforeDraw.length > 0
      && handBeforeDraw.length < 13
      && question.actualDiscard != null;
    return question.immediateCallDiscard === true
      || question.handMaskMode === "original-with-meld-overlay"
      || Boolean(NAGA_CALL_TYPES[predictionType])
      || isLegacyImmediate;
  }

  function meldDisplayTiles(meld) {
    if (!meld || typeof meld !== "object") return [];
    var consumed = Array.isArray(meld.consumed)
      ? meld.consumed.map(tileToAppCode).filter(Boolean)
      : [];
    if (meld.type === "ankan") return consumed;
    return [tileToAppCode(meld.pai), ...consumed].filter(Boolean);
  }

  function immediateCallMeldIndex(question) {
    if (!isImmediateCallDiscardQuestion(question)) return -1;
    var expectedType = String(question.predictionType || "");
    var melds = Array.isArray(question.melds) ? question.melds : [];
    if (!expectedType) {
      // Legacy rows have no predictionType, but their final meld is the call
      // that produced the current immediate-discard snapshot.
      return melds.length ? melds.length - 1 : -1;
    }
    for (var index = melds.length - 1; index >= 0; index -= 1) {
      var meld = melds[index];
      var actualType = meld ? String(meld.type || "") : "";
      var isOpenKanAlias = (actualType === "minkan" || actualType === "daiminkan")
        && (expectedType === "minkan" || expectedType === "daiminkan");
      if (meld && (actualType === expectedType || isOpenKanAlias)) return index;
    }
    return -1;
  }

  function currentImmediateMeld(question) {
    var index = immediateCallMeldIndex(question);
    var melds = Array.isArray(question && question.melds) ? question.melds : [];
    return index >= 0 ? melds[index] : null;
  }

  function immediateCallPreviousMeldCount(question) {
    if (!isImmediateCallDiscardQuestion(question)) return null;
    var explicit = Number(question.immediateCallPreviousMeldCount);
    if (Number.isSafeInteger(explicit) && explicit >= 0) return explicit;
    var index = immediateCallMeldIndex(question);
    if (index >= 0) return index;
    var melds = Array.isArray(question.melds) ? question.melds : [];
    return Math.max(0, melds.length - 1);
  }

  function immediateCallSlotCount(question) {
    var previousMeldCount = immediateCallPreviousMeldCount(question);
    if (previousMeldCount == null) return null;
    // The pre-call concealed area is the normal area for the melds that were
    // already open. The current call creates the holes inside that area.
    return Math.max(1, 13 - previousMeldCount * 3);
  }

  function displayConcealedHand(question) {
    var source = Array.isArray(question && question.handBeforeDraw)
      ? question.handBeforeDraw.map(tileToAppCode).filter(Boolean)
      : [];
    var currentMeld = currentImmediateMeld(question);
    var consumed = currentMeld && Array.isArray(currentMeld.consumed)
      ? currentMeld.consumed.map(tileToAppCode).filter(Boolean)
      : [];
    if (!currentMeld || !consumed.length) return source.slice();

    // After a call and before its discard, the physical hand consists of 14
    // tiles including all meld tiles.  If the saved hand is exactly larger by
    // the current meld's own consumed tiles, it is the old pre-call duplicate
    // representation.  A canonical replay snapshot already has the expected
    // count and is returned untouched.
    var totalMeldTiles = (Array.isArray(question.melds) ? question.melds : [])
      .reduce(function (total, meld) { return total + meldDisplayTiles(meld).length; }, 0);
    var expectedClosedCount = Math.max(0, 14 - totalMeldTiles);
    if (source.length !== expectedClosedCount + consumed.length) return source.slice();

    var display = source.slice();
    var removed = consumed.reduce(function (count, tile) {
      return count + (removeTile(display, tile) ? 1 : 0);
    }, 0);
    return removed === consumed.length ? display : source.slice();
  }

  // For the single event immediately after a call, preserve the pre-call
  // positions. The slot count is the ordinary concealed-hand count for the
  // melds that were already open: 13 for the first call, then 10, 7, ... for
  // the second, third, ... call. The consumed tiles are represented by null
  // slots instead of being spliced out, so the tiles to their right never
  // shift left.
  function displayConcealedHandSlots(question, sortTiles) {
    if (!question || !isImmediateCallDiscardQuestion(question)) return null;

    var explicit = Array.isArray(question.displayHandSlots)
      ? question.displayHandSlots
      : null;
    var expectedSlotCount = immediateCallSlotCount(question);
    var currentMeld = currentImmediateMeld(question);
    var consumed = currentMeld && Array.isArray(currentMeld.consumed)
      ? currentMeld.consumed.map(tileToAppCode).filter(Boolean)
      : [];
    var source = explicit || (Array.isArray(question.handBeforeMeld)
      ? question.handBeforeMeld
      : null);
    if (!source && currentMeld && consumed.length && Array.isArray(question.handBeforeDraw)) {
      var postCallHand = question.handBeforeDraw;
      // Older synchronized rows kept only the remaining concealed tiles. Add
      // the current call's consumed self tiles to a display-only copy so
      // sorting can recover the pre-call positions before replacing them with
      // holes. For a second/third/fourth call, the target is 10/7/4 slots,
      // not 13 slots.
      var targetSlotCount = expectedSlotCount || 13;
      if (postCallHand.length === targetSlotCount - consumed.length) {
        source = postCallHand.concat(consumed);
      } else if (postCallHand.length === targetSlotCount) {
        // Some legacy rows retained the duplicate pre-call snapshot instead.
        source = postCallHand;
      }
    }
    if (!Array.isArray(source) || source.length < 1 || source.length > 13) return null;
    if (!explicit && expectedSlotCount != null && source.length !== expectedSlotCount) return null;

    // The pre-call snapshot is replay order, not display order.  The UI
    // passes the same sorter used by ordinary concealed-hand rendering so
    // the holes are located after normal riichi sorting, while the original
    // 13 logical slots are still preserved.  Explicit slots are already
    // display-positioned and must not be sorted again.
    if (!explicit && typeof sortTiles === "function") {
      var sortedSource = sortTiles(source.slice());
      if (!Array.isArray(sortedSource) || sortedSource.length !== source.length) return null;
      source = sortedSource;
    }

    var slots = source.map(function (tile) {
      return tile == null ? null : tileToAppCode(tile);
    });
    for (var sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
      if (source[sourceIndex] != null && slots[sourceIndex] == null) return null;
    }

    if (explicit) return slots;

    if (!currentMeld || !consumed.length) return null;

    var usedIndexes = [];
    for (var consumedIndex = 0; consumedIndex < consumed.length; consumedIndex += 1) {
      var consumedTile = consumed[consumedIndex];
      var exactIndex = -1;
      var fallbackIndex = -1;
      for (var slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
        if (usedIndexes.indexOf(slotIndex) >= 0 || slots[slotIndex] == null) continue;
        if (slots[slotIndex] === consumedTile) {
          exactIndex = slotIndex;
          break;
        }
        if (fallbackIndex < 0 && sameTile(slots[slotIndex], consumedTile)) fallbackIndex = slotIndex;
      }
      var matchedIndex = exactIndex >= 0 ? exactIndex : fallbackIndex;
      if (matchedIndex < 0) return null;
      usedIndexes.push(matchedIndex);
    }

    usedIndexes.forEach(function (index) { slots[index] = null; });
    return slots;
  }

  function cloneMeld(meld) {
    return {
      type: meld.type,
      pai: meld.pai || null,
      consumed: Array.isArray(meld.consumed) ? meld.consumed.slice() : []
    };
  }

  function applyMeld(state, message) {
    var actor = validSeat(message && message.actor);
    if (actor == null || !REPLAY_MELD_TYPES[message.type]) return;

    var consumed = appList(message.consumed);
    consumed.forEach(function (tile) {
      removeTile(state.hands[actor], tile);
    });

    var called = tileToAppCode(message.pai);
    if (!called && consumed.length) called = consumed[0];

    if (message.type === "kakan") {
      var upgradeIndex = state.melds[actor].findIndex(function (meld) {
        return tileIndex(meld.pai) != null && tileIndex(called) === tileIndex(meld.pai)
          && (meld.type === "pon" || meld.type === "kakan");
      });
      if (upgradeIndex >= 0) {
        var upgraded = state.melds[actor][upgradeIndex];
        upgraded.type = "kakan";
        upgraded.pai = called || upgraded.pai;
        upgraded.consumed = upgraded.consumed.concat(consumed);
        return;
      }
    }

    state.melds[actor].push({
      type: message.type,
      pai: called || null,
      consumed: consumed
    });
  }

  function replayKyoku(entries, targetTv, seat) {
    var list = Array.isArray(entries) ? entries : [];
    var targetSeat = validSeat(seat);
    if (targetSeat == null) throw new RangeError("seat must be 0..3");
    var target = asInteger(targetTv);
    if (target == null || target < 0) target = list.length;

    var startIndex = -1;
    var startMessage = null;
    for (var findIndex = 0; findIndex < list.length; findIndex += 1) {
      var findMessage = getMessage(list[findIndex]);
      if (findMessage && findMessage.type === "start_kyoku") {
        startIndex = findIndex;
        startMessage = findMessage;
        break;
      }
    }

    var state = {
      hands: [[], [], [], []],
      melds: [[], [], [], []],
      reached: [false, false, false, false],
      doraMarker: startMessage ? tileToAppCode(startMessage.dora_marker) : null
    };

    if (startMessage && Array.isArray(startMessage.tehais)) {
      for (var initialSeat = 0; initialSeat < 4; initialSeat += 1) {
        state.hands[initialSeat] = appList(startMessage.tehais[initialSeat]);
      }
    }

    var processUntil = Math.min(target, list.length);
    var firstAction = Math.max(0, startIndex + 1);
    for (var index = firstAction; index < processUntil; index += 1) {
      var message = getMessage(list[index]);
      if (!message) continue;
      var actor = validSeat(message.actor);

      if (message.type === "tsumo" && actor != null) {
        var draw = tileToAppCode(message.pai);
        if (draw) state.hands[actor].push(draw);
      } else if (message.type === "dahai" && actor != null) {
        var discard = tileToAppCode(message.pai);
        if (discard) removeTile(state.hands[actor], discard);
      } else if (REPLAY_MELD_TYPES[message.type]) {
        applyMeld(state, message);
      }

      if (actor != null && message.reached === true) state.reached[actor] = true;
      if (actor != null && message.type === "reach") state.reached[actor] = true;
    }

    var hands = state.hands.map(function (hand) { return hand.slice(); });
    var melds = state.melds.map(function (seatMelds) {
      return seatMelds.map(cloneMeld);
    });
    var lastAction = target < list.length ? list[target] : null;
    return {
      seat: targetSeat,
      targetTv: target,
      hand: hands[targetSeat].slice(),
      concealed: hands[targetSeat].slice(),
      handBeforeDraw: hands[targetSeat].slice(),
      melds: melds[targetSeat].map(cloneMeld),
      allHands: hands,
      allConcealed: hands,
      allMelds: melds,
      doraMarker: state.doraMarker,
      reached: state.reached[targetSeat],
      lastAction: lastAction,
      beforeAction: true,
      processedThrough: Math.max(-1, processUntil - 1),
      hasStartKyoku: startIndex >= 0
    };
  }

  function numericKeys(object) {
    if (!object || typeof object !== "object") return [];
    return Object.keys(object)
      .filter(function (key) { return /^[0-9]+$/.test(key); })
      .sort(function (left, right) { return Number(left) - Number(right); });
  }

  function huroRows(huro) {
    if (Array.isArray(huro)) return huro.slice();
    return numericKeys(huro).map(function (key) { return huro[key]; });
  }

  function huroValue(row, code) {
    if (!row || typeof row !== "object") return 0;
    var value = row[String(code)];
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  function huroCodes(rows) {
    var codes = { "0": true };
    rows.forEach(function (row) {
      numericKeys(row).forEach(function (key) { codes[key] = true; });
    });
    return Object.keys(codes)
      .map(Number)
      .sort(function (left, right) { return left - right; });
  }

  function percentFromBasisPoints(value) {
    var number = Number(value);
    return Number.isFinite(number) ? number / 100 : 0;
  }

  function callLabel(code) {
    if (code === 0) return "スルー";
    if (code >= 1 && code <= 3) return "チー";
    if (code === 4) return "ポン";
    return "カン";
  }

  function callActionForCode(code) {
    var numericCode = Number(code);
    if (!Number.isFinite(numericCode) || numericCode === 0) return "pass";
    return numericCode >= 5 ? "kan" : "call";
  }

  function callActionLabel(action) {
    if (action === "kan") return "カン";
    if (action === "call") return "鳴く";
    return "スルー";
  }

  function callCodeForMessage(message) {
    if (!message) return 0;
    if (message.type === "chi") {
      var chiKind = asInteger(message.kind);
      return chiKind != null && chiKind > 0 ? chiKind : 1;
    }
    if (message.type === "pon") return 4;
    if (message.type === "daiminkan" || message.type === "minkan") return 5;
    if (message.type === "ankan") return 6;
    if (message.type === "kakan") return 7;
    return 0;
  }

  function callActionValue(rows, kanRows, modelIndex, action) {
    var total = 0;
    var row = Array.isArray(rows) ? rows[modelIndex] : null;
    var kanRow = Array.isArray(kanRows) ? kanRows[modelIndex] : null;
    if (action === "pass") {
      total += huroValue(row, 0);
      total += huroValue(kanRow, 0);
    } else if (action === "call") {
      for (var code = 1; code <= 4; code += 1) total += huroValue(row, code);
    } else {
      for (var huroCode = 5; huroCode <= 99; huroCode += 1) total += huroValue(row, huroCode);
      total += huroValue(kanRow, 1);
    }
    return total;
  }

  function callActionOptions(rows, kanRows, count) {
    var huroCodeList = huroCodes(rows);
    var hasCall = huroCodeList.some(function (code) { return code >= 1 && code <= 4; });
    var hasKan = huroCodeList.some(function (code) { return code >= 5; })
      || (Array.isArray(kanRows) && kanRows.some(function (row) { return huroValue(row, 1) > 0 || own(row, "1"); }));
    var actions = ["pass"];
    if (hasCall) actions.push("call");
    if (hasKan) actions.push("kan");
    return actions.map(function (action) {
      return {
        action: action,
        label: callActionLabel(action),
        rawCodes: action === "pass" ? [0] : action === "call" ? [1, 2, 3, 4] : [5, 6, 7],
        values: Array.from({ length: count }, function (_unused, modelIndex) {
          return percentFromBasisPoints(callActionValue(rows, kanRows, modelIndex, action));
        })
      };
    });
  }

  function bestCallActions(options, count) {
    return Array.from({ length: count }, function (_unused, modelIndex) {
      return options.reduce(function (best, option) {
        return Number(option.values[modelIndex] || 0) > Number(best.values[modelIndex] || 0) ? option : best;
      }, options[0] || { action: "pass", values: [0] }).action;
    });
  }

  function callActionProbabilityMap(options, count) {
    var map = { pass: [], call: [], kan: [] };
    options.forEach(function (option) {
      map[option.action] = Array.from({ length: count }, function (_unused, modelIndex) {
        return Number(option.values[modelIndex] || 0);
      });
    });
    return map;
  }

  function rawCallOptions(rows, kanRows, count) {
    var codes = huroCodes(rows);
    var options = codes.map(function (code) {
      return {
        code: code,
        label: callLabel(code),
        values: Array.from({ length: count }, function (_unused, modelIndex) {
          return percentFromBasisPoints(huroValue(Array.isArray(rows) ? rows[modelIndex] : null, code));
        })
      };
    });
    var hasKan = Array.isArray(kanRows) && kanRows.some(function (row) { return huroValue(row, 1) > 0 || own(row, "1"); });
    if (hasKan) {
      options.push({
        code: 6,
        label: "カン",
        values: Array.from({ length: count }, function (_unused, modelIndex) {
          return percentFromBasisPoints(huroValue(kanRows[modelIndex], 1));
        })
      });
    }
    return options;
  }

  function inferKanTile(entries, targetTv, seat, snapshot, message) {
    for (var index = targetTv + 1; index < entries.length; index += 1) {
      var nextMessage = getMessage(entries[index]);
      if (!nextMessage) continue;
      if ((nextMessage.type === "ankan" || nextMessage.type === "minkan" || nextMessage.type === "daiminkan" || nextMessage.type === "kakan")
        && validSeat(nextMessage.actor) === seat) {
        var consumed = appList(nextMessage.consumed);
        if (consumed.length) return consumed[0];
        return tileToAppCode(nextMessage.pai);
      }
      if (nextMessage.type === "tsumo" && index > targetTv + 1) break;
    }
    var counts = {};
    (snapshot && snapshot.handBeforeDraw || []).forEach(function (tile) {
      var index = tileIndex(tile);
      if (index != null) counts[index] = (counts[index] || 0) + 1;
    });
    if (message && message.type === "tsumo") {
      var drawnIndex = tileIndex(message.pai);
      if (drawnIndex != null) counts[drawnIndex] = (counts[drawnIndex] || 0) + 1;
    }
    var kanIndex = Object.keys(counts).find(function (key) { return counts[key] >= 4; });
    return kanIndex == null ? null : standardAppCode(Number(kanIndex));
  }

  function inferActualCall(entries, targetTv, seat) {
    for (var index = targetTv + 1; index < entries.length; index += 1) {
      var message = getMessage(entries[index]);
      if (!message) continue;
      if (NAGA_CALL_TYPES[message.type]) {
        return {
          called: validSeat(message.actor) === seat,
          code: validSeat(message.actor) === seat ? callCodeForMessage(message) : 0,
          type: validSeat(message.actor) === seat ? message.type : null
        };
      }
      if (message.type === "tsumo") {
        return { called: false, code: 0, type: null };
      }
    }
    return { called: false, code: 0, type: null };
  }

  function normalizeSpec(spec, report) {
    if (typeof spec === "string") return parseNagaUrl(spec);
    if (spec && typeof spec.nagaUrl === "string") {
      var parsed = parseNagaUrl(spec.nagaUrl);
      spec = Object.assign({}, parsed, spec);
    }

    var reportId = spec && spec.reportId;
    if (!reportId && report) {
      reportId = report.reportId || report.report_id || report.id || report.haihu_id;
    }
    if (reportId != null) reportId = requireReportId(reportId);

    var tw = validSeat(spec && spec.tw);
    var ts = asInteger(spec && spec.ts);
    var tv = asInteger(spec && spec.tv);
    if (ts == null || ts < 0) ts = null;
    if (tv == null || tv < 0) tv = null;

    var canonicalSceneUrl = spec && spec.canonicalSceneUrl;
    if (!canonicalSceneUrl && reportId) {
      canonicalSceneUrl = sceneUrl(reportId, tw, ts, tv);
    }

    return {
      reportId: reportId || null,
      tw: tw,
      ts: ts,
      tv: tv,
      canonicalSceneUrl: canonicalSceneUrl || null
    };
  }

  function modelCountFor(report, rows, predictions) {
    return Math.max(
      modelNames(report).length,
      Array.isArray(rows) ? rows.length : 0,
      Array.isArray(predictions) ? predictions.length : 0
    );
  }

  function probabilityMatrix(rows, predictions, observedTiles, count) {
    var probabilities = {};
    for (var tileNumber = 0; tileNumber < 34; tileNumber += 1) {
      var standard = standardAppCode(tileNumber);
      probabilities[standard] = Array.from({ length: count }, function (_unused, modelIndex) {
        var row = Array.isArray(rows) ? rows[modelIndex] : null;
        return percentFromBasisPoints(Array.isArray(row) ? row[tileNumber] : 0);
      });
    }

    (observedTiles || []).forEach(function (tile) {
      var parsed = parseTile(tile);
      if (!parsed || !parsed.red) return;
      var standard = standardAppCode(parsed.index);
      probabilities[parsed.app] = probabilities[standard]
        ? probabilities[standard].slice()
        : Array.from({ length: count }, function () { return 0; });
    });
    return probabilities;
  }

  function recommendationModels(report, predictions, rows, actualIndex, count) {
    var names = modelNames(report);
    return Array.from({ length: count }, function (_unused, modelIndex) {
      var recommendation = tileToAppCode(Array.isArray(predictions) ? predictions[modelIndex] : null);
      var row = Array.isArray(rows) ? rows[modelIndex] : null;
      return {
        name: names[modelIndex] || "モデル" + (modelIndex + 1),
        recommendation: recommendation,
        label: recommendation,
        actualProbability: percentFromBasisPoints(Array.isArray(row) ? row[actualIndex] : 0)
      };
    });
  }

  function hasActualReachAfterPrediction(entries, predictionIndex, targetSeat) {
    var index = asInteger(predictionIndex);
    var seat = validSeat(targetSeat);
    if (index == null || index < 0 || seat == null || !Array.isArray(entries)) return false;
    // NAGA records the player's real reach as a separate event immediately
    // after the prediction-bearing action and before the following discard.
    // Keep the window short so a later unrelated reach is never attached.
    return entries.slice(index + 1, index + 4).some(function (entry) {
      var message = getMessage(entry);
      return message && message.type === "reach" && validSeat(message.actor) === seat;
    });
  }

  function commonCandidate(reportId, seat, ts, tv, decisionType, report, snapshot) {
    var playerNames = report && report.player_info && report.player_info.name;
    var player = Array.isArray(playerNames) ? playerNames[seat] || null : null;
    return {
      id: reportId + "|" + seat + "|" + ts + "|" + tv + "|" + decisionType,
      nagaUrl: sceneUrl(reportId, seat, ts, tv),
      player: player,
      playerName: player,
      playerSeat: seat,
      tw: seat,
      decisionType: decisionType,
      handBeforeDraw: snapshot.handBeforeDraw.slice(),
      handBeforeMeld: null,
      draw: null,
      actualDiscard: null,
      doraMarker: snapshot.doraMarker,
      models: [],
      probabilities: {},
      reach: [],
      callTile: null,
      callOptions: [],
      callActionOptions: [],
      callProbabilities: null,
      callActionProbabilities: null,
      callRecommended: null,
      callRecommendedActions: null,
      actualCallAction: null,
      melds: snapshot.melds.map(cloneMeld),
      immediateCallDiscard: false,
      immediateCallPreviousMeldCount: null,
      handMaskMode: null,
      comments: [],
      image: null,
      images: null,
      imageOff: null,
      imageOpen: null,
      needsScreenshot: true,
      reached: snapshot.reached,
      actualReach: false,
      ts: ts,
      tv: tv,
      sourceReportId: reportId
    };
  }

  function discardCandidate(report, spec, entries, action, message, sourceTv) {
    var seat = spec.tw;
    var candidateTv = asInteger(sourceTv);
    if (candidateTv == null || candidateTv < 0) candidateTv = spec.tv;
    var rawDiscard = message.real_dahai;
    if (rawDiscard == null || rawDiscard === "?" || tileToAppCode(rawDiscard) == null) {
      return null;
    }

    var predictionRows = action.dahai_pred;
    var predictions = message.pred_dahai;
    if (!Array.isArray(predictionRows) || !Array.isArray(predictions)) return null;

    var sourceType = message.type;
    var isCallDiscard = Boolean(NAGA_CALL_TYPES[sourceType]);
    var snapshotTv = sourceType === "chi" || sourceType === "pon" || sourceType === "daiminkan"
      ? sourceTv + 1
      : sourceTv;
    var preCallSnapshot = isCallDiscard ? replayKyoku(entries, sourceTv, seat) : null;
    var snapshot = replayKyoku(entries, snapshotTv, seat);
    var count = modelCountFor(report, predictionRows, predictions);
    var actualIndex = tileIndex(rawDiscard);
    var observed = snapshot.handBeforeDraw.concat([message.pai, rawDiscard]).concat(predictions);
    var probabilities = probabilityMatrix(predictionRows, predictions, observed, count);
    var models = recommendationModels(report, predictions, predictionRows, actualIndex, count);
    // A dahai entry can be only the post-discard companion of the preceding
    // prediction-bearing tsumo entry. Keep every outward-facing coordinate
    // on the prediction-bearing, pre-discard event so capture and replay use
    // the same hand state as the candidate calculation.
    var candidate = commonCandidate(spec.reportId, seat, spec.ts, candidateTv, "discard", report, snapshot);
    candidate.handBeforeDraw = snapshot.handBeforeDraw.slice();
    candidate.handBeforeMeld = preCallSnapshot ? preCallSnapshot.handBeforeDraw.slice() : null;
    candidate.draw = message.type === "tsumo" ? tileToAppCode(message.pai) : null;
    candidate.actualDiscard = tileToAppCode(rawDiscard);
    candidate.actualDiscardNaga = rawDiscard;
    candidate.actualDiscardProbability = models.map(function (model) { return model.actualProbability; });
    candidate.actualDiscardProbabilityRaw = models.map(function (model) {
      var row = predictionRows[models.indexOf(model)];
      return Array.isArray(row) ? Number(row[actualIndex] || 0) : 0;
    });
    candidate.doraMarker = snapshot.doraMarker;
    candidate.models = models;
    candidate.probabilities = probabilities;
    candidate.reach = Array.isArray(action.reach)
      ? action.reach.slice()
      : Array.isArray(message.reach)
        ? message.reach.slice()
        : [];
    candidate.actualReach = hasActualReachAfterPrediction(entries, candidateTv, seat);
    candidate.hasRiichiJudgment = candidate.reach.some(function (value) { return Number(value) > 0; })
      || candidate.actualReach;
    candidate.sourceTv = candidateTv;
    candidate.predictionType = sourceType;
    candidate.immediateCallDiscard = isCallDiscard;
    candidate.immediateCallPreviousMeldCount = isCallDiscard && preCallSnapshot
      ? preCallSnapshot.melds.length
      : null;
    candidate.handMaskMode = candidate.immediateCallDiscard ? "original-with-meld-overlay" : null;
    candidate.reached = Boolean(message.reached === true || action.reached === true || snapshot.reached);
    return candidate;
  }

  function callCandidate(report, spec, entries, action, message, huro, kan) {
    var snapshot = replayKyoku(entries, spec.tv, spec.tw);
    var rows = huroRows(huro);
    var kanRows = huroRows(kan);
    var count = modelCountFor(report, rows, kanRows);
    var codes = huroCodes(rows);
    var actual = inferActualCall(entries, spec.tv, spec.tw);
    var actionOptions = callActionOptions(rows, kanRows, count);
    var actionProbabilities = callActionProbabilityMap(actionOptions, count);
    var actionRecommendations = bestCallActions(actionOptions, count);
    var hasCallAction = actionOptions.some(function (option) { return option.action === "call"; });
    var candidate = commonCandidate(spec.reportId, spec.tw, spec.ts, spec.tv, "call", report, snapshot);
    candidate.callTile = kanRows.length
      ? inferKanTile(entries, spec.tv, spec.tw, snapshot, message)
      : tileToAppCode(message.pai);
    candidate.draw = kanRows.length && message.type === "tsumo" ? tileToAppCode(message.pai) : null;
    candidate.actualCall = actual.called;
    candidate.actualCallCode = actual.code;
    candidate.actualCallType = actual.type;
    candidate.actualCallAction = actual.called ? callActionForCode(actual.code) : "pass";
    candidate.actualDecision = actual.code;
    candidate.callOptions = rawCallOptions(rows, kanRows, count);
    candidate.callActionOptions = actionOptions;
    candidate.callActionProbabilities = actionProbabilities;
    candidate.callProbabilities = {
      pass: actionProbabilities.pass.slice(),
      call: (hasCallAction ? actionProbabilities.call : actionProbabilities.kan).slice()
    };
    candidate.callRecommendedActions = actionRecommendations;
    candidate.callRecommended = actionRecommendations.map(function (recommendation) { return recommendation !== "pass"; });
    candidate.actualCallProbability = Array.from({ length: count }, function (_unused, modelIndex) {
      var action = candidate.actualCallAction || "pass";
      return actionProbabilities[action]?.[modelIndex] ?? 0;
    });
    candidate.actualCallProbabilityRaw = Array.from({ length: count }, function (_unused, modelIndex) {
      return callActionValue(rows, kanRows, modelIndex, candidate.actualCallAction || "pass");
    });
    var names = modelNames(report);
    candidate.models = names.concat(Array.from({ length: Math.max(0, count - names.length) }, function (_unused, modelIndex) {
      return "モデル" + (names.length + modelIndex + 1);
    })).slice(0, count).map(function (name, modelIndex) {
      var bestAction = actionRecommendations[modelIndex] || "pass";
      var recommendationCode = bestAction === "pass" ? 0 : bestAction === "kan" ? 6 : (codes.find(function (code) { return code >= 1 && code <= 4; }) || 1);
      return {
        name: name,
        recommendation: bestAction === "pass" ? null : callActionLabel(bestAction),
        recommendationCode: recommendationCode,
        callAction: bestAction,
        label: callActionLabel(bestAction)
      };
    });
    candidate.reached = Boolean(message.reached === true || action.reached === true || snapshot.reached);
    candidate.predictionType = kanRows.length ? "kan" : "call";
    return candidate;
  }

  function kanCandidate(report, spec, entries, action, message) {
    return callCandidate(report, spec, entries, action, message, null, action.kan);
  }

  function sceneCandidate(report, spec) {
    var normalized;
    try {
      normalized = normalizeSpec(spec, report);
    } catch (_error) {
      return null;
    }
    if (!report || !Array.isArray(report.pred)
      || normalized.reportId == null
      || normalized.tw == null
      || normalized.ts == null
      || normalized.tv == null) {
      return null;
    }

    var entries = report.pred[normalized.ts];
    if (!Array.isArray(entries)) return null;
    var action = entries[normalized.tv];
    var message = getMessage(action);
    if (!message) return null;

    if (message.type === "dahai" && validSeat(message.actor) !== normalized.tw
      && action && action.huro && own(action.huro, String(normalized.tw))) {
      return callCandidate(report, normalized, entries, action, message, action.huro[String(normalized.tw)]);
    }

    if (action && Array.isArray(action.kan) && validSeat(message.actor) === normalized.tw) {
      return kanCandidate(report, normalized, entries, action, message);
    }

    var sourceAction = action;
    var sourceMessage = message;
    var sourceTv = normalized.tv;
    var hasPrediction = Array.isArray(sourceAction && sourceAction.dahai_pred)
      && Array.isArray(sourceMessage.pred_dahai);

    if (!hasPrediction && message.type === "dahai") {
      var previousAction = entries[normalized.tv - 1];
      var previousMessage = getMessage(previousAction);
      if (previousMessage
        && validSeat(previousMessage.actor) === normalized.tw
        && Array.isArray(previousAction && previousAction.dahai_pred)
        && Array.isArray(previousMessage.pred_dahai)) {
        sourceAction = previousAction;
        sourceMessage = previousMessage;
        sourceTv = normalized.tv - 1;
        hasPrediction = true;
      }
    }

    var discardTypes = {
      tsumo: true,
      chi: true,
      pon: true,
      daiminkan: true,
      dahai: true
    };
    if (!hasPrediction || !discardTypes[sourceMessage.type]
      || validSeat(sourceMessage.actor) !== normalized.tw) {
      return null;
    }
    return discardCandidate(report, normalized, entries, sourceAction, sourceMessage, sourceTv);
  }

  var EXTRACTION_DECISIONS = {
    all: true,
    discard: true,
    call: true,
    reach: true
  };

  var EXTRACTION_MODEL_MODES = {
    any: true,
    all: true
  };

  function normalizeExtractionOptions(options) {
    var settings = options || {};
    var reportId = settings.reportId == null ? null : requireReportId(settings.reportId);
    var threshold = settings.thresholdPercent == null ? 5 : Number(settings.thresholdPercent);
    if (!Number.isFinite(threshold) || threshold < 0.1 || threshold > 50) {
      throw new RangeError("thresholdPercent must be between 0.1 and 50");
    }

    var decisionType = settings.decisionType == null ? "all" : String(settings.decisionType);
    if (!EXTRACTION_DECISIONS[decisionType]) {
      throw new TypeError("decisionType must be all, discard, call, or reach");
    }

    var modelMode = settings.modelMode == null ? "any" : String(settings.modelMode);
    if (!EXTRACTION_MODEL_MODES[modelMode]) {
      throw new TypeError("modelMode must be any or all");
    }

    var modelNames = Array.isArray(settings.modelNames)
      ? Array.from(new Set(settings.modelNames
        .map(function (name) { return String(name || "").trim(); })
        .filter(Boolean)))
      : [];

    var maxCandidates = settings.maxCandidates == null ? 100 : Number(settings.maxCandidates);
    if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 500) {
      throw new RangeError("maxCandidates must be an integer between 1 and 500");
    }

    return {
      reportId: reportId,
      thresholdPercent: threshold,
      decisionType: decisionType,
      modelMode: modelMode,
      modelNames: modelNames,
      maxCandidates: maxCandidates
    };
  }

  function candidateMatchesDecision(candidate, decisionType) {
    if (decisionType === "all") return true;
    if (decisionType === "call") return candidate.decisionType === "call";
    if (candidate.decisionType !== "discard") return false;
    if (decisionType === "reach") return Boolean(candidate.hasRiichiJudgment);
    return !candidate.hasRiichiJudgment;
  }

  function candidateProbabilityValues(candidate) {
    return candidate.decisionType === "call"
      ? candidate.actualCallProbability
      : candidate.actualDiscardProbability;
  }

  function extractBadMoves(report, seat, options) {
    var targetSeat = validSeat(seat);
    if (targetSeat == null) throw new RangeError("seat must be 0..3");
    var settings = normalizeExtractionOptions(options);
    if (!report || !Array.isArray(report.pred)) return [];

    var reportId = settings.reportId || report.reportId || report.report_id || report.id || report.haihu_id;
    if (!validReportId(String(reportId || ""))) reportId = "report";
    reportId = String(reportId);
    var results = [];
    var seen = {};

    for (var ts = 0; ts < report.pred.length; ts += 1) {
      var entries = report.pred[ts];
      if (!Array.isArray(entries)) continue;
      for (var tv = 0; tv < entries.length; tv += 1) {
        var candidate = sceneCandidate(report, {
          reportId: reportId,
          tw: targetSeat,
          ts: ts,
          tv: tv,
          canonicalSceneUrl: sceneUrl(reportId, targetSeat, ts, tv)
        });
        if (!candidate || seen[candidate.id]) continue;
        if (!candidateMatchesDecision(candidate, settings.decisionType)) continue;
        var probabilities = candidateProbabilityValues(candidate);
        var analyzedModelNames = modelNames(report);
        var requestedModelIndices = settings.modelNames.length
          ? settings.modelNames.map(function (name) { return analyzedModelNames.indexOf(name); }).filter(function (modelIndex) { return modelIndex >= 0; })
          : [];
        var consideredModelIndices = settings.modelNames.length
          ? requestedModelIndices
          : (Array.isArray(probabilities) ? probabilities.map(function (_value, modelIndex) { return modelIndex; }) : []);
        var badModelIndices = Array.isArray(probabilities)
          ? consideredModelIndices.filter(function (modelIndex) {
            var value = probabilities[modelIndex];
            return Number.isFinite(Number(value)) && Number(value) <= settings.thresholdPercent;
          })
          : [];
        var bad = badModelIndices.length > 0
          && (settings.modelMode === "any" || badModelIndices.length === consideredModelIndices.length);
        if (!bad) continue;
        if (candidate.decisionType === "discard"
          && (candidate.reached || candidate.actualDiscardNaga === "?")) {
          continue;
        }
        candidate.isBadMove = true;
        candidate.badMoveThresholdPercent = settings.thresholdPercent;
        candidate.badMoveModelMode = settings.modelMode;
        candidate.badMoveSelectedModels = consideredModelIndices.map(function (modelIndex) {
          return analyzedModelNames[modelIndex];
        }).filter(Boolean);
        candidate.badMoveModels = badModelIndices.map(function (modelIndex) {
          return candidate.models[modelIndex] && candidate.models[modelIndex].name;
        }).filter(Boolean);
        seen[candidate.id] = true;
        results.push(candidate);
        if (results.length >= settings.maxCandidates) break;
      }
      if (results.length >= settings.maxCandidates) break;
    }
    return results;
  }

  var api = {
    parseNagaUrl: parseNagaUrl,
    tileToAppCode: tileToAppCode,
    nagaTileToAppCode: tileToAppCode,
    convertTile: tileToAppCode,
    tileIndex: tileIndex,
    nagaTileIndex: tileIndex,
    tileToNagaIndex: tileIndex,
    displayConcealedHand: displayConcealedHand,
    displayConcealedHandSlots: displayConcealedHandSlots,
    immediateCallPreviousMeldCount: immediateCallPreviousMeldCount,
    modelNames: modelNames,
    getModelNames: modelNames,
    replayKyoku: replayKyoku,
    sceneCandidate: sceneCandidate,
    normalizeExtractionOptions: normalizeExtractionOptions,
    extractBadMoves: extractBadMoves
  };

  root.NagaGeneratorV44 = api;
})(globalThis);
