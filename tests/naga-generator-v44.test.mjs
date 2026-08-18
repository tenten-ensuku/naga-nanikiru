import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const moduleUrl = new URL("../public/naga-generator-v44.js", import.meta.url);

async function loadApi() {
  const source = await readFile(moduleUrl, "utf8");
  const sandbox = { URL, URLSearchParams, console };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: "naga-generator-v44.js" });
  assert.ok(sandbox.NagaGeneratorV44);
  return sandbox.NagaGeneratorV44;
}

function msg(type, fields = {}) {
  return { info: { msg: { type, ...fields } } };
}

function startKyoku(tehais = [
  ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m", "E", "S", "W", "N"],
  ["1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p", "P", "F", "C", "1s"],
  ["2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "1m", "2m", "3m", "4m", "5m"],
  ["6m", "7m", "8m", "9m", "1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p"]
]) {
  return msg("start_kyoku", {
    tehais,
    dora_marker: "3m"
  });
}

function discardPrediction(actor, realDahai, predictions, rows, fields = {}) {
  return {
    info: {
      msg: {
        type: "tsumo",
        actor,
        pai: "5p",
        real_dahai: realDahai,
        pred_dahai: predictions,
        reached: false,
        ...fields
      }
    },
    dahai_pred: rows
  };
}

test("parses old and new URLs to one canonical scene and dedupe base", async () => {
  const api = await loadApi();
  const oldUrl = "https://naga.dmv.nico/htmls/abc_123v2_2.html?tw=3&ts=2&tv=72";
  const newerUrl = "https://naga.dmv.nico/htmls/report_viewer.html?report_id=abc_123v2_2&tv=72&ts=2&tw=3";
  const old = api.parseNagaUrl(oldUrl);
  const newer = api.parseNagaUrl(newerUrl);
  assert.deepEqual(
    { reportId: old.reportId, tw: old.tw, ts: old.ts, tv: old.tv },
    { reportId: "abc_123v2_2", tw: 3, ts: 2, tv: 72 }
  );
  assert.equal(old.canonicalSceneUrl, newer.canonicalSceneUrl);
  assert.equal(old.dedupeBase, newer.dedupeBase);
  assert.equal(old.dedupeKey, newer.dedupeKey);
  assert.match(old.canonicalSceneUrl, /report_viewer\.html\?report_id=abc_123v2_2&tw=3&ts=2&tv=72/);
  assert.equal(api.parseNagaUrl("https://naga.dmv.nico/htmls/report_viewer.html?report_id=abc").tw, null);
});

test("rejects non-NAGA domains, invalid paths, and invalid report ids", async () => {
  const api = await loadApi();
  assert.throws(() => api.parseNagaUrl("https://example.com/htmls/abc.html"), /non-NAGA/);
  assert.throws(() => api.parseNagaUrl("https://naga.dmv.nico/reports/abc.json"), /unsupported/);
  assert.throws(() => api.parseNagaUrl("https://naga.dmv.nico/htmls/report_viewer.html?report_id=../secret"), /invalid/);
  assert.throws(() => api.parseNagaUrl("https://naga.dmv.nico.evil/htmls/abc.html"), /non-NAGA/);
});

test("converts suited, honor, and red tiles to app codes and standard indexes", async () => {
  const api = await loadApi();
  assert.equal(api.tileToAppCode("1m"), "man1");
  assert.equal(api.tileToAppCode("9p"), "pin9");
  assert.equal(api.tileToAppCode("7s"), "sou7");
  assert.equal(api.tileToAppCode("E"), "ji1");
  assert.equal(api.tileToAppCode("C"), "ji7");
  assert.equal(api.tileToAppCode("5mr"), "aka1");
  assert.equal(api.tileToAppCode("5pr"), "aka2");
  assert.equal(api.tileToAppCode("5sr"), "aka3");
  assert.equal(api.tileIndex("5mr"), api.tileIndex("5m"));
  assert.equal(api.tileIndex("5pr"), 13);
  assert.equal(api.tileIndex("5sr"), 22);
  assert.equal(api.tileIndex("E"), 27);
  assert.equal(api.tileIndex("C"), 33);
  assert.equal(api.tileToAppCode("11m"), null);
  assert.equal(api.tileIndex("not-a-tile"), null);
});

test("orders model names by numeric naga_types keys", async () => {
  const api = await loadApi();
  assert.deepEqual(Array.from(api.modelNames({ naga_types: { "2": "カガシ", "0": "ニシキ", "1": "ヒバカリ" } })), [
    "ニシキ",
    "ヒバカリ",
    "カガシ"
  ]);
});

test("builds a q41-like discard candidate with percentage probabilities and raw reach", async () => {
  const api = await loadApi();
  const rows = [
    Array(34).fill(0),
    Array(34).fill(0),
    Array(34).fill(0)
  ];
  rows[0][4] = 500;
  rows[1][4] = 2500;
  rows[2][4] = 5000;
  rows[0][21] = 9500;
  rows[1][21] = 8000;
  rows[2][21] = 7000;
  const report = {
    reportId: "q41report",
    naga_types: { "0": "ニシキ", "1": "ヒバカリ", "2": "カガシ" },
    player_info: { name: ["A", "B", "C", "D"] },
    pred: [[
      startKyoku(),
      discardPrediction(3, "5m", ["4s", "4s", "4s"], rows, { reach: [7217, 4644, 4780] })
    ]]
  };
  const candidate = api.sceneCandidate(report, {
    reportId: "q41report",
    tw: 3,
    ts: 0,
    tv: 1
  });
  assert.equal(candidate.decisionType, "discard");
  assert.equal(candidate.actualDiscard, "man5");
  assert.equal(candidate.models[0].recommendation, "sou4");
  assert.deepEqual(Array.from(candidate.actualDiscardProbability), [5, 25, 50]);
  assert.equal(candidate.probabilities.man5[0], 5);
  assert.deepEqual(Array.from(candidate.reach), [7217, 4644, 4780]);
  assert.equal(candidate.needsScreenshot, true);
  assert.equal(candidate.image, null);
  assert.equal(candidate.images, null);
  assert.match(candidate.id, /^q41report\|3\|0\|1\|discard$/);
});

test("marks an actual reach as a reach judgment even when model reach rates are zero", async () => {
  const api = await loadApi();
  const rows = [Array(34).fill(0), Array(34).fill(0)];
  rows[0][4] = 9000;
  rows[1][4] = 9000;
  const report = {
    reportId: "actual-reach-report",
    naga_types: { "0": "ニシキ", "1": "カガシ" },
    player_info: { name: ["A", "B", "C", "D"] },
    pred: [[
      startKyoku(),
      discardPrediction(3, "5m", ["4s", "4s"], rows, { reach: [0, 0] }),
      msg("reach", { actor: 3 }),
      msg("dahai", { actor: 3, pai: "5m" })
    ]]
  };
  const candidate = api.sceneCandidate(report, {
    reportId: "actual-reach-report",
    tw: 3,
    ts: 0,
    tv: 1
  });
  assert.equal(candidate.actualReach, true);
  assert.equal(candidate.hasRiichiJudgment, true);
});

test("handles a dahai fallback by using the previous tsumo prediction", async () => {
  const api = await loadApi();
  const rows = [Array(34).fill(0)];
  rows[0][0] = 1000;
  const report = {
    reportId: "fallback",
    naga_types: { "0": "ニシキ" },
    pred: [[
      startKyoku(),
      discardPrediction(0, "1m", ["1m"], rows),
      msg("dahai", { actor: 0, pai: "1m", p_msg: { type: "tsumo", actor: 0, pai: "5p" } })
    ]]
  };
  const candidate = api.sceneCandidate(report, { reportId: "fallback", tw: 0, ts: 0, tv: 2 });
  assert.equal(candidate.sourceTv, 1);
  assert.equal(candidate.actualDiscard, "man1");
  assert.equal(candidate.draw, "pin5");
});

test("builds huro pass/call options and infers the next actual call", async () => {
  const api = await loadApi();
  const report = {
    reportId: "q63report",
    naga_types: { "0": "ニシキ", "1": "カガシ" },
    player_info: { name: ["A", "B", "C", "D"] },
    pred: [[
      startKyoku(),
      msg("dahai", {
        actor: 0,
        pai: "5m",
        huro: undefined
      }),
      {
        info: {
          msg: {
            type: "dahai",
            actor: 0,
            pai: "5p",
            reached: false
          }
        },
        huro: {
          "2": [
            { "0": 9500, "4": 500 },
            { "0": 3000, "4": 7000 }
          ]
        }
      },
      msg("pon", { actor: 2, kind: 4, target: 0, pai: "5p", consumed: ["5p", "5p"] }),
      msg("dahai", { actor: 2, pai: "9p" })
    ]]
  };
  const candidate = api.sceneCandidate(report, { reportId: "q63report", tw: 2, ts: 0, tv: 2 });
  assert.equal(candidate.decisionType, "call");
  assert.equal(candidate.callTile, "pin5");
  assert.deepEqual(Array.from(candidate.callProbabilities.pass), [95, 30]);
  assert.deepEqual(Array.from(candidate.callProbabilities.call), [5, 70]);
  assert.deepEqual(Array.from(candidate.actualCallProbability), [5, 70]);
  assert.equal(candidate.actualCall, true);
  assert.equal(candidate.actualCallCode, 4);
  assert.deepEqual(Array.from(candidate.callRecommended), [false, true]);
});

test("builds kan choices from the separate kan prediction rows", async () => {
  const api = await loadApi();
  const report = {
    reportId: "kan-report",
    naga_types: { "0": "ニシキ", "1": "カガシ" },
    player_info: { name: ["A", "B", "C", "D"] },
    pred: [[
      startKyoku([
        ["4m", "W", "2m", "2m", "W", "5m", "8s", "6s", "7p", "3m", "8p", "W", "W"],
        ["1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p", "P", "F", "C", "1s"],
        ["2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "1m", "2m", "3m", "4m", "5m"],
        ["6m", "7m", "8m", "9m", "1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p"]
      ]),
      {
        info: { msg: { type: "tsumo", actor: 0, pai: "4s", real_dahai: "?", pred_dahai: ["W", "W"] } },
        kan: [{ "0": 88, "1": 9911 }, { "0": 2735, "1": 7264 }]
      },
      msg("ankan", { actor: 0, pai: "W", consumed: ["W", "W", "W", "W"] })
    ]]
  };
  const candidate = api.sceneCandidate(report, { reportId: "kan-report", tw: 0, ts: 0, tv: 1 });
  assert.equal(candidate.decisionType, "call");
  assert.equal(candidate.predictionType, "kan");
  assert.equal(candidate.callTile, "ji3");
  assert.equal(candidate.draw, "sou4");
  assert.deepEqual(Array.from(candidate.callActionOptions, option => option.action), ["pass", "kan"]);
  assert.deepEqual(Array.from(candidate.callActionProbabilities.pass), [0.88, 27.35]);
  assert.deepEqual(Array.from(candidate.callActionProbabilities.kan), [99.11, 72.64]);
  assert.deepEqual(Array.from(candidate.callRecommendedActions), ["kan", "kan"]);
  assert.deepEqual(Array.from(candidate.models, model => model.callAction), ["kan", "kan"]);
  assert.equal(candidate.actualCallAction, "kan");
  assert.equal(candidate.actualCallCode, 6);
});

test("uses tw as the seat and never as the pred/model index", async () => {
  const api = await loadApi();
  const rows = [Array(34).fill(0), Array(34).fill(0)];
  rows[0][0] = 100;
  rows[1][0] = 200;
  const report = {
    reportId: "seat-report",
    naga_types: { "0": "M0", "1": "M1" },
    pred: [[
      startKyoku(),
      discardPrediction(3, "1m", ["1m", "2m"], rows)
    ]]
  };
  const candidate = api.sceneCandidate(report, { reportId: "seat-report", tw: 3, ts: 0, tv: 1 });
  assert.equal(candidate.playerSeat, 3);
  assert.equal(candidate.models.length, 2);
  assert.equal(candidate.models[1].recommendation, "man2");
  assert.equal(candidate.handBeforeDraw.length, 13);
});

test("replays draw, discard, calls, and kan melds while ignoring nested p_msg", async () => {
  const api = await loadApi();
  const entries = [
    startKyoku([
      ["1m", "1m", "2m", "3m", "5m", "5m", "5m", "6m", "7m", "8m", "9m", "E", "E"],
      ["1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p", "P", "F", "C", "1s"],
      ["2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "1m", "2m", "3m", "4m", "5m"],
      ["6m", "7m", "8m", "9m", "1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p"]
    ]),
    msg("tsumo", { actor: 0, pai: "4m", p_msg: { type: "tsumo", actor: 0, pai: "9m" } }),
    msg("dahai", { actor: 0, pai: "1m", p_msg: { type: "pon", actor: 0, pai: "1m" } }),
    msg("pon", { actor: 0, pai: "5m", consumed: ["5m", "5m"], kind: 4 }),
    msg("dahai", { actor: 0, pai: "E" }),
    msg("ankan", { actor: 0, consumed: ["E", "E", "E", "E"], pai: "E" }),
    msg("dahai", { actor: 0, pai: "9m" })
  ];
  const beforePon = api.replayKyoku(entries, 3, 0);
  assert.equal(beforePon.hand.includes("man4"), true);
  assert.equal(beforePon.hand.filter(tile => tile === "man1").length, 1);
  assert.equal(beforePon.melds.length, 0);
  const beforeKan = api.replayKyoku(entries, 5, 0);
  assert.equal(beforeKan.melds.length, 1);
  assert.equal(beforeKan.melds[0].type, "pon");
  const afterKan = api.replayKyoku(entries, 6, 0);
  assert.equal(afterKan.melds.length, 2);
  assert.equal(afterKan.melds[1].type, "ankan");
  assert.equal(afterKan.melds[1].consumed.length, 4);
});

test("extracts bad discards and calls at exactly 5 percent, filters actors and reached moves", async () => {
  const api = await loadApi();
  const zeroRows = () => [Array(34).fill(0)];
  const exactRows = zeroRows();
  exactRows[0][4] = 500;
  const aboveRows = zeroRows();
  aboveRows[0][4] = 501;
  const report = {
    reportId: "bad-report",
    naga_types: { "0": "ニシキ" },
    pred: [[
      startKyoku(),
      discardPrediction(1, "5m", ["5m"], exactRows),
      discardPrediction(2, "5m", ["5m"], exactRows),
      discardPrediction(0, "5m", ["5m"], exactRows, { reached: true }),
      discardPrediction(0, "5m", ["5m"], aboveRows),
      {
        info: { msg: { type: "dahai", actor: 1, pai: "5p" } },
        huro: { "0": [{ "0": 9500, "4": 500 }] }
      },
      msg("pon", { actor: 0, kind: 4, target: 1, pai: "5p", consumed: ["5p", "5p"] }),
      msg("tsumo", { actor: 2, pai: "1p" })
    ]]
  };
  const bad = api.extractBadMoves(report, 0, { thresholdPercent: 5 });
  assert.deepEqual(Array.from(bad.map(item => item.id)), ["bad-report|0|0|5|call"]);
  const seatOneBad = api.extractBadMoves(report, 1, { thresholdPercent: 5 });
  assert.deepEqual(Array.from(seatOneBad.map(item => item.id)), ["bad-report|1|0|1|discard"]);
  const seatTwoBad = api.extractBadMoves(report, 2, { thresholdPercent: 5 });
  assert.deepEqual(Array.from(seatTwoBad.map(item => item.id)), ["bad-report|2|0|2|discard"]);
});

test("supports custom extraction decision, model, threshold, and max-count filters", async () => {
  const api = await loadApi();
  const firstRows = [Array(34).fill(0), Array(34).fill(0)];
  firstRows[0][4] = 400;
  firstRows[1][4] = 600;
  const secondRows = [Array(34).fill(0), Array(34).fill(0)];
  secondRows[0][4] = 300;
  secondRows[1][4] = 400;
  const report = {
    reportId: "custom-report",
    naga_types: { "0": "M0", "1": "M1" },
    pred: [[
      startKyoku(),
      discardPrediction(0, "5m", ["4m", "4m"], firstRows),
      discardPrediction(0, "5m", ["4m", "4m"], secondRows, { reach: [7000, 0] })
    ]]
  };

  const anyModel = api.extractBadMoves(report, 0, { modelMode: "any" });
  assert.deepEqual(Array.from(anyModel.map(item => item.id)), [
    "custom-report|0|0|1|discard",
    "custom-report|0|0|2|discard"
  ]);
  assert.deepEqual(Array.from(anyModel[0].badMoveModels), ["M0"]);
  assert.deepEqual(Array.from(api.extractBadMoves(report, 0, { modelMode: "all" }).map(item => item.id)), [
    "custom-report|0|0|2|discard"
  ]);
  assert.deepEqual(Array.from(api.extractBadMoves(report, 0, { decisionType: "reach" }).map(item => item.id)), [
    "custom-report|0|0|2|discard"
  ]);
  assert.deepEqual(Array.from(api.extractBadMoves(report, 0, { decisionType: "discard" }).map(item => item.id)), [
    "custom-report|0|0|1|discard"
  ]);
  assert.equal(api.extractBadMoves(report, 0, { maxCandidates: 1 }).length, 1);
  assert.equal(api.extractBadMoves(report, 0, { thresholdPercent: 4 }).length, 2);
  assert.throws(() => api.normalizeExtractionOptions({ thresholdPercent: 0 }), /between 0.1 and 50/);
  assert.throws(() => api.normalizeExtractionOptions({ thresholdPercent: 51 }), /between 0.1 and 50/);
  assert.throws(() => api.normalizeExtractionOptions({ maxCandidates: 0 }), /between 1 and 500/);
});

test("canonicalizes post-discard fallback URLs to the prediction-bearing pre-discard tv", async () => {
  const api = await loadApi();
  const rows = [Array(34).fill(0)];
  rows[0][0] = 500;
  const report = {
    reportId: "dedupe",
    naga_types: { "0": "ニシキ" },
    pred: [[
      startKyoku(),
      discardPrediction(0, "1m", ["1m"], rows),
      msg("dahai", { actor: 0, pai: "1m" })
    ]]
  };
  const bad = api.extractBadMoves(report, 0);
  assert.deepEqual(Array.from(bad.map(item => item.id)), [
    "dedupe|0|0|1|discard"
  ]);
  const one = api.sceneCandidate(report, { reportId: "dedupe", tw: 0, ts: 0, tv: 1 });
  const two = api.sceneCandidate(report, { reportId: "dedupe", tw: 0, ts: 0, tv: 2 });
  assert.equal(one.id, two.id);
  assert.equal(two.tv, 1);
  assert.equal(two.sourceTv, 1);
  assert.equal(new URL(two.nagaUrl).searchParams.get("tv"), "1");
});
