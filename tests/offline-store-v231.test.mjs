import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryAdapter,
  createOfflineStore,
} from "../client/offline-store.mjs";

function image(size, label = "image") {
  return {
    src: label,
    blob: new Blob([new Uint8Array(size)]),
  };
}

function question(questionId, shareSlug = "collection-a", payload = { answer: "1" }, images = []) {
  return {
    questionId,
    shareSlug,
    collectionTitle: "Collection",
    payload,
    images,
  };
}

const attempt = (clientAttemptId, questionId = "q1", shareSlug = "collection-a", answer = "1") => ({
  clientAttemptId,
  questionId,
  shareSlug,
  answer,
  grade: "correct",
  answeredAt: "2026-09-07T00:00:00.000Z",
  elapsedMs: 1200,
});

test("V231 memory adapter evicts the deterministic oldest whole question at the full question boundary", async () => {
  const store = createOfflineStore({
    adapter: createMemoryAdapter(),
    maxQuestions: 2,
    maxBytes: 1024 * 1024,
  });

  await store.saveQuestion("user-a", question("q1"));
  await store.saveQuestion("user-a", question("q2"));
  await store.saveQuestion("user-a", question("q3"));

  assert.deepEqual(
    (await store.listQuestions("user-a")).map((item) => item.questionId),
    ["q3", "q2"],
  );
  assert.equal(await store.getQuestion("user-a", "q1"), null);
});

test("V231 byte boundary counts UTF-8 payload bytes plus image blob bytes and preserves an exact fit", async () => {
  const payload = { text: "あ" };
  const oneImage = image(3, "img-1");
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  const maxBytes = payloadBytes + 3;
  const store = createOfflineStore({
    adapter: createMemoryAdapter(),
    maxQuestions: 1,
    maxBytes,
  });

  await store.saveQuestion("user-a", question("q1", "collection-a", payload, [oneImage]));
  assert.equal((await store.listQuestions("user-a")).length, 1);

  const tooLarge = question("q2", "collection-a", payload, [image(4, "img-2")]);
  await assert.rejects(
    () => store.saveQuestion("user-a", tooLarge),
    (error) => error.code === "QUESTION_TOO_LARGE",
  );
  assert.deepEqual(
    (await store.listQuestions("user-a")).map((item) => item.questionId),
    ["q1"],
  );
});

test("V231 rejects a single oversized replacement without changing the previous question", async () => {
  const adapter = createMemoryAdapter();
  const store = createOfflineStore({ adapter, maxQuestions: 2, maxBytes: 20 });
  await store.saveQuestion("user-a", question("q1", "collection-a", { value: "old" }));

  await assert.rejects(
    () => store.saveQuestion("user-a", question("q1", "collection-a", { value: "this payload is too large" })),
    (error) => error.code === "QUESTION_TOO_LARGE",
  );
  assert.deepEqual((await store.getQuestion("user-a", "q1")).payload, { value: "old" });
});

test("V231 LRU access refresh is deterministic and attempts are excluded from question eviction", async () => {
  const store = createOfflineStore({
    adapter: createMemoryAdapter(),
    maxQuestions: 2,
    maxBytes: 1024,
  });
  await store.saveQuestion("user-a", question("q1"));
  await store.saveQuestion("user-a", question("q2"));
  await store.getQuestion("user-a", "q1");
  await store.addAttempt("user-a", attempt("attempt-1", "q1"));
  await store.saveQuestion("user-a", question("q3"));

  assert.deepEqual(
    (await store.listQuestions("user-a")).map((item) => item.questionId),
    ["q3", "q1"],
  );
  assert.deepEqual((await store.listPendingAttempts("user-a")).map((item) => item.clientAttemptId), ["attempt-1"]);
});

test("V231 duplicate outbox IDs are idempotent and never overwrite the first payload", async () => {
  const store = createOfflineStore({ adapter: createMemoryAdapter() });
  await store.addAttempt("user-a", attempt("stable-id", "q1", "collection-a", "first"));
  const duplicate = await store.addAttempt("user-a", attempt("stable-id", "q2", "collection-b", "second"));

  assert.equal(duplicate.questionId, "q1");
  assert.equal(duplicate.answer, "first");
  assert.deepEqual(await store.listPendingAttempts("user-a"), [attempt("stable-id", "q1", "collection-a", "first")]);
});

test("V231 keeps users isolated, including same question and attempt IDs", async () => {
  const adapter = createMemoryAdapter();
  const store = createOfflineStore({ adapter, maxQuestions: 1, maxBytes: 1024 });
  await store.saveQuestion("user-a", question("same", "collection-a", { owner: "a" }));
  await store.saveQuestion("user-b", question("same", "collection-b", { owner: "b" }));
  await store.addAttempt("user-a", attempt("same-attempt", "same", "collection-a", "a"));
  await store.addAttempt("user-b", attempt("same-attempt", "same", "collection-b", "b"));

  assert.equal((await store.getQuestion("user-a", "same")).payload.owner, "a");
  assert.equal((await store.getQuestion("user-b", "same")).payload.owner, "b");
  assert.equal((await store.listPendingAttempts("user-a"))[0].answer, "a");
  assert.equal((await store.listPendingAttempts("user-b"))[0].answer, "b");
});

test("V231 export preserves pending attempts and explicitly authorizes account clear", async () => {
  const store = createOfflineStore({ adapter: createMemoryAdapter() });
  await store.saveQuestion("user-a", question("q1"));
  await store.addAttempt("user-a", attempt("attempt-1"));

  await assert.rejects(
    () => store.clearUser("user-a"),
    (error) => error.code === "PENDING_ATTEMPTS",
  );
  const exported = await store.exportPendingAttempts("user-a");
  assert.deepEqual(exported, [attempt("attempt-1")]);
  assert.deepEqual(await store.listPendingAttempts("user-a"), [attempt("attempt-1")]);

  const cleared = await store.clearUser("user-a");
  assert.deepEqual(cleared, { questions: 1, attempts: 1 });
  assert.deepEqual(await store.listQuestions("user-a"), []);
  assert.deepEqual(await store.listPendingAttempts("user-a"), []);
});

test("V231 discardPending is explicit and account clear cannot affect another user", async () => {
  const adapter = createMemoryAdapter();
  const store = createOfflineStore({ adapter });
  await store.saveQuestion("user-a", question("q-a"));
  await store.addAttempt("user-a", attempt("attempt-a", "q-a"));
  await store.saveQuestion("user-b", question("q-b"));

  await store.clearUser("user-a", { discardPending: true });
  assert.deepEqual(await store.listQuestions("user-a"), []);
  assert.deepEqual(await store.listPendingAttempts("user-a"), []);
  assert.deepEqual(
    (await store.listQuestions("user-b")).map((item) => item.questionId),
    ["q-b"],
  );
});

test("V231 removeCollection and clearQuestions preserve the outbox", async () => {
  const store = createOfflineStore({ adapter: createMemoryAdapter() });
  await store.saveQuestion("user-a", question("q1", "collection-a"));
  await store.saveQuestion("user-a", question("q2", "collection-b"));
  await store.addAttempt("user-a", attempt("attempt-1", "q1", "collection-a"));

  assert.equal(await store.removeCollection("user-a", "collection-a"), 1);
  assert.deepEqual((await store.listQuestions("user-a")).map((item) => item.questionId), ["q2"]);
  assert.equal((await store.listPendingAttempts("user-a")).length, 1);
  assert.equal(await store.clearQuestions("user-a"), 1);
  assert.equal((await store.listPendingAttempts("user-a")).length, 1);
});

test("V231 rejects blank user and record IDs", async () => {
  const store = createOfflineStore({ adapter: createMemoryAdapter() });
  await assert.rejects(
    () => store.listQuestions("   "),
    (error) => error.code === "INVALID_USER_ID",
  );
  await assert.rejects(
    () => store.saveQuestion("user-a", question("")),
    (error) => error.code === "INVALID_ID",
  );
  await assert.rejects(
    () => store.addAttempt("user-a", attempt("")),
    (error) => error.code === "INVALID_ID",
  );
});

test("V231 shared adapter serializes concurrent saves and duplicate attempts without crossing users", async () => {
  const adapter = createMemoryAdapter();
  const first = createOfflineStore({ adapter, maxQuestions: 2 });
  const second = createOfflineStore({ adapter, maxQuestions: 2 });
  await first.saveQuestion("user-b", question("q1", "collection-b", { owner: "b" }, [image(16)]));
  await first.addAttempt("user-b", attempt("shared-attempt", "q1", "collection-b", "b"));
  const otherBefore = await adapter.read("user-b");

  const results = await Promise.all([
    first.saveQuestion("user-a", question("q1")),
    second.saveQuestion("user-a", question("q2")),
    first.addAttempt("user-a", attempt("shared-attempt", "q1", "collection-a", "first")),
    second.addAttempt("user-a", attempt("shared-attempt", "q2", "collection-a", "second")),
  ]);
  assert.deepEqual(results[2], results[3]);
  assert.equal((await first.listPendingAttempts("user-a")).length, 1);
  assert.deepEqual((await second.listQuestions("user-a")).map((item) => item.questionId).sort(), ["q1", "q2"]);
  assert.deepEqual(await adapter.read("user-b"), otherBefore);
});

test("V231 failed transaction restores questions, blobs, attempts and export approval together", async () => {
  const adapter = createMemoryAdapter();
  const store = createOfflineStore({ adapter });
  await store.saveQuestion("user-a", question("q1", "collection-a", { owner: "a" }, [image(16)]));
  await store.addAttempt("user-a", attempt("attempt-1"));
  await store.exportPendingAttempts("user-a");
  const before = await adapter.read("user-a");
  const failure = new Error("Abort this transaction");

  await assert.rejects(adapter.transaction("user-a", (state) => {
    state.questions[0].payload.owner = "changed";
    state.questions[0].images = [];
    state.attempts = [];
    state.approvedAttemptIds = [];
    throw failure;
  }), (error) => error === failure);

  assert.deepEqual(await adapter.read("user-a"), before);
  assert.equal(await (await store.getQuestion("user-a", "q1")).images[0].blob.text(), "\0".repeat(16));
});

test("V231 native IndexedDB indexes, scoped reads, races and abort rollback", {
  skip: "fake-indexeddb is not installed. Run tests/fixtures/offline-indexeddb-v231.html on a fresh loopback origin; native browser verification is pending.",
}, () => {
  // The browser harness imports the real module, uses native IDB requests and
  // redirects only the injected factory's DB name to a random test-only DB.
});
