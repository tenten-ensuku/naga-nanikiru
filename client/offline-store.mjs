const DEFAULT_MAX_QUESTIONS = 200;
const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;
const DATABASE_NAME = "naga-nanikiru-offline-v231";
const DATABASE_VERSION = 1;
const USER_STORE = "users";
const QUESTION_STORE = "questions";
const ATTEMPT_STORE = "attempts";
const ALL_STORES = [USER_STORE, QUESTION_STORE, ATTEMPT_STORE];
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

function offlineError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw offlineError("INVALID_INPUT", label + " はオブジェクトで指定してください。");
  }
  return value;
}

function assertUserId(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw offlineError("INVALID_USER_ID", "userId は空でない文字列で指定してください。");
  }
  const normalized = value.trim();
  if (CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw offlineError("INVALID_USER_ID", "userId に制御文字は指定できません。");
  }
  return normalized;
}

function assertId(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw offlineError("INVALID_ID", label + " は空でない文字列で指定してください。");
  }
  const normalized = value.trim();
  if (CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw offlineError("INVALID_ID", label + " に制御文字は指定できません。");
  }
  return normalized;
}

function cloneForStorage(value, label) {
  try {
    if (typeof globalThis.structuredClone === "function") {
      return globalThis.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  } catch (cause) {
    throw offlineError("INVALID_VALUE", label + " を保存できる形式に変換できません。", cause);
  }
}

function payloadJsonByteLength(payload) {
  let json;
  try {
    json = JSON.stringify(payload);
  } catch (cause) {
    throw offlineError("INVALID_PAYLOAD", "payload はJSON化できる値で指定してください。", cause);
  }
  if (typeof json !== "string") {
    throw offlineError("INVALID_PAYLOAD", "payload はJSON化できる値で指定してください。");
  }
  return new TextEncoder().encode(json).byteLength;
}

function copyBytes(value) {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  return null;
}

function isNativeBlob(value) {
  return typeof globalThis.Blob === "function" && value instanceof globalThis.Blob;
}

async function normalizeImageBlob(value) {
  if (isNativeBlob(value)) {
    if (!Number.isSafeInteger(value.size) || value.size < 0) {
      throw offlineError("INVALID_IMAGE", "画像blobのサイズが不正です。");
    }
    return {
      blob: cloneForStorage(value, "画像blob"),
      sizeBytes: value.size,
    };
  }

  const directBytes = copyBytes(value);
  if (directBytes) {
    return {
      blob: directBytes,
      sizeBytes: directBytes.byteLength,
    };
  }

  if (value && typeof value.arrayBuffer === "function") {
    let buffer;
    try {
      buffer = await value.arrayBuffer();
    } catch (cause) {
      throw offlineError("INVALID_IMAGE", "画像blobを読み取れません。", cause);
    }
    const bytes = copyBytes(buffer);
    if (!bytes) {
      throw offlineError("INVALID_IMAGE", "画像blobのarrayBuffer結果が不正です。");
    }
    try {
      return {
        blob: typeof globalThis.Blob === "function"
          ? new globalThis.Blob([bytes], { type: typeof value.type === "string" ? value.type : "" })
          : bytes,
        sizeBytes: bytes.byteLength,
      };
    } catch (cause) {
      throw offlineError("INVALID_IMAGE", "画像blobを保存できる形式に変換できません。", cause);
    }
  }

  throw offlineError("INVALID_IMAGE", "画像blobはBlob・ArrayBuffer・TypedArrayで指定してください。");
}

async function normalizeQuestion(input) {
  const source = assertObject(input, "question");
  const questionId = assertId(source.questionId, "questionId");
  const shareSlug = assertId(source.shareSlug, "shareSlug");
  const collectionTitle = source.collectionTitle === undefined ? "" : source.collectionTitle;
  if (typeof collectionTitle !== "string") {
    throw offlineError("INVALID_QUESTION", "collectionTitle は文字列で指定してください。");
  }
  if (source.payload === undefined) {
    throw offlineError("INVALID_PAYLOAD", "payload は省略できません。");
  }

  const payloadBytes = payloadJsonByteLength(source.payload);
  const payload = cloneForStorage(source.payload, "payload");
  const imageSources = source.images === undefined ? [] : source.images;
  if (!Array.isArray(imageSources)) {
    throw offlineError("INVALID_IMAGE", "images は配列で指定してください。");
  }

  const images = [];
  let sizeBytes = payloadBytes;
  for (let index = 0; index < imageSources.length; index += 1) {
    const imageSource = assertObject(imageSources[index], "images[" + index + "]");
    const src = assertId(imageSource.src, "images[" + index + "].src");
    if (!hasOwn(imageSource, "blob")) {
      throw offlineError("INVALID_IMAGE", "images[" + index + "].blob は省略できません。");
    }
    const normalizedBlob = await normalizeImageBlob(imageSource.blob);
    sizeBytes += normalizedBlob.sizeBytes;
    if (!Number.isSafeInteger(sizeBytes)) {
      throw offlineError("QUESTION_TOO_LARGE", "質問データのサイズが大きすぎます。");
    }
    images.push({ src, blob: normalizedBlob.blob });
  }

  const question = {
    questionId,
    shareSlug,
    collectionTitle,
    payload,
    images,
  };
  if (source.updatedAt !== undefined) {
    question.updatedAt = cloneForStorage(source.updatedAt, "updatedAt");
  }
  return { question, sizeBytes };
}

function makeEmptyState() {
  return {
    questions: [],
    attempts: [],
    nextQuestionOrder: 0,
    nextAttemptOrder: 0,
    approvedAttemptIds: [],
    removeUser: false,
  };
}

function safeOrder(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function normalizeState(state) {
  if (!state || typeof state !== "object") return makeEmptyState();
  if (!Array.isArray(state.questions)) state.questions = [];
  if (!Array.isArray(state.attempts)) state.attempts = [];
  if (!Array.isArray(state.approvedAttemptIds)) state.approvedAttemptIds = [];
  state.approvedAttemptIds = [...new Set(
    state.approvedAttemptIds.filter((value) => typeof value === "string" && value.length > 0),
  )];
  const maxQuestionOrder = state.questions.reduce(
    (maximum, question) => Math.max(maximum, safeOrder(question?.lruOrder)),
    0,
  );
  const maxAttemptOrder = state.attempts.reduce(
    (maximum, attempt) => Math.max(maximum, safeOrder(attempt?.createdOrder)),
    0,
  );
  state.nextQuestionOrder = Math.max(safeOrder(state.nextQuestionOrder), maxQuestionOrder);
  state.nextAttemptOrder = Math.max(safeOrder(state.nextAttemptOrder), maxAttemptOrder);
  state.removeUser = false;
  return state;
}

function cloneState(state) {
  const normalized = normalizeState(state);
  return {
    questions: normalized.questions.map((question) => cloneForStorage(question, "保存済み質問")),
    attempts: normalized.attempts.map((attempt) => cloneForStorage(attempt, "未同期回答")),
    nextQuestionOrder: normalized.nextQuestionOrder,
    nextAttemptOrder: normalized.nextAttemptOrder,
    approvedAttemptIds: [...normalized.approvedAttemptIds],
    removeUser: false,
  };
}

function questionSizeBytes(question) {
  return Number.isSafeInteger(question?.sizeBytes) && question.sizeBytes >= 0 ? question.sizeBytes : 0;
}

function questionOrder(question) {
  return safeOrder(question?.lruOrder);
}

function attemptOrder(attempt) {
  return safeOrder(attempt?.createdOrder);
}

function compareIds(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareOldestQuestions(left, right) {
  return questionOrder(left) - questionOrder(right) || compareIds(left.questionId, right.questionId);
}

function compareNewestQuestions(left, right) {
  return compareOldestQuestions(right, left);
}

function comparePendingAttempts(left, right) {
  return attemptOrder(left) - attemptOrder(right) || compareIds(left.clientAttemptId, right.clientAttemptId);
}

function publicQuestion(question) {
  const result = {
    questionId: question.questionId,
    shareSlug: question.shareSlug,
    collectionTitle: question.collectionTitle,
    payload: cloneForStorage(question.payload, "質問payload"),
    images: (question.images ?? []).map((image) => ({
      src: image.src,
      blob: cloneForStorage(image.blob, "質問画像"),
    })),
  };
  if (question.updatedAt !== undefined) {
    result.updatedAt = cloneForStorage(question.updatedAt, "質問updatedAt");
  }
  return result;
}

function publicAttempt(attempt) {
  const result = {
    clientAttemptId: attempt.clientAttemptId,
    questionId: attempt.questionId,
    shareSlug: attempt.shareSlug,
  };
  for (const field of ["answer", "grade", "answeredAt", "elapsedMs"]) {
    if (hasOwn(attempt, field) && attempt[field] !== undefined) {
      result[field] = cloneForStorage(attempt[field], "回答" + field);
    }
  }
  return result;
}

function nextOrder(state, field, rows, orderField) {
  const maximum = rows.reduce(
    (current, row) => Math.max(current, safeOrder(row?.[orderField])),
    safeOrder(state[field]),
  );
  return maximum + 1;
}

function questionTooLargeError(sizeBytes, maxQuestions, maxBytes) {
  return offlineError(
    "QUESTION_TOO_LARGE",
    "質問1件がオフライン保存上限を超えています。sizeBytes=" +
      String(sizeBytes) +
      ", maxQuestions=" +
      String(maxQuestions) +
      ", maxBytes=" +
      String(maxBytes),
  );
}

function isQuotaError(error) {
  return error?.code === "STORAGE_QUOTA" ||
    error?.name === "QuotaExceededError" ||
    error?.code === 22 ||
    /quota/i.test(String(error?.message ?? ""));
}

async function withStorageError(operation) {
  try {
    return await operation();
  } catch (error) {
    if (isQuotaError(error) && error?.code !== "QUESTION_TOO_LARGE") {
      throw offlineError("STORAGE_QUOTA", "オフライン保存の容量上限に達しました。", error);
    }
    throw error;
  }
}

function validateLimits(maxQuestions, maxBytes) {
  if (!Number.isSafeInteger(maxQuestions) || maxQuestions < 0) {
    throw offlineError("INVALID_LIMIT", "maxQuestions は0以上の整数で指定してください。");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw offlineError("INVALID_LIMIT", "maxBytes は0以上の整数で指定してください。");
  }
}

export function createMemoryAdapter() {
  const users = new Map();
  const locks = new Map();

  function enqueue(userId, operation) {
    const previous = locks.get(userId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(operation);
    let tracked;
    tracked = run.then(
      () => {
        if (locks.get(userId) === tracked) locks.delete(userId);
      },
      () => {
        if (locks.get(userId) === tracked) locks.delete(userId);
      },
    );
    locks.set(userId, tracked);
    return run;
  }

  return Object.freeze({
    async read(userId) {
      return enqueue(userId, () => cloneState(users.get(userId) ?? makeEmptyState()));
    },

    async transaction(userId, mutator) {
      if (typeof mutator !== "function") {
        throw offlineError("INVALID_ADAPTER", "adapter.transaction に関数が必要です。");
      }
      return enqueue(userId, async () => {
        const draft = cloneState(users.get(userId) ?? makeEmptyState());
        const result = await mutator(draft);
        if (draft.removeUser) {
          users.delete(userId);
        } else {
          users.set(userId, draft);
        }
        return result;
      });
    },

    close() {},
  });
}

function requestResult(request) {
  return request.result;
}

function stateFromRows(userId, userRow, questionRows, attemptRows) {
  const questions = (Array.isArray(questionRows) ? questionRows : [])
    .filter((row) => row && row.userId === userId)
    .map((row) => {
      const copy = { ...row };
      delete copy.userId;
      return copy;
    });
  const attempts = (Array.isArray(attemptRows) ? attemptRows : [])
    .filter((row) => row && row.userId === userId)
    .map((row) => {
      const copy = { ...row };
      delete copy.userId;
      return copy;
    });
  return normalizeState({
    questions,
    attempts,
    nextQuestionOrder: userRow?.nextQuestionOrder,
    nextAttemptOrder: userRow?.nextAttemptOrder,
    approvedAttemptIds: userRow?.approvedAttemptIds,
    removeUser: false,
  });
}

function collectState(tx, userId, onReady, onError) {
  const requests = {
    user: tx.objectStore(USER_STORE).get(userId),
    // Scope the requests before IndexedDB deserializes any records or image blobs.
    questions: tx.objectStore(QUESTION_STORE).index("byUser").getAll(userId),
    attempts: tx.objectStore(ATTEMPT_STORE).index("byUser").getAll(userId),
  };
  const results = {};
  let remaining = Object.keys(requests).length;
  let failed = false;

  for (const [key, request] of Object.entries(requests)) {
    request.onsuccess = () => {
      if (failed) return;
      results[key] = requestResult(request);
      remaining -= 1;
      if (remaining === 0) {
        const questionRows = Array.isArray(results.questions) ? results.questions : [];
        const attemptRows = Array.isArray(results.attempts) ? results.attempts : [];
        onReady(
          stateFromRows(userId, results.user, questionRows, attemptRows),
          {
            questions: questionRows.filter((row) => row && row.userId === userId),
            attempts: attemptRows.filter((row) => row && row.userId === userId),
          },
        );
      }
    };
    request.onerror = () => {
      if (failed) return;
      failed = true;
      onError(request.error ?? offlineError("STORAGE_READ", "IndexedDBの読み取りに失敗しました。"));
    };
  }
}

function writeUserState(tx, userId, state, existingRows) {
  const userStore = tx.objectStore(USER_STORE);
  const questionStore = tx.objectStore(QUESTION_STORE);
  const attemptStore = tx.objectStore(ATTEMPT_STORE);

  for (const question of existingRows.questions) {
    questionStore.delete([userId, question.questionId]);
  }
  for (const attempt of existingRows.attempts) {
    attemptStore.delete([userId, attempt.clientAttemptId]);
  }

  if (state.removeUser) {
    userStore.delete(userId);
    return;
  }

  for (const question of state.questions) {
    questionStore.put({ userId, ...question });
  }
  for (const attempt of state.attempts) {
    attemptStore.put({ userId, ...attempt });
  }
  userStore.put({
    userId,
    nextQuestionOrder: state.nextQuestionOrder,
    nextAttemptOrder: state.nextAttemptOrder,
    approvedAttemptIds: [...state.approvedAttemptIds],
  });
}

function makeIndexedDbAdapter(indexedDB) {
  if (!indexedDB || typeof indexedDB.open !== "function") {
    throw offlineError("INVALID_ADAPTER", "IndexedDBファクトリが利用できません。");
  }

  let databasePromise;
  let database;

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      } catch (cause) {
        reject(offlineError("STORAGE_OPEN", "IndexedDBを開けませんでした。", cause));
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(USER_STORE)) {
          db.createObjectStore(USER_STORE, { keyPath: "userId" });
        }
        for (const [storeName, idField] of [
          [QUESTION_STORE, "questionId"],
          [ATTEMPT_STORE, "clientAttemptId"],
        ]) {
          const store = db.objectStoreNames.contains(storeName)
            ? request.transaction.objectStore(storeName)
            : db.createObjectStore(storeName, { keyPath: ["userId", idField] });
          if (!store.indexNames.contains("byUser")) {
            store.createIndex("byUser", "userId", { unique: false });
          }
        }
      };
      request.onerror = () => {
        reject(offlineError("STORAGE_OPEN", "IndexedDBを開けませんでした。", request.error));
      };
      request.onblocked = () => {
        reject(offlineError("STORAGE_BLOCKED", "IndexedDBの更新がブロックされました。"));
      };
      request.onsuccess = () => {
        database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };
    });
    return databasePromise;
  }

  function read(userId) {
    return openDatabase().then((db) => new Promise((resolve, reject) => {
      let result;
      let settled = false;
      let transaction;
      try {
        transaction = db.transaction(ALL_STORES, "readonly");
      } catch (cause) {
        reject(offlineError("STORAGE_READ", "IndexedDBの読み取りトランザクションを開始できませんでした。", cause));
        return;
      }
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      transaction.onerror = () => fail(transaction.error ?? offlineError("STORAGE_READ", "IndexedDBの読み取りに失敗しました。"));
      transaction.onabort = () => fail(transaction.error ?? offlineError("STORAGE_READ", "IndexedDBの読み取りが中断されました。"));
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve(result ?? makeEmptyState());
      };
      collectState(
        transaction,
        userId,
        (state) => {
          result = state;
        },
        fail,
      );
    }));
  }

  function transaction(userId, mutator) {
    if (typeof mutator !== "function") {
      return Promise.reject(offlineError("INVALID_ADAPTER", "adapter.transaction に関数が必要です。"));
    }
    return openDatabase().then((db) => new Promise((resolve, reject) => {
      let result;
      let operationError;
      let settled = false;
      let transactionHandle;

      const fail = (error) => {
        if (operationError === undefined) operationError = error;
        try {
          transactionHandle.abort();
        } catch {
          if (!settled) {
            settled = true;
            reject(operationError);
          }
        }
      };

      try {
        transactionHandle = db.transaction(ALL_STORES, "readwrite");
      } catch (cause) {
        reject(offlineError("STORAGE_WRITE", "IndexedDBの書き込みトランザクションを開始できませんでした。", cause));
        return;
      }

      transactionHandle.onerror = () => {
        if (settled) return;
        settled = true;
        reject(operationError ?? transactionHandle.error ?? offlineError("STORAGE_WRITE", "IndexedDBへの書き込みに失敗しました。"));
      };
      transactionHandle.onabort = () => {
        if (settled) return;
        settled = true;
        reject(operationError ?? transactionHandle.error ?? offlineError("STORAGE_WRITE", "IndexedDBの書き込みが中断されました。"));
      };
      transactionHandle.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      collectState(
        transactionHandle,
        userId,
        (state, existingRows) => {
          try {
            result = mutator(state);
            if (result && typeof result.then === "function") {
              throw offlineError("INVALID_ADAPTER", "IndexedDB adapterのトランザクション関数は同期処理で指定してください。");
            }
            writeUserState(transactionHandle, userId, state, existingRows);
          } catch (error) {
            fail(error);
          }
        },
        fail,
      );
    }));
  }

  return Object.freeze({
    read,
    transaction,
    close() {
      if (database) database.close();
    },
  });
}

export function createIndexedDbAdapter(indexedDB) {
  return makeIndexedDbAdapter(indexedDB);
}

export function createOfflineStore({
  adapter,
  maxQuestions = DEFAULT_MAX_QUESTIONS,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  validateLimits(maxQuestions, maxBytes);
  const selectedAdapter = adapter === undefined
    ? (
      globalThis.indexedDB && typeof globalThis.indexedDB.open === "function"
        ? createIndexedDbAdapter(globalThis.indexedDB)
        : createMemoryAdapter()
    )
    : adapter;
  if (!selectedAdapter || typeof selectedAdapter.read !== "function" || typeof selectedAdapter.transaction !== "function") {
    throw offlineError("INVALID_ADAPTER", "adapter は read と transaction を実装してください。");
  }

  async function saveQuestion(userId, input) {
    const normalizedUserId = assertUserId(userId);
    const prepared = await normalizeQuestion(input);
    if (prepared.sizeBytes > maxBytes || maxQuestions === 0) {
      throw questionTooLargeError(prepared.sizeBytes, maxQuestions, maxBytes);
    }

    return withStorageError(() => selectedAdapter.transaction(normalizedUserId, (state) => {
      const retained = state.questions.filter((question) => question.questionId !== prepared.question.questionId);
      let totalBytes = retained.reduce((total, question) => total + questionSizeBytes(question), 0) + prepared.sizeBytes;
      const evictable = retained.slice().sort(compareOldestQuestions);
      const kept = retained.slice();
      while (kept.length + 1 > maxQuestions || totalBytes > maxBytes) {
        const oldest = evictable.shift();
        if (!oldest) {
          throw questionTooLargeError(prepared.sizeBytes, maxQuestions, maxBytes);
        }
        const index = kept.indexOf(oldest);
        if (index >= 0) kept.splice(index, 1);
        totalBytes -= questionSizeBytes(oldest);
      }

      const lruOrder = nextOrder(state, "nextQuestionOrder", state.questions, "lruOrder");
      const storedQuestion = {
        ...prepared.question,
        sizeBytes: prepared.sizeBytes,
        lruOrder,
      };
      state.questions = [...kept, storedQuestion];
      state.nextQuestionOrder = lruOrder;
      return publicQuestion(storedQuestion);
    }));
  }

  async function listQuestions(userId) {
    const normalizedUserId = assertUserId(userId);
    const state = await selectedAdapter.read(normalizedUserId);
    return state.questions.slice().sort(compareNewestQuestions).map(publicQuestion);
  }

  async function getQuestion(userId, questionId) {
    const normalizedUserId = assertUserId(userId);
    const normalizedQuestionId = assertId(questionId, "questionId");
    return selectedAdapter.transaction(normalizedUserId, (state) => {
      const question = state.questions.find((item) => item.questionId === normalizedQuestionId);
      if (!question) return null;
      const lruOrder = nextOrder(state, "nextQuestionOrder", state.questions, "lruOrder");
      question.lruOrder = lruOrder;
      state.nextQuestionOrder = lruOrder;
      return publicQuestion(question);
    });
  }

  async function removeCollection(userId, shareSlug) {
    const normalizedUserId = assertUserId(userId);
    const normalizedShareSlug = assertId(shareSlug, "shareSlug");
    return selectedAdapter.transaction(normalizedUserId, (state) => {
      const before = state.questions.length;
      state.questions = state.questions.filter((question) => question.shareSlug !== normalizedShareSlug);
      return before - state.questions.length;
    });
  }

  async function clearQuestions(userId) {
    const normalizedUserId = assertUserId(userId);
    return selectedAdapter.transaction(normalizedUserId, (state) => {
      const count = state.questions.length;
      state.questions = [];
      return count;
    });
  }

  async function addAttempt(userId, input) {
    const normalizedUserId = assertUserId(userId);
    const source = assertObject(input, "attempt");
    const clientAttemptId = assertId(source.clientAttemptId, "clientAttemptId");
    const questionId = assertId(source.questionId, "questionId");
    const shareSlug = assertId(source.shareSlug, "shareSlug");
    if (source.elapsedMs !== undefined &&
      (typeof source.elapsedMs !== "number" || !Number.isFinite(source.elapsedMs) || source.elapsedMs < 0)) {
      throw offlineError("INVALID_ATTEMPT", "elapsedMs は0以上の有限数で指定してください。");
    }

    return selectedAdapter.transaction(normalizedUserId, (state) => {
      const existing = state.attempts.find((attempt) => attempt.clientAttemptId === clientAttemptId);
      if (existing) return publicAttempt(existing);

      const attempt = {
        clientAttemptId,
        questionId,
        shareSlug,
      };
      for (const field of ["answer", "grade", "answeredAt", "elapsedMs"]) {
        if (hasOwn(source, field) && source[field] !== undefined) {
          attempt[field] = cloneForStorage(source[field], "回答" + field);
        }
      }
      const createdOrder = nextOrder(state, "nextAttemptOrder", state.attempts, "createdOrder");
      attempt.createdOrder = createdOrder;
      state.attempts.push(attempt);
      state.nextAttemptOrder = createdOrder;
      return publicAttempt(attempt);
    });
  }

  async function listPendingAttempts(userId) {
    const normalizedUserId = assertUserId(userId);
    const state = await selectedAdapter.read(normalizedUserId);
    return state.attempts.slice().sort(comparePendingAttempts).map(publicAttempt);
  }

  async function acknowledgeAttempt(userId, id) {
    const normalizedUserId = assertUserId(userId);
    const normalizedId = assertId(id, "attempt id");
    return selectedAdapter.transaction(normalizedUserId, (state) => {
      const index = state.attempts.findIndex((attempt) => attempt.clientAttemptId === normalizedId);
      if (index < 0) return false;
      state.attempts.splice(index, 1);
      state.approvedAttemptIds = state.approvedAttemptIds.filter((attemptId) => attemptId !== normalizedId);
      return true;
    });
  }

  async function exportPendingAttempts(userId) {
    const normalizedUserId = assertUserId(userId);
    return selectedAdapter.transaction(normalizedUserId, (state) => {
      const pending = state.attempts.slice().sort(comparePendingAttempts);
      const approved = new Set(state.approvedAttemptIds);
      for (const attempt of pending) approved.add(attempt.clientAttemptId);
      state.approvedAttemptIds = [...approved];
      return pending.map(publicAttempt);
    });
  }

  async function clearUser(userId, options = {}) {
    const normalizedUserId = assertUserId(userId);
    const source = assertObject(options, "clearUser options");
    const discardPending = source.discardPending === undefined ? false : source.discardPending;
    if (typeof discardPending !== "boolean") {
      throw offlineError("INVALID_INPUT", "discardPending はbooleanで指定してください。");
    }

    return selectedAdapter.transaction(normalizedUserId, (state) => {
      const approved = new Set(state.approvedAttemptIds);
      const hasUnapproved = state.attempts.some((attempt) => !approved.has(attempt.clientAttemptId));
      if (hasUnapproved && !discardPending) {
        throw offlineError(
          "PENDING_ATTEMPTS",
          "未同期の回答があります。先にexportPendingAttemptsを実行するか、discardPending:trueを明示してください。",
        );
      }
      const result = {
        questions: state.questions.length,
        attempts: state.attempts.length,
      };
      state.questions = [];
      state.attempts = [];
      state.approvedAttemptIds = [];
      state.removeUser = true;
      return result;
    });
  }

  return Object.freeze({
    saveQuestion,
    listQuestions,
    getQuestion,
    removeCollection,
    clearQuestions,
    addAttempt,
    listPendingAttempts,
    acknowledgeAttempt,
    exportPendingAttempts,
    clearUser,
  });
}
