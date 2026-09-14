/* Recorded content dates only. No network, timers, or persistent state. */
(function (host) {
  "use strict";
  const DAY = 86400000;
  const dateFormat = new Intl.DateTimeFormat("ja-JP", {timeZone:"Asia/Tokyo", year:"numeric", month:"2-digit", day:"2-digit"});
  const timeFormat = new Intl.DateTimeFormat("ja-JP", {timeZone:"Asia/Tokyo", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23"});
  function timestamp(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    const source = value.trim();
    // Database timestamps have an explicit offset; date-only legacy records are
    // kept as their recorded calendar date, without inventing a time of day.
    if (!/^\d{4}-\d{2}-\d{2}(?:$|[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$)/i.test(source)) return null;
    const calendar = Date.parse(source.slice(0, 10) + "T00:00:00Z");
    if (!Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== source.slice(0, 10)) return null;
    const dateOnly = source.length === 10;
    const milliseconds = Date.parse(dateOnly ? source + "T00:00:00+09:00" : source);
    if (!Number.isFinite(milliseconds)) return null;
    if (dateOnly && dateFormat.format(milliseconds).replaceAll("/", "-") !== source) return null;
    return {iso:new Date(milliseconds).toISOString(), milliseconds, dateOnly, date:dateFormat.format(milliseconds), full:dateOnly ? dateFormat.format(milliseconds) : timeFormat.format(milliseconds) + " JST"};
  }
  const first = (...values) => values.map(timestamp).find(Boolean) || null;
  function questionCreated(question) {
    return first(question?.generatedAt, question?.generated_at, question?.createdAt, question?.created_at);
  }
  function bookUpdated(row, summary) {
    // Never use last_activity_at: it includes the learner's answer timestamps.
    return first(summary?.content_updated_at, row?.content_updated_at);
  }
  function isRecent(date, now = Date.now()) {
    const age = Number(now) - (date?.milliseconds ?? NaN);
    return Number.isFinite(age) && age >= 0 && age < 7 * DAY;
  }
  host.MinkiruContentDatesV246 = Object.freeze({timestamp, first, questionCreated, bookUpdated, isRecent});
})(typeof window === "undefined" ? globalThis : window);
