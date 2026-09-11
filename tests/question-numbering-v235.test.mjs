import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultQuestionTitleV235,
  isGeneratedQuestionTitle,
  isInvalidQuestionTitle,
  isValidQuestionNumber,
  nextQuestionNumber,
  nextQuestionNumberV235,
  normalizeQuestionNumbering,
  normalizeQuestionNumberingV235,
  toSafeQuestionNumber,
} from "../cloudflare/question-numbering-v235.mjs";

test("いのっち型の read-api 行は 1+ に補正し、ID・履歴・payload を保持する", () => {
  const history = [{ grade: "◎", answeredAt: "opaque" }];
  const payload = { number: null, source: "opaque" };
  const rows = [
    { id: "q-1", question_number: null, title: "問題-Infinity", history, payload },
    { id: "q-2", question_number: null, title: "問題-Infinity", history: [], payload: { number: null } },
    { id: "q-3", question_number: null, title: "問題-Infinity", history: [{ grade: "×" }], payload: { number: null } },
  ];
  const before = structuredClone(rows);

  const normalized = normalizeQuestionNumbering(rows, { numberKey: "question_number" });

  assert.deepEqual(normalized.map((row) => row.question_number), [1, 2, 3]);
  assert.deepEqual(normalized.map((row) => row.title), ["問題1", "問題2", "問題3"]);
  assert.deepEqual(normalized.map((row) => row.id), ["q-1", "q-2", "q-3"]);
  assert.strictEqual(normalized[0].history, history);
  assert.strictEqual(normalized[0].payload, payload);
  assert.deepEqual(rows, before);
});

test("Infinity・NaN・欠損・0・小数・unsafe integer は決定的に 1+ へ補正する", () => {
  const rows = [
    { id: "infinity", number: Infinity, title: "問題-Infinity" },
    { id: "negative-infinity", number: -Infinity, title: "問題--Infinity" },
    { id: "nan", number: NaN, title: "問題-NaN" },
    { id: "zero", number: 0, title: "問題0" },
    { id: "negative", number: -2, title: "問題-2" },
    { id: "decimal", number: 1.5, title: "問題1.5" },
    { id: "unsafe", number: Number.MAX_SAFE_INTEGER + 1, title: "問題9007199254740992" },
    { id: "missing", title: "" },
  ];

  const normalized = normalizeQuestionNumbering(rows);

  assert.deepEqual(normalized.map((row) => row.number), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(normalized.map((row) => row.title), [
    "問題1", "問題2", "問題3", "問題4", "問題5", "問題6", "問題7", "問題8",
  ]);
});

test("有効な Pierre global 番号を予約し、重複は修復しつつ有効な customtitle は上書きしない", () => {
  const rows = [
    { id: "generated-1351", number: 1351, title: "問題1351" },
    { id: "custom-1351", number: 1351, title: "Pierre特別局" },
    { id: "global-1764", number: "1764", title: "Pierre global 1764" },
    { id: "invalid-title", number: null, title: "問題-Infinity" },
    { id: "custom-invalid-number", number: "NaN", title: "河底の選択" },
    { id: "custom-infinity-word", number: Infinity, title: "Infinityの牌姿" },
  ];

  const normalized = normalizeQuestionNumbering(rows);

  assert.deepEqual(normalized.map((row) => row.number), [1, 1351, 1764, 2, 3, 4]);
  assert.deepEqual(normalized.map((row) => row.title), [
    "問題1",
    "Pierre特別局",
    "Pierre global 1764",
    "問題2",
    "河底の選択",
    "Infinityの牌姿",
  ]);
  assert.deepEqual(normalized.map((row) => row.id), rows.map((row) => row.id));
});

test("タイトル判定は非有限の自動ラベルだけを修復対象にする", () => {
  assert.equal(isInvalidQuestionTitle("問題-Infinity"), true);
  assert.equal(isInvalidQuestionTitle("追加問題-NaN"), true);
  assert.equal(isInvalidQuestionTitle(""), true);
  assert.equal(isGeneratedQuestionTitle("問題1"), true);
  assert.equal(isGeneratedQuestionTitle("追加問題1"), true);
  assert.equal(isGeneratedQuestionTitle("Infinityの牌姿"), false);
  assert.equal(isInvalidQuestionTitle("Infinityの牌姿"), false);
  assert.equal(isGeneratedQuestionTitle("自分だけの問題"), false);
});

test("number/title key と titleFactory を指定でき、入力配列を並べ替えない", () => {
  const rows = [
    { id: "a", rank: null, label: "" },
    { id: "b", rank: 9, label: "固有タイトル" },
  ];

  const normalized = normalizeQuestionNumberingV235(rows, {
    numberKey: "rank",
    titleKey: "label",
    titleFactory: (number) => `設問${number}`,
  });

  assert.deepEqual(normalized, [
    { id: "a", rank: 1, label: "設問1" },
    { id: "b", rank: 9, label: "固有タイトル" },
  ]);
  assert.deepEqual(rows, [
    { id: "a", rank: null, label: "" },
    { id: "b", rank: 9, label: "固有タイトル" },
  ]);
});

test("valid number helper accepts one-based safe integers only", () => {
  assert.equal(toSafeQuestionNumber(1351), 1351);
  assert.equal(toSafeQuestionNumber("001351"), 1351);
  assert.equal(toSafeQuestionNumber("1.0"), null);
  assert.equal(toSafeQuestionNumber("Infinity"), null);
  assert.equal(toSafeQuestionNumber(true), null);
  assert.equal(toSafeQuestionNumber(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  assert.equal(isValidQuestionNumber(1), true);
  assert.equal(isValidQuestionNumber(0), false);
  assert.equal(defaultQuestionTitleV235(3), "問題3");
});

test("次の INSERT 番号は sort_order の重複を再利用せず、有限値を返す", () => {
  const brokenCollection = [
    { id: "q-1", question_number: null, title: "問題-Infinity", sort_order: 0 },
    { id: "q-2", question_number: null, title: "問題-Infinity", sort_order: 0 },
    { id: "q-3", question_number: null, title: "問題-Infinity", sort_order: 0 },
  ];
  assert.equal(nextQuestionNumberV235(brokenCollection, { numberKey: "question_number" }), 4);
  assert.equal(nextQuestionNumber(brokenCollection, { numberKey: "question_number" }), 4);
  assert.equal(nextQuestionNumberV235([
    { number: 1, title: "問題1" },
    { number: 1764, title: "Pierre global 1764" },
  ]), 1765);
  assert.equal(nextQuestionNumberV235([]), 1);
});
