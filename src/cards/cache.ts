// Cards fetched from Scryfall, kept in the browser (IndexedDB) so a pasted deck works
// offline afterwards. Only the card data is kept: scripts are functions, which IndexedDB
// can't store, so the Oracle text parser writes them again when the cards are loaded
// (`fetched.ts`), with whatever templates it has by then. Storage can be missing or
// blocked (tests, some private windows): then nothing is kept, and nothing breaks.
import type { CardData } from '../engine/types';

const DB = 'arena-edh';
const STORE = 'cards';

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Runs one request in a transaction on the card store, and gives its result, or `fallback` if storage fails. */
async function run<T>(mode: IDBTransactionMode, fallback: T, work: (store: IDBObjectStore) => IDBRequest | void): Promise<T> {
  const db = await open();
  if (!db) return fallback;
  return new Promise<T>((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(req ? (req.result as T) : fallback);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve(fallback);
      };
    } catch {
      db.close();
      resolve(fallback);
    }
  });
}

/** Every cached card. */
export const loadCached = () => run<CardData[]>('readonly', [], (s) => s.getAll());

/** Keeps these cards, by name, replacing older copies. */
export const saveCached = (cards: CardData[]) =>
  run<void>('readwrite', undefined, (s) => {
    for (const c of cards) s.put(c, c.name);
  });

/** Forgets every cached card. */
export const clearCached = () => run<void>('readwrite', undefined, (s) => void s.clear());
