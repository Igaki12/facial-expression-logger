import type { FrameRecord, SessionRecord } from "../types";

const DB_NAME = "facial-expression-logger-db";
const DB_VERSION = 1;
const SESSIONS_STORE = "sessions";
const FRAMES_STORE = "frames";
const SESSION_INDEX = "by-session";

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(SESSIONS_STORE)) {
        database.createObjectStore(SESSIONS_STORE, { keyPath: "id" });
      }

      if (!database.objectStoreNames.contains(FRAMES_STORE)) {
        const framesStore = database.createObjectStore(FRAMES_STORE, {
          keyPath: ["sessionId", "frameIndex"],
        });
        framesStore.createIndex(SESSION_INDEX, "sessionId", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
  });
}

export async function listSessions(): Promise<SessionRecord[]> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(SESSIONS_STORE, "readonly");
    const sessions = await requestToPromise(
      transaction.objectStore(SESSIONS_STORE).getAll(),
    );
    await transactionToPromise(transaction);

    return (sessions as SessionRecord[]).sort((left, right) =>
      right.startedAt.localeCompare(left.startedAt),
    );
  } finally {
    database.close();
  }
}

export async function createSession(session: SessionRecord): Promise<void> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(SESSIONS_STORE, "readwrite");
    transaction.objectStore(SESSIONS_STORE).put(session);
    await transactionToPromise(transaction);
  } finally {
    database.close();
  }
}

export async function appendFrames(frames: FrameRecord[]): Promise<void> {
  if (frames.length === 0) {
    return;
  }

  const database = await openDatabase();

  try {
    const transaction = database.transaction(FRAMES_STORE, "readwrite");
    const store = transaction.objectStore(FRAMES_STORE);

    for (const frame of frames) {
      store.put(frame);
    }

    await transactionToPromise(transaction);
  } finally {
    database.close();
  }
}

export async function completeSession(
  sessionId: string,
  endedAt: string,
  frameCount: number,
): Promise<void> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(SESSIONS_STORE, "readwrite");
    const store = transaction.objectStore(SESSIONS_STORE);
    const current = (await requestToPromise(store.get(sessionId))) as SessionRecord | undefined;

    if (!current) {
      throw new Error("Session record was not found.");
    }

    store.put({
      ...current,
      endedAt,
      frameCount,
      status: "completed",
    } satisfies SessionRecord);

    await transactionToPromise(transaction);
  } finally {
    database.close();
  }
}

export async function getSession(sessionId: string): Promise<SessionRecord | undefined> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(SESSIONS_STORE, "readonly");
    const result = (await requestToPromise(
      transaction.objectStore(SESSIONS_STORE).get(sessionId),
    )) as SessionRecord | undefined;
    await transactionToPromise(transaction);
    return result;
  } finally {
    database.close();
  }
}

export async function getFramesForSession(sessionId: string): Promise<FrameRecord[]> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(FRAMES_STORE, "readonly");
    const store = transaction.objectStore(FRAMES_STORE);
    const index = store.index(SESSION_INDEX);
    const frames = (await requestToPromise(
      index.getAll(IDBKeyRange.only(sessionId)),
    )) as FrameRecord[];
    await transactionToPromise(transaction);

    return frames.sort((left, right) => left.frameIndex - right.frameIndex);
  } finally {
    database.close();
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(
      [SESSIONS_STORE, FRAMES_STORE],
      "readwrite",
    );

    transaction.objectStore(SESSIONS_STORE).delete(sessionId);

    const framesStore = transaction.objectStore(FRAMES_STORE);
    const index = framesStore.index(SESSION_INDEX);
    const request = index.openCursor(IDBKeyRange.only(sessionId));

    await new Promise<void>((resolve, reject) => {
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to delete session frames."));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        cursor.delete();
        cursor.continue();
      };
    });

    await transactionToPromise(transaction);
  } finally {
    database.close();
  }
}
