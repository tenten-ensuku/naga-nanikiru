/**
 * Pure, display-side question-number normalizer for the V235 sidecar.
 *
 * Caller contract:
 * - Pass one already ordered collection at a time. The input order is the
 *   deterministic tie-breaker for duplicate numbers and repairs.
 * - Use `numberKey: "question_number"` for the Cloudflare index shape, or the
 *   default `numberKey: "number"` for client question objects.
 * - The returned objects only change the configured number/title fields.
 *   IDs, history fields, and an opaque source `payload` are carried through
 *   unchanged; this helper never parses or rewrites payload content.
 */

const MAX_SAFE_QUESTION_NUMBER = Number.MAX_SAFE_INTEGER;
const POSITIVE_INTEGER_TEXT = /^\d+$/u;
const TITLE_SEPARATOR = "[-‐‑‒–—:：\\s]*";
const NONFINITE_TITLE_TOKEN = "[+-]?(?:Infinity|NaN|undefined|null)";
const INVALID_TITLE_PATTERN = new RegExp(
  `^(?:${NONFINITE_TITLE_TOKEN}|(?:問題|追加問題)${TITLE_SEPARATOR}${NONFINITE_TITLE_TOKEN})$`,
  "iu",
);
const GENERATED_NUMBER_TITLE_PATTERN = new RegExp(
  `^(?:問題|追加問題)${TITLE_SEPARATOR}(\\d+(?:\\.\\d+)?)$`,
  "u",
);
const LEGACY_GENERATED_TITLE_PATTERN = /^追加問題$/u;

/** Convert a number-like value to a positive safe integer, or null. */
export function toSafeQuestionNumber(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 1 ? value : null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!POSITIVE_INTEGER_TEXT.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number >= 1 ? number : null;
}

/** Return whether a value is a valid one-based question number. */
export function isValidQuestionNumber(value) {
  return toSafeQuestionNumber(value) !== null;
}

/**
 * Return whether a title is an empty/non-finite generated label.
 * Non-matching non-empty titles are treated as caller-authored custom titles.
 */
export function isInvalidQuestionTitle(value) {
  const title = String(value ?? "").trim();
  return !title || INVALID_TITLE_PATTERN.test(title);
}

/**
 * Return whether a title is safe to regenerate when its number changes.
 * This includes the legacy `追加問題N` label, but deliberately excludes
 * arbitrary custom titles such as `Infinityの牌姿`.
 */
export function isGeneratedQuestionTitle(value) {
  const title = String(value ?? "").trim();
  return isInvalidQuestionTitle(title)
    || LEGACY_GENERATED_TITLE_PATTERN.test(title)
    || GENERATED_NUMBER_TITLE_PATTERN.test(title);
}

/** Build the canonical fallback title used for repaired rows. */
export function defaultQuestionTitleV235(number) {
  return `問題${number}`;
}

function assertKey(name, value) {
  if ((typeof value !== "string" && typeof value !== "symbol") || value === "") {
    throw new TypeError(`${name} must be a non-empty property key`);
  }
}

function assertStartNumber(value) {
  const number = toSafeQuestionNumber(value);
  if (number === null) throw new RangeError("startAt must be a positive safe integer");
  return number;
}

function isObjectRow(row) {
  return row !== null && typeof row === "object" && !Array.isArray(row);
}

function nextAvailableNumber(used, cursor) {
  let candidate = cursor;
  while (used.has(candidate)) {
    if (candidate >= MAX_SAFE_QUESTION_NUMBER) {
      throw new RangeError("no positive safe question number is available");
    }
    candidate += 1;
  }
  used.add(candidate);
  return {
    number: candidate,
    cursor: candidate >= MAX_SAFE_QUESTION_NUMBER ? MAX_SAFE_QUESTION_NUMBER : candidate + 1,
  };
}

/**
 * Normalize one ordered collection without mutating its input.
 *
 * Valid numbers are preserved whenever possible. For a duplicate number, a
 * caller-authored title gets priority over a generated/invalid title; if all
 * duplicates are generated, the first row keeps the existing number. Every
 * other row receives the smallest unused positive safe integer from `startAt`.
 */
export function normalizeQuestionNumbering(rows, options = {}) {
  if (!Array.isArray(rows)) return [];

  const numberKey = options.numberKey ?? "number";
  const titleKey = options.titleKey ?? "title";
  assertKey("numberKey", numberKey);
  assertKey("titleKey", titleKey);

  const startAt = assertStartNumber(options.startAt ?? 1);
  const titleFactory = options.titleFactory ?? defaultQuestionTitleV235;
  if (typeof titleFactory !== "function") throw new TypeError("titleFactory must be a function");

  const entries = rows.map((row, index) => {
    if (!isObjectRow(row)) return null;
    const candidate = toSafeQuestionNumber(row[numberKey]);
    const title = row[titleKey];
    return {
      index,
      row,
      candidate,
      customTitle: !isGeneratedQuestionTitle(title),
    };
  });

  // Reserve one keeper for each valid number before allocating repairs. This
  // prevents an earlier malformed row from stealing a valid number that
  // occurs later in the collection.
  const keeperByNumber = new Map();
  for (const entry of entries) {
    if (!entry || entry.candidate === null) continue;
    const current = keeperByNumber.get(entry.candidate);
    if (!current || (!current.customTitle && entry.customTitle)) {
      keeperByNumber.set(entry.candidate, entry);
    }
  }

  const used = new Set(keeperByNumber.keys());
  let cursor = startAt;

  return entries.map((entry, index) => {
    if (!entry) return rows[index];

    const keepsCandidate = entry.candidate !== null && keeperByNumber.get(entry.candidate) === entry;
    let number = entry.candidate;
    if (!keepsCandidate) {
      const allocation = nextAvailableNumber(used, cursor);
      number = allocation.number;
      cursor = allocation.cursor;
    }

    const title = entry.row[titleKey];
    const titleNeedsRepair = isGeneratedQuestionTitle(title);
    const nextTitle = titleNeedsRepair
      ? String(titleFactory(number, entry.row, index))
      : title;
    const numberChanged = entry.row[numberKey] !== number;
    const titleChanged = titleNeedsRepair && nextTitle !== title;
    if (!numberChanged && !titleChanged) return entry.row;

    const repaired = { ...entry.row, [numberKey]: number };
    if (titleChanged) repaired[titleKey] = nextTitle;
    return repaired;
  });
}

/**
 * Return a finite next number for a new row in the same ordered collection.
 * Invalid/duplicate existing rows are first assigned deterministic display
 * numbers, so a collection whose stored sort order is all zeroes still gets
 * `count + 1` rather than reusing one.
 */
export function nextQuestionNumberV235(rows, options = {}) {
  const normalized = normalizeQuestionNumbering(rows, options);
  const maximum = normalized.reduce((current, row) => {
    const number = toSafeQuestionNumber(row?.[options.numberKey ?? "number"]);
    return number === null ? current : Math.max(current, number);
  }, 0);
  if (maximum >= MAX_SAFE_QUESTION_NUMBER) {
    throw new RangeError("no finite next question number is available");
  }
  return maximum + 1;
}

// Versioned alias for callers that keep normalizers named after their release.
export const normalizeQuestionNumberingV235 = normalizeQuestionNumbering;
export const nextQuestionNumber = nextQuestionNumberV235;
