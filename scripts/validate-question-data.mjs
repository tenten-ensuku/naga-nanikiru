import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const publicRoot = resolve(root, "public");
const dataPath = resolve(publicRoot, "question-data", "selected-questions.json");
const tilePattern = /^(?:(?:man|pin|sou)[1-9]|ji[1-7]|aka[1-3])$/;
const errors = [];
const warnings = [];

function problemLabel(question, index) {
  return `問題${question?.number ?? `index:${index}`}`;
}

function error(label, message) {
  errors.push(`${label}: ${message}`);
}

function warn(label, message) {
  warnings.push(`${label}: ${message}`);
}

function validTile(value) {
  return typeof value === "string" && tilePattern.test(value);
}

async function fileExists(relativePath) {
  if (typeof relativePath !== "string" || !relativePath.trim()) return false;
  try {
    await access(resolve(publicRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

const questions = JSON.parse(await readFile(dataPath, "utf8"));
if (!Array.isArray(questions)) throw new Error("selected-questions.json must contain an array");

const ids = new Set();
const numbers = new Set();

for (const [index, question] of questions.entries()) {
  const label = problemLabel(question, index);
  if (!question?.id) error(label, "idがありません");
  else if (ids.has(String(question.id))) error(label, `id ${question.id} が重複しています`);
  else ids.add(String(question.id));

  if (!Number.isInteger(question?.number)) error(label, "問題番号が整数ではありません");
  else if (numbers.has(question.number)) error(label, `問題番号 ${question.number} が重複しています`);
  else numbers.add(question.number);

  if (!['discard', 'call'].includes(question?.decisionType)) error(label, `decisionType ${question?.decisionType} は未対応です`);
  if (!Array.isArray(question?.handBeforeDraw)) error(label, "handBeforeDrawが配列ではありません");
  else question.handBeforeDraw.forEach((tile, tileIndex) => {
    if (!validTile(tile)) error(label, `handBeforeDraw[${tileIndex}] の牌コード ${tile} が不正です`);
  });
  if (question?.draw != null && !validTile(question.draw)) error(label, `ツモ牌コード ${question.draw} が不正です`);
  if (question?.actualDiscard != null && !validTile(question.actualDiscard)) error(label, `当時の打牌コード ${question.actualDiscard} が不正です`);
  if (question?.decisionType === "discard" && question?.actualDiscard == null) warn(label, "当時の選択打牌がありません。解説画面では非表示にします");

  if (!Array.isArray(question?.models) || question.models.length === 0) error(label, "モデル情報がありません");
  else question.models.forEach((model, modelIndex) => {
    if (!model?.name) error(label, `models[${modelIndex}] にモデル名がありません`);
    if (question?.decisionType === "discard" && !validTile(model?.recommendation)) error(label, `models[${modelIndex}] の推奨牌 ${model?.recommendation} が不正です`);
  });

  const imagePaths = [question?.image].filter(Boolean);
  for (const imagePath of new Set(imagePaths)) {
    if (!(await fileExists(imagePath))) error(label, `画像 ${imagePath} が存在しません`);
  }
  const modelCount = Array.isArray(question?.models) ? question.models.length : 0;
  for (const [tile, values] of Object.entries(question?.probabilities || {})) {
    if (!validTile(tile)) error(label, `probabilitiesの牌コード ${tile} が不正です`);
    if (!Array.isArray(values) || values.length !== modelCount) error(label, `${tile}の推奨度数がモデル数と一致しません`);
  }
  if (Array.isArray(question?.reach) && question.reach.length !== modelCount) error(label, "reachの要素数がモデル数と一致しません");
  const derivedRiichiJudgment = question?.decisionType === "discard" && Array.isArray(question?.reach) && question.reach.some(value => Number(value) > 0);
  if (Boolean(question?.hasRiichiJudgment) !== derivedRiichiJudgment) error(label, "hasRiichiJudgmentがreachデータと一致しません");

  if (question?.decisionType === "call") {
    if (!validTile(question?.callTile)) error(label, `副露対象牌 ${question?.callTile} が不正です`);
    if (!Array.isArray(question?.callOptions) || question.callOptions.length < 2) error(label, "副露選択肢が不足しています");
    if (!Array.isArray(question?.callRecommended) || question.callRecommended.length !== modelCount) error(label, "callRecommendedの要素数がモデル数と一致しません");
  }

  const concealedCount = (question?.handBeforeDraw?.length || 0) + (question?.draw ? 1 : 0);
  const meldCount = Array.isArray(question?.melds) ? question.melds.length : 0;
  const expectedDiscardCount = 14 - meldCount * 3;
  if (question?.decisionType === "discard" && concealedCount !== expectedDiscardCount) {
    warn(label, `手牌枚数 ${concealedCount} が副露数から求めた ${expectedDiscardCount} 枚と一致しません`);
  }
}

console.log(`question data: ${questions.length} questions, ${errors.length} errors, ${warnings.length} warnings`);
for (const message of errors) console.error(`ERROR ${message}`);
const visibleWarnings = process.argv.includes("--all-warnings") ? warnings : warnings.slice(0, 20);
for (const message of visibleWarnings) console.warn(`WARN  ${message}`);
if (visibleWarnings.length < warnings.length) console.warn(`WARN  ほか ${warnings.length - visibleWarnings.length} 件。全件表示は --all-warnings を指定してください`);
if (errors.length) process.exitCode = 1;
