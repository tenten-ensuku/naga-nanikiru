import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = path.join(projectRoot, "public", "question-data", "selected-questions.json");
const generatorPath = path.join(projectRoot, "public", "naga-generator-v44.js");

function loadGenerator(source) {
  const context = { console, URL, URLSearchParams };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: generatorPath });
  if (!context.NagaGeneratorV44) throw new Error("NagaGeneratorV44を読み込めませんでした");
  return context.NagaGeneratorV44;
}

function reportSpec(generator, rawUrl) {
  const spec = generator.parseNagaUrl(rawUrl);
  return { ...spec, jsonUrl: spec.jsonUrl || `https://naga.dmv.nico/reports/${spec.reportId}.json` };
}

const DERIVED_FIELDS = [
  "playerName", "playerSeat", "tw", "ts", "tv", "decisionType", "handBeforeDraw", "draw",
  "actualDiscard", "actualDiscardNaga", "actualDiscardProbability", "doraMarker", "models",
  "probabilities", "reach", "hasRiichiJudgment", "callTile", "actualCall", "actualCallCode",
  "actualCallType", "actualDecision", "callOptions", "callProbabilities", "callRecommended",
  "actualCallProbability", "actualCallProbabilityRaw", "melds", "reached", "sourceTv", "predictionType",
];

function applyCandidate(question, candidate, spec) {
  const next = { ...question };
  for (const field of DERIVED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(candidate, field)) next[field] = candidate[field];
  }
  if (Array.isArray(next.models)) {
    const sourceReach = Array.isArray(next.reach) ? next.reach : [];
    next.reach = next.models.map((_, index) => Number(sourceReach[index] ?? 0));
  }
  next.sourceReportId = spec.reportId;
  next.sourceTw = spec.tw;
  next.sourceTs = spec.ts;
  next.sourceTv = spec.tv;
  if (candidate.decisionType !== "call") {
    next.actualCall = null;
    next.actualCallCode = null;
    next.actualCallType = null;
    next.actualDecision = null;
    next.callTile = null;
    next.callOptions = [];
    next.callProbabilities = null;
    next.callRecommended = null;
    next.actualCallProbability = null;
    next.actualCallProbabilityRaw = null;
  }
  return next;
}

async function fetchReports(urls) {
  const cache = new Map();
  const failures = [];
  for (const [reportId, spec] of urls) {
    try {
      const response = await fetch(spec.jsonUrl, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      cache.set(reportId, await response.json());
    } catch (error) {
      failures.push({ reportId, url: spec.jsonUrl, message: error?.message || String(error) });
    }
  }
  return { cache, failures };
}

async function main() {
  const [questions, generatorSource] = await Promise.all([
    readFile(dataPath, "utf8").then(JSON.parse),
    readFile(generatorPath, "utf8"),
  ]);
  const generator = loadGenerator(generatorSource);
  const specs = new Map();
  for (const question of questions) {
    if (!question?.nagaUrl) continue;
    try {
      const spec = reportSpec(generator, question.nagaUrl);
      specs.set(spec.reportId, spec);
    } catch (error) {
      console.warn(`NAGA URLを解釈できません: 問題${question.number} ${error?.message || error}`);
    }
  }
  const { cache, failures } = await fetchReports(specs);
  const unchanged = [];
  const failedCandidates = [];
  let refreshed = 0;
  const nextQuestions = questions.map((question) => {
    if (!question?.nagaUrl) return question;
    let spec;
    try {
      spec = reportSpec(generator, question.nagaUrl);
    } catch {
      return question;
    }
    const report = cache.get(spec.reportId);
    if (!report) return question;
    const candidate = generator.sceneCandidate(report, {
      reportId: spec.reportId,
      tw: spec.tw,
      ts: spec.ts,
      tv: spec.tv,
      canonicalSceneUrl: question.nagaUrl,
    });
    if (!candidate) {
      failedCandidates.push({ number: question.number, reportId: spec.reportId, ts: spec.ts, tv: spec.tv });
      return question;
    }
    refreshed += 1;
    return applyCandidate(question, candidate, spec);
  });
  await writeFile(dataPath, `${JSON.stringify(nextQuestions, null, 2)}\n`, "utf8");
  console.log(`NAGA data refresh: ${refreshed}/${questions.length} questions refreshed from ${cache.size} reports`);
  if (failures.length) console.warn(`NAGA report fetch failures: ${failures.length}\n${JSON.stringify(failures, null, 2)}`);
  if (failedCandidates.length) console.warn(`NAGA candidate failures: ${failedCandidates.length}\n${JSON.stringify(failedCandidates, null, 2)}`);
  if (unchanged.length) console.warn(`unchanged: ${unchanged.length}`);
}

await main();
