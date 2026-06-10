/* Couche de persistance : IndexedDB avec une petite API en promesses.
   Trois magasins : books, notes, quotes (notes et quotes indexés par bookId). */

const DB_NAME = 'lecture-db';
const DB_VERSION = 1;
export const STORES = ['books', 'notes', 'quotes'];

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) {
        db.createObjectStore('books', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('notes')) {
        const s = db.createObjectStore('notes', { keyPath: 'id' });
        s.createIndex('bookId', 'bookId');
      }
      if (!db.objectStoreNames.contains('quotes')) {
        const s = db.createObjectStore('quotes', { keyPath: 'id' });
        s.createIndex('bookId', 'bookId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqResult(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(store) {
  const db = await open();
  return reqResult(db.transaction(store).objectStore(store).getAll());
}

export async function put(store, value) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await txDone(tx);
  return value;
}

export async function remove(store, id) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(id);
  await txDone(tx);
}

/* Supprime un livre ainsi que toutes ses notes et citations. */
export async function removeBookCascade(bookId) {
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  tx.objectStore('books').delete(bookId);
  for (const store of ['notes', 'quotes']) {
    const index = tx.objectStore(store).index('bookId');
    index.getAllKeys(bookId).onsuccess = (e) => {
      for (const key of e.target.result) tx.objectStore(store).delete(key);
    };
  }
  await txDone(tx);
}

export async function exportAll() {
  const [books, notes, quotes] = await Promise.all(STORES.map(getAll));
  return { app: 'lecture', version: 1, exportedAt: new Date().toISOString(), books, notes, quotes };
}

/* Remplace l'intégralité des données (utilisé par l'import JSON). */
export async function importAll(data) {
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  for (const store of STORES) {
    tx.objectStore(store).clear();
    for (const item of data[store] || []) {
      if (item && item.id) tx.objectStore(store).put(item);
    }
  }
  await txDone(tx);
}
