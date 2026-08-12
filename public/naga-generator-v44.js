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
    daiminkan: true
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
    if (code === 0) return "鳴かない";
    if (code >= 1 && code <= 3) return "チー";
    if (code === 4) return "ポン";
    return "カン";
  }

  function callCodeForMessage(message) {
    if (!message) return 0;
    if (message.type === "chi") {
      var chiKind = asInteger(message.kind);
      return chiKind != null && chiKind > 0 ? chiKind : 1;
    }
    if (message.type === "pon") return 4;
    if (message.type === "daiminkan") return 5;
    return 0;
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
      draw: null,
      actualDiscard: null,
      doraMarker: snapshot.doraMarker,
      models: [],
      probabilities: {},
      reach: [],
      callTile: null,
      callOptions: [],
      callProbabilities: null,
      callRecommended: null,
      melds: snapshot.melds.map(cloneMeld),
      comments: [],
      image: null,
      images: null,
      imageOff: null,
      imageOpen: null,
      needsScreenshot: true,
      reached: snapshot.reached,
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
    var snapshotTv = sourceType === "chi" || sourceType === "pon" || sourceType === "daiminkan"
      ? sourceTv + 1
      : sourceTv;
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
    candidate.hasRiichiJudgment = candidate.reach.some(function (value) { return Number(value) > 0; });
    candidate.sourceTv = candidateTv;
    candidate.predictionType = sourceType;
    candidate.reached = Boolean(message.reached === true || action.reached === true || snapshot.reached);
    return candidate;
  }

  function callCandidate(report, spec, entries, action, message, huro) {
    var snapshot = replayKyoku(entries, spec.tv, spec.tw);
    var rows = huroRows(huro);
    var count = modelCountFor(report, rows, []);
    var codes = huroCodes(rows);
    var actual = inferActualCall(entries, spec.tv, spec.tw);
    var candidate = commonCandidate(spec.reportId, spec.tw, spec.ts, spec.tv, "call", report, snapshot);
    candidate.callTile = tileToAppCode(message.pai);
    candidate.actualCall = actual.called;
    candidate.actualCallCode = actual.code;
    candidate.actualCallType = actual.type;
    candidate.actualDecision = actual.code;
    candidate.callOptions = codes.map(function (code) {
      return {
        code: code,
        label: callLabel(code),
        values: Array.from({ length: count }, function (_unused, modelIndex) {
          return percentFromBasisPoints(huroValue(rows[modelIndex], code));
        })
      };
    });
    candidate.callProbabilities = {
      pass: Array.from({ length: count }, function (_unused, modelIndex) {
        return percentFromBasisPoints(huroValue(rows[modelIndex], 0));
      }),
      call: Array.from({ length: count }, function (_unused, modelIndex) {
        return percentFromBasisPoints(codes
          .filter(function (code) { return code !== 0; })
          .reduce(function (sum, code) { return sum + huroValue(rows[modelIndex], code); }, 0));
      })
    };
    candidate.callRecommended = candidate.callProbabilities.call.map(function (call, modelIndex) {
      return call >= candidate.callProbabilities.pass[modelIndex];
    });
    candidate.actualCallProbability = Array.from({ length: count }, function (_unused, modelIndex) {
      return percentFromBasisPoints(huroValue(rows[modelIndex], actual.code));
    });
    candidate.actualCallProbabilityRaw = Array.from({ length: count }, function (_unused, modelIndex) {
      return huroValue(rows[modelIndex], actual.code);
    });
    candidate.models = modelNames(report).concat(Array.from({ length: Math.max(0, count - modelNames(report).length) }, function (_unused, modelIndex) {
      return "モデル" + (modelNames(report).length + modelIndex + 1);
    })).slice(0, count).map(function (name, modelIndex) {
      var bestCode = codes.reduce(function (best, code) {
        return huroValue(rows[modelIndex], code) > huroValue(rows[modelIndex], best) ? code : best;
      }, 0);
      return {
        name: name,
        recommendation: bestCode === 0 ? null : callLabel(bestCode),
        recommendationCode: bestCode,
        label: bestCode === 0 ? "鳴かない" : callLabel(bestCode)
      };
    });
    candidate.reached = Boolean(message.reached === true || action.reached === true || snapshot.reached);
    return candidate;
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

    var maxCandidates = settings.maxCandidates == null ? 100 : Number(settings.maxCandidates);
    if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 500) {
      throw new RangeError("maxCandidates must be an integer between 1 and 500");
    }

    return {
      reportId: reportId,
      thresholdPercent: threshold,
      decisionType: decisionType,
      modelMode: modelMode,
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
        var badModelIndices = Array.isArray(probabilities)
          ? probabilities.reduce(function (indices, value, modelIndex) {
            if (Number.isFinite(Number(value)) && Number(value) <= settings.thresholdPercent) indices.push(modelIndex);
            return indices;
          }, [])
          : [];
        var bad = badModelIndices.length > 0
          && (settings.modelMode === "any" || badModelIndices.length === probabilities.length);
        if (!bad) continue;
        if (candidate.decisionType === "discard"
          && (candidate.reached || candidate.actualDiscardNaga === "?")) {
          continue;
        }
        candidate.isBadMove = true;
        candidate.badMoveThresholdPercent = settings.thresholdPercent;
        candidate.badMoveModelMode = settings.modelMode;
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
    modelNames: modelNames,
    getModelNames: modelNames,
    replayKyoku: replayKyoku,
    sceneCandidate: sceneCandidate,
    normalizeExtractionOptions: normalizeExtractionOptions,
    extractBadMoves: extractBadMoves
  };

  root.NagaGeneratorV44 = api;
})(globalThis);
