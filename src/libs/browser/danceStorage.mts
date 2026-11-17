import type { Dance } from "../dance/dance.mts";
import { parseDance, parseDanceJSON } from "../dance/persistence.mts";

const DATABASE = "milonga-studio";
const STORE = "dances";

/** IndexedDB is per origin/browser profile. Each saved record is a complete
 * snapshot, including figures, so catalogue updates cannot rewrite practice
 * dances. Resolve writes only on transaction completion, never request success
 * (a transaction can still fail, e.g. when storage is full). */
async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  if (typeof indexedDB === "undefined")
    throw new Error(
      "Local saving is unavailable in this browser. Export JSON instead.",
    );
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error("Couldn’t open local dances. Export JSON to keep a copy."),
      );
    request.onblocked = () =>
      reject(new Error("Close other Milonga Studio tabs and try again."));
  });
  db.onversionchange = () => db.close();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = operation(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () =>
        reject(
          new Error(
            "Couldn’t access local dances. Storage may be full or disabled; export JSON to keep a copy.",
          ),
        );
      tx.onerror = () => {
        /* onabort reports failure after rollback. */
      };
    });
  } finally {
    db.close();
  }
}

export async function listLocalDances(): Promise<Dance[]> {
  const records: unknown[] = await transaction("readonly", (store) =>
    store.getAll(),
  );
  // Do not silently discard invalid records: a future app version might need
  // to migrate them. Leave storage intact and surface the validation error.
  return records
    .map(parseDance)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function saveLocalDance(dance: Dance): Promise<void> {
  await transaction("readwrite", (store) =>
    store.put(parseDanceJSON(JSON.stringify(dance))),
  );
}
export async function deleteLocalDance(id: string): Promise<void> {
  await transaction("readwrite", (store) => store.delete(id));
}
