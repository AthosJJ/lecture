/* Ancien stockage (versions 13 et précédentes) : la base IndexedDB
   « lecture-db » de l'appareil, lue ici seulement pour l'import dans le
   compte, puis supprimée à la demande. Elle n'est jamais modifiée : tant
   qu'on ne la vide pas, les données restent intactes sur l'appareil. */

const NAME = 'lecture-db';
export const LEGACY_STORES = ['books', 'notes', 'quotes', 'words'];

/* Ouvre la base si elle existe, sans jamais la créer. */
function open() {
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(NAME); } catch { resolve(null); return; }
    req.onupgradeneeded = (e) => {
      if (e.oldVersion === 0) req.transaction.abort(); // n'existait pas
    };
    req.onsuccess = () => {
      const idb = req.result;
      // Une version plus récente de l'app demanderait la base : on la libère.
      idb.onversionchange = () => idb.close();
      resolve(idb);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function readAll(idb, store) {
  if (!idb.objectStoreNames.contains(store)) return Promise.resolve([]); // « words » n'existe pas en version 1
  return new Promise((resolve, reject) => {
    const req = idb.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/* Contenu de l'ancienne base ({ books, notes, quotes, words }), ou null si
   elle est absente ou vide. */
export async function readLegacy() {
  const idb = await open();
  if (!idb) return null;
  try {
    const lists = await Promise.all(LEGACY_STORES.map((s) => readAll(idb, s)));
    const data = Object.fromEntries(LEGACY_STORES.map((s, i) => [s, lists[i]]));
    return lists.some((l) => l.length) ? data : null;
  } catch {
    return null;
  } finally {
    idb.close();
  }
}

/* Combien d'éléments l'ancienne base contient-elle ? null si rien. */
export async function legacySummary() {
  const data = await readLegacy();
  if (!data) return null;
  return Object.fromEntries(LEGACY_STORES.map((s) => [s, data[s].length]));
}

/* Supprime l'ancienne base de cet appareil. */
export function deleteLegacy() {
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.deleteDatabase(NAME); } catch { resolve(false); return; }
    req.onsuccess = () => resolve(true);
    req.onerror = () => resolve(false);
    req.onblocked = () => resolve(false);
  });
}
