import type {
  ExperimentExport,
  ExperimentRecord,
  FrameRecord,
  PhaseRecord,
} from "../types";

const DB_NAME = "facial-expression-logger-db";
const DB_VERSION = 2;
const EXPERIMENTS_STORE = "experiments";
const PHASES_STORE = "phases";
const FRAMES_STORE = "frames";
const EXPERIMENT_INDEX = "by-experiment";

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

      if (!database.objectStoreNames.contains(EXPERIMENTS_STORE)) {
        database.createObjectStore(EXPERIMENTS_STORE, { keyPath: "id" });
      }

      if (!database.objectStoreNames.contains(PHASES_STORE)) {
        const phasesStore = database.createObjectStore(PHASES_STORE, {
          keyPath: ["experimentId", "phaseKey"],
        });
        phasesStore.createIndex(EXPERIMENT_INDEX, "experimentId", { unique: false });
      }

      if (!database.objectStoreNames.contains(FRAMES_STORE)) {
        const framesStore = database.createObjectStore(FRAMES_STORE, {
          keyPath: ["experimentId", "phaseKey", "frameIndex"],
        });
        framesStore.createIndex(EXPERIMENT_INDEX, "experimentId", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
  });
}

export async function listExperiments(): Promise<ExperimentRecord[]> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(EXPERIMENTS_STORE, "readonly");
    const experiments = await requestToPromise(
      transaction.objectStore(EXPERIMENTS_STORE).getAll(),
    );
    await transactionToPromise(transaction);

    return (experiments as ExperimentRecord[]).sort((left, right) =>
      right.startedAt.localeCompare(left.startedAt),
    );
  } finally {
    database.close();
  }
}

export async function createExperiment(experiment: ExperimentRecord): Promise<void> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(EXPERIMENTS_STORE, "readwrite");
    transaction.objectStore(EXPERIMENTS_STORE).put(experiment);
    await transactionToPromise(transaction);
  } finally {
    database.close();
  }
}

export async function getExperiment(
  experimentId: string,
): Promise<ExperimentRecord | undefined> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(EXPERIMENTS_STORE, "readonly");
    const result = (await requestToPromise(
      transaction.objectStore(EXPERIMENTS_STORE).get(experimentId),
    )) as ExperimentRecord | undefined;
    await transactionToPromise(transaction);
    return result;
  } finally {
    database.close();
  }
}

export async function completeExperiment(
  experimentId: string,
  endedAt: string,
  completedPhases: ExperimentRecord["completedPhases"],
  status: ExperimentRecord["status"] = "completed",
): Promise<void> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(EXPERIMENTS_STORE, "readwrite");
    const store = transaction.objectStore(EXPERIMENTS_STORE);
    const current = (await requestToPromise(store.get(experimentId))) as
      | ExperimentRecord
      | undefined;

    if (!current) {
      throw new Error("Experiment record was not found.");
    }

    store.put({
      ...current,
      endedAt,
      completedPhases,
      status,
    } satisfies ExperimentRecord);

    await transactionToPromise(transaction);
  } finally {
    database.close();
  }
}

export async function updateExperimentCompletedPhases(
  experimentId: string,
  completedPhases: ExperimentRecord["completedPhases"],
): Promise<void> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(EXPERIMENTS_STORE, "readwrite");
    const store = transaction.objectStore(EXPERIMENTS_STORE);
    const current = (await requestToPromise(store.get(experimentId))) as
      | ExperimentRecord
      | undefined;

    if (!current) {
      throw new Error("Experiment record was not found.");
    }

    store.put({
      ...current,
      completedPhases,
    } satisfies ExperimentRecord);

    await transactionToPromise(transaction);
  } finally {
    database.close();
  }
}

export async function createPhase(phase: PhaseRecord): Promise<void> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(PHASES_STORE, "readwrite");
    transaction.objectStore(PHASES_STORE).put(phase);
    await transactionToPromise(transaction);
  } finally {
    database.close();
  }
}

export async function completePhase(
  experimentId: string,
  phaseKey: PhaseRecord["phaseKey"],
  endedAt: string,
  frameCount: number,
): Promise<void> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(PHASES_STORE, "readwrite");
    const store = transaction.objectStore(PHASES_STORE);
    const current = (await requestToPromise(
      store.get([experimentId, phaseKey]),
    )) as PhaseRecord | undefined;

    if (!current) {
      throw new Error("Phase record was not found.");
    }

    store.put({
      ...current,
      endedAt,
      frameCount,
    } satisfies PhaseRecord);

    await transactionToPromise(transaction);
  } finally {
    database.close();
  }
}

export async function getPhasesForExperiment(
  experimentId: string,
): Promise<PhaseRecord[]> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(PHASES_STORE, "readonly");
    const store = transaction.objectStore(PHASES_STORE);
    const index = store.index(EXPERIMENT_INDEX);
    const phases = (await requestToPromise(
      index.getAll(IDBKeyRange.only(experimentId)),
    )) as PhaseRecord[];
    await transactionToPromise(transaction);
    return phases.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
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

export async function getFramesForExperiment(
  experimentId: string,
): Promise<FrameRecord[]> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(FRAMES_STORE, "readonly");
    const store = transaction.objectStore(FRAMES_STORE);
    const index = store.index(EXPERIMENT_INDEX);
    const frames = (await requestToPromise(
      index.getAll(IDBKeyRange.only(experimentId)),
    )) as FrameRecord[];
    await transactionToPromise(transaction);

    return frames.sort((left, right) => {
      if (left.timestampMs !== right.timestampMs) {
        return left.timestampMs - right.timestampMs;
      }
      return left.frameIndex - right.frameIndex;
    });
  } finally {
    database.close();
  }
}

export async function getExperimentExport(
  experimentId: string,
): Promise<ExperimentExport> {
  const [experiment, phases, frames] = await Promise.all([
    getExperiment(experimentId),
    getPhasesForExperiment(experimentId),
    getFramesForExperiment(experimentId),
  ]);

  if (!experiment) {
    throw new Error("Export target experiment was not found.");
  }

  return { experiment, phases, frames };
}

async function deleteAllByExperimentId(
  transaction: IDBTransaction,
  storeName: string,
  experimentId: string,
): Promise<void> {
  const store = transaction.objectStore(storeName);
  const index = store.index(EXPERIMENT_INDEX);
  const request = index.openCursor(IDBKeyRange.only(experimentId));

  await new Promise<void>((resolve, reject) => {
    request.onerror = () =>
      reject(request.error ?? new Error(`Failed to delete ${storeName} records.`));
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
}

export async function deleteExperiment(experimentId: string): Promise<void> {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(
      [EXPERIMENTS_STORE, PHASES_STORE, FRAMES_STORE],
      "readwrite",
    );

    transaction.objectStore(EXPERIMENTS_STORE).delete(experimentId);
    await deleteAllByExperimentId(transaction, PHASES_STORE, experimentId);
    await deleteAllByExperimentId(transaction, FRAMES_STORE, experimentId);
    await transactionToPromise(transaction);
  } finally {
    database.close();
  }
}
