#!/usr/bin/env node

/**
 * Build the 89-question "基本序列問題集" manifest from one NAGA report.
 *
 * The report's viewer tw=1 places the raw report player at seat 1 (「私」)
 * in the fixed South-seat viewpoint used by the drill.
 * The generator is evaluated in an isolated VM because naga-generator-v44.js
 * is a browser-oriented UMD script.
 */

import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const REPORT_ID = "27ade94f05bb9ee180ccfaadb3ec85e45553cc8c7709913fb4a385b476351cdev2_2";
const VIEWER_TW = 1;
const RAW_PLAYER_SEAT = 1;
const REPORT_URL = `https://naga.dmv.nico/reports/${REPORT_ID}.json`;
const OUT_PATH = path.resolve(process.argv[2] || "outputs/basic-sequence-generated/manifest.json");

async function loadGenerator() {
  const source = await fs.readFile(new URL("../public/naga-generator-v44.js", import.meta.url), "utf8");
  const context = { console, URL, URLSearchParams, structuredClone, globalThis: null };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "naga-generator-v44.js" });
  return context.NagaGeneratorV44;
}

function viewerUrl({ ts, tv }) {
  const params = new URLSearchParams({ report_id: REPORT_ID, tw: String(VIEWER_TW), ts: String(ts), tv: String(tv) });
  return `https://naga.dmv.nico/htmls/report_viewer.html?${params.toString()}`;
}

function cloneCandidate(candidate, number) {
  const nagaUrl = viewerUrl(candidate);
  return {
    ...structuredClone(candidate),
    id: `basic-sequence-${String(number).padStart(3, "0")}`,
    number,
    title: `問題${number}`,
    nagaUrl,
    sourceReportId: REPORT_ID,
    sourceTw: VIEWER_TW,
    tw: VIEWER_TW,
    playerName: "私",
    playerSeat: RAW_PLAYER_SEAT,
    threadUrl: nagaUrl,
    comments: [],
    image: null,
    images: null,
    imageOff: null,
    imageOpen: null,
    needsScreenshot: true,
    imageSource: "naga_url",
    imageSourceRuleVersion: "naga-url-capture-v2",
    collectionKey: "basic-sequence"
  };
}

async function main() {
  const generator = await loadGenerator();
  const response = await fetch(REPORT_URL);
  if (!response.ok) throw new Error(`NAGA report fetch failed: ${response.status}`);
  const report = await response.json();
  const unique = new Map();
  for (let ts = 0; ts < report.pred.length; ts += 1) {
    for (let tv = 0; tv < report.pred[ts].length; tv += 1) {
      const candidate = generator.sceneCandidate(report, { reportId: REPORT_ID, tw: RAW_PLAYER_SEAT, ts, tv });
      if (candidate?.decisionType === "discard") unique.set(candidate.id, candidate);
    }
  }
  const questions = [...unique.values()]
    .sort((a, b) => a.ts - b.ts || a.tv - b.tv)
    .map((candidate, index) => cloneCandidate(candidate, index + 1));
  if (questions.length !== 89) throw new Error(`Expected 89 discard scenes, got ${questions.length}`);
  const mismatches = questions.filter(question => question.actualDiscard !== question.models?.[0]?.recommendation);
  if (mismatches.length) throw new Error(`First-recommendation mismatch: ${mismatches.length}`);
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, `${JSON.stringify({
    schemaVersion: 1,
    collection: {
      key: "basic-sequence",
      title: "基本序列問題集",
      description: "NAGAの第一推奨を選び、基本序列を確認する必須問題集。",
      visibility: "private",
      theme: "luxury-gray"
    },
    source: { reportId: REPORT_ID, viewerTw: VIEWER_TW, rawPlayerSeat: RAW_PLAYER_SEAT, reportUrl: REPORT_URL },
    questions
  }, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ out: OUT_PATH, count: questions.length, mismatches: mismatches.length, first: questions[0].nagaUrl, last: questions.at(-1).nagaUrl }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
