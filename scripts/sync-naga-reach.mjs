import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const dataPath = resolve(import.meta.dirname, "..", "public", "question-data", "selected-questions.json");
const writeChanges = process.argv.includes("--write");
const questions = JSON.parse(await readFile(dataPath, "utf8"));
const reportCache = new Map();

function reportSpec(nagaUrl) {
  const url = new URL(nagaUrl);
  const fileName = url.pathname.split("/").at(-1)?.replace(/\.html$/, "");
  const reportId = url.searchParams.get("report_id") || fileName;
  return {
    reportId,
    ts: Number(url.searchParams.get("ts") || 0),
    tv: Number(url.searchParams.get("tv") || 0)
  };
}

async function fetchReport(reportId) {
  if (!reportCache.has(reportId)) {
    reportCache.set(reportId, fetch(`https://naga.dmv.nico/reports/${reportId}.json`).then(response => {
      if (!response.ok) throw new Error(`${reportId}: NAGA JSON ${response.status}`);
      return response.json();
    }));
  }
  return reportCache.get(reportId);
}

function normalizedReach(entry, modelCount) {
  const raw = entry?.reach;
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return Array.from({ length: modelCount }, (_, index) => Number(values[index] || 0));
}

const changed = [];
const failed = [];
const candidates = questions.filter(question => question.decisionType === "discard" && question.nagaUrl);
const batchSize = 8;

for (let offset = 0; offset < candidates.length; offset += batchSize) {
  const batch = candidates.slice(offset, offset + batchSize);
  await Promise.all(batch.map(async question => {
    try {
      const { reportId, ts, tv } = reportSpec(question.nagaUrl);
      const report = await fetchReport(reportId);
      const entries = report.pred?.[ts];
      const action = entries?.[tv];
      if (!action) throw new Error(`pred[${ts}][${tv}] がありません`);
      const message = action.info?.msg;
      const previous = entries?.[tv - 1];
      const usePrevious = !Array.isArray(message?.pred_dahai) && message?.type === "dahai" && Array.isArray(previous?.dahai_pred);
      const predictionEntry = usePrevious ? previous : action;
      const modelCount = Array.isArray(question.models) ? question.models.length : 0;
      const reach = normalizedReach(predictionEntry, modelCount);
      const hasRiichiJudgment = reach.some(value => value > 0);
      const previousReach = Array.isArray(question.reach) ? question.reach.map(Number) : [];
      if (JSON.stringify(previousReach) !== JSON.stringify(reach) || Boolean(question.hasRiichiJudgment) !== hasRiichiJudgment) {
        changed.push({ number: question.number, previousReach, reach, previousFlag: Boolean(question.hasRiichiJudgment), hasRiichiJudgment });
        if (writeChanges) {
          question.reach = reach;
          question.hasRiichiJudgment = hasRiichiJudgment;
        }
      }
    } catch (error) {
      failed.push({ number: question.number, message: error.message });
    }
  }));
  console.log(`reach audit ${Math.min(offset + batch.length, candidates.length)}/${candidates.length}`);
}

changed.sort((left, right) => left.number - right.number);
failed.sort((left, right) => left.number - right.number);
if (writeChanges && !failed.length) await writeFile(dataPath, `${JSON.stringify(questions, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  mode: writeChanges ? "write" : "audit",
  questions: questions.length,
  discardQuestions: candidates.length,
  uniqueReports: reportCache.size,
  changedCount: changed.length,
  riichiQuestions: changed.filter(item => item.hasRiichiJudgment).map(item => item.number),
  changed,
  failed
}, null, 2));

if (failed.length) process.exitCode = 1;
