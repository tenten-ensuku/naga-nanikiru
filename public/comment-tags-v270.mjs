// Shared by the browser and Worker. Tags stay in the original comment text.
export const TAGS = Object.freeze(["基本序列", "セオリー集", "一向聴基礎講義", "押し引き", "安全度比較"]);
const pattern = () => new RegExp(`(?:^|[^\\p{L}\\p{N}_/#＃])[#＃](${TAGS.join("|")})(?![\\p{L}\\p{N}_ー])`, "gu");

export function extractTags(text) {
  const source = String(text || "").replace(/https?:\/\/[^\s<>]+/gu, " ");
  const found = new Set([...source.matchAll(pattern())].map(match => match[1]));
  return TAGS.filter(tag => found.has(tag));
}

export function tagsFromComments(comments) {
  const found = new Set((Array.isArray(comments) ? comments : [])
    .filter(comment => comment && comment.showInComments !== false && !comment.deleted_at)
    .flatMap(comment => extractTags(typeof comment === "string" ? comment : comment.content ?? comment.body)));
  return TAGS.filter(tag => found.has(tag));
}

export function appendTag(text, tag, maxLength = 2000) {
  const source = String(text || "");
  if (!TAGS.includes(tag) || extractTags(source).includes(tag)) return source;
  const next = source + (source && !/\s$/u.test(source) ? "\n" : "") + "#" + tag;
  return next.length <= maxLength ? next : null;
}
