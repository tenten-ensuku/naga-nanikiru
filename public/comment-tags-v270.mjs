// V271: presets plus user-created tags. Browser and Worker share normalization.
// Original comment text is never rewritten while extracting tags.
export const TAGS = Object.freeze(["基本序列", "セオリー集", "一向聴基礎講義", "押し引き", "安全度比較"]);
export const MAX_TAG_LENGTH = 30;
const validName = /^[\p{L}\p{N}_][\p{L}\p{M}\p{N}_]*$/u;

export function normalizeTag(value) {
  if (typeof value !== "string") return "";
  const tag = value.normalize("NFKC").trim().replace(/^#/, "");
  return tag && [...tag].length <= MAX_TAG_LENGTH && validName.test(tag) ? tag : "";
}

function orderedTags(values) {
  const found = new Set(values.map(normalizeTag).filter(Boolean));
  return [...TAGS.filter(tag => found.has(tag)), ...[...found].filter(tag => !TAGS.includes(tag)).sort((a,b) => a.localeCompare(b,"ja"))];
}

export function tagSuggestions(values = []) {
  return orderedTags([...TAGS, ...values]);
}

export function extractTags(text) {
  const source = String(text || "").normalize("NFKC").replace(/https?:\/\/[^\s<>]+/giu, " ");
  const matches = source.matchAll(/(?<![\p{L}\p{M}\p{N}_/#])#([\p{L}\p{M}\p{N}_]+)/gu);
  return orderedTags([...matches].map(match => match[1]));
}

export function tagsFromComments(comments) {
  return orderedTags((Array.isArray(comments) ? comments : [])
    .filter(comment => comment && comment.showInComments !== false && !comment.deleted_at)
    .flatMap(comment => extractTags(typeof comment === "string" ? comment : comment.content ?? comment.body)));
}

export function appendTag(text, tag, maxLength = 2000) {
  const source = String(text || "");
  tag = normalizeTag(tag);
  if (!tag || extractTags(source).includes(tag)) return source;
  const next = source + (source && !/\s$/u.test(source) ? "\n" : "") + "#" + tag;
  return next.length <= maxLength ? next : null;
}
