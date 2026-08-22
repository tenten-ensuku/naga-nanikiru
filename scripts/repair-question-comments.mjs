import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const defaultQuestionsPath = path.join(projectRoot, "public", "question-data", "selected-questions.json");
const defaultSnapshotPath = path.resolve(projectRoot, "../../outputs/naga-thread-bot/data/naga-thread-snapshots.json");

/**
 * Remove only URLs at the very beginning of a Discord message.
 *
 * The old importer removed a fixed number of leading characters after finding
 * a URL. That also removed the first characters of the actual explanation
 * when the URL and prose were on the same line. URLs later in a comment are
 * intentionally left untouched.
 */
export function stripLeadingUrls(text) {
  const result = String(text ?? "").replace(/^\uFEFF/, "");
  const match = /^(https?:\/\/[^\s]+)/i.exec(result);
  if (!match) return result;
  return result.slice(match[0].length).replace(/^\s+/, "");
}

function buildSourceMessageMap(snapshot) {
  const map = new Map();
  for (const thread of snapshot?.threads || []) {
    for (const message of thread?.messages || []) {
      if (message?.id != null) map.set(String(message.id), message);
    }
  }
  return map;
}

function recoverContent(selectedContent, sourceContent) {
  const expected = stripLeadingUrls(sourceContent);
  const selected = String(selectedContent ?? "");
  if (selected === expected) return { content: selected, changed: false, reason: "already-normalized" };
  if (stripLeadingUrls(selected) === expected) return { content: expected, changed: true, reason: "leading-url" };
  if (selected && expected.endsWith(selected)) return { content: expected, changed: true, reason: "restored-prefix" };
  return { content: selected, changed: false, reason: "unmatched" };
}

export function repairQuestionComments(questions, snapshot) {
  const sourceMessages = buildSourceMessageMap(snapshot);
  const stats = { comments: 0, changed: 0, leadingUrl: 0, restoredPrefix: 0, unmatched: [] };
  const repaired = questions.map((question) => {
    const comments = Array.isArray(question?.comments) ? question.comments : [];
    const nextComments = comments.map((comment) => {
      const source = sourceMessages.get(String(comment?.id || ""));
      if (!source) return comment;
      stats.comments += 1;
      const result = recoverContent(comment.content, source.content);
      if (!result.changed) {
        if (result.reason === "unmatched") stats.unmatched.push({ question: question?.number, messageId: comment?.id });
        return comment;
      }
      stats.changed += 1;
      if (result.reason === "leading-url") stats.leadingUrl += 1;
      if (result.reason === "restored-prefix") stats.restoredPrefix += 1;
      return { ...comment, content: result.content };
    });
    return comments.length ? { ...question, comments: nextComments } : question;
  });
  return { questions: repaired, stats };
}

async function main() {
  const questionsPath = path.resolve(process.argv[2] || defaultQuestionsPath);
  const snapshotPath = path.resolve(process.argv[3] || defaultSnapshotPath);
  const [questions, snapshot] = await Promise.all([
    readFile(questionsPath, "utf8").then(JSON.parse),
    readFile(snapshotPath, "utf8").then(JSON.parse),
  ]);
  const { questions: repaired, stats } = repairQuestionComments(questions, snapshot);
  await writeFile(questionsPath, `${JSON.stringify(repaired, null, 2)}\n`, "utf8");
  console.log(`comment repair: checked ${stats.comments}, changed ${stats.changed} (URL ${stats.leadingUrl}, prefix ${stats.restoredPrefix})`);
  if (stats.unmatched.length) console.warn(`comment repair: ${stats.unmatched.length} unmatched source comments were left unchanged`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
