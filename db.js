/* Données du compte dans Cloud Firestore, sous users/{uid}/apps/lecture :
   une sous-collection par type (books, notes, quotes, words) et un document
   par élément, avec les mêmes champs et les mêmes identifiants que dans
   l'ancien stockage local. Lecture n'écrit nulle part ailleurs (À tester
   range ses données sous users/{uid}/apps/atester).

   Quatre écouteurs en temps réel tiennent l'app à jour, y compris des
   changements faits sur un autre appareil ; le cache local persistant de
   Firestore sert l'app hors ligne. Une écriture s'applique tout de suite
   (en mémoire et dans ce cache) et part vers le serveur sans être attendue :
   hors ligne, elle patiente et part au retour du réseau. */
import {
  doc, collection, onSnapshot, setDoc, deleteDoc, writeBatch, getDoc,
  waitForPendingWrites, getDocsFromServer, terminate, clearIndexedDbPersistence
} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
import { firestore } from './firebase.js';

export const STORES = ['books', 'notes', 'quotes', 'words'];
const APP_KEY = 'lecture';
const BATCH_OPS = 400;             // Firestore : 500 opérations au plus par lot
const WIPE_FLAG = 'lecture:effacer-cache';
const RETRY_CODES = ['resource-exhausted', 'unavailable', 'internal', 'deadline-exceeded'];

let refs = null;
const unsubs = new Map();
let hooks = {};
const status = {};                 // par type : { pending, fromCache, server }

/* Démarre la synchronisation du compte. Se résout au premier instantané des
   quatre types (cache local ou serveur), ou après le délai : l'app s'affiche
   avec ce qu'elle a et se complète ensuite.
   onChange(store, changes, { first }) reçoit les changements de données ;
   onSync() signale un changement d'état (envoi en attente, serveur joint) ;
   onError(err) les refus et pannes. */
export function start(uid, { onChange, onSync, onError } = {}, { timeout = 8000 } = {}) {
  stop();
  hooks = { onChange, onSync, onError };
  const base = doc(firestore, 'users', uid, 'apps', APP_KEY);
  refs = Object.fromEntries(STORES.map((s) => [s, collection(base, s)]));
  return new Promise((resolve) => {
    let left = STORES.length;
    const timer = setTimeout(resolve, timeout);
    const one = () => { if (--left === 0) { clearTimeout(timer); resolve(); } };
    STORES.forEach((s) => listen(s, one));
  });
}

function listen(store, onFirst) {
  let first = true;
  const unsub = onSnapshot(refs[store], { includeMetadataChanges: true }, (snap) => {
    const fromCache = snap.metadata.fromCache;
    const prev = status[store] || {};
    status[store] = { pending: snap.metadata.hasPendingWrites, fromCache, server: prev.server || !fromCache };
    const changes = snap.docChanges().map((c) => ({
      type: c.type,
      id: c.doc.id,
      data: c.type === 'removed' ? null : { ...c.doc.data(), id: c.doc.id }
    }));
    if (first || changes.length) hooks.onChange?.(store, changes, { first });
    hooks.onSync?.();
    if (first) { first = false; onFirst(); }
  }, (err) => {
    unsubs.delete(store);
    report(err);
    if (first) { first = false; onFirst(); }
    // Quota du jour atteint ou serveur indisponible : nouvel essai plus tard.
    if (refs && RETRY_CODES.includes(err.code)) {
      setTimeout(() => { if (refs && !unsubs.has(store)) listen(store, () => {}); }, 60000);
    }
  });
  unsubs.set(store, unsub);
}

export function stop() {
  for (const unsub of unsubs.values()) unsub();
  unsubs.clear();
  refs = null;
  for (const k of Object.keys(status)) delete status[k];
}

/* État de la synchronisation, pour les réglages et la déconnexion. */
export function syncState() {
  const all = STORES.map((s) => status[s] || {});
  return {
    pending: all.some((s) => s.pending),           // des changements attendent le serveur
    server: all.every((s) => s.server)              // le serveur a répondu au moins une fois
  };
}

function report(err) {
  console.error('[firestore]', err);
  hooks.onError?.(err);
}

/* Données propres pour Firestore : ni undefined ni prototype. */
const plain = (obj) => JSON.parse(JSON.stringify(obj));

const track = (promise) => {
  promise.catch(report);
  return promise;
};

/* ——— Écritures : appliquées tout de suite, envoyées en arrière-plan ——— */

export function put(store, obj) {
  if (refs) track(setDoc(doc(refs[store], obj.id), plain(obj)));
  return Promise.resolve(obj);
}

export function remove(store, id) {
  if (refs) track(deleteDoc(doc(refs[store], id)));
  return Promise.resolve();
}

/* Écritures groupées ({ type: 'set' | 'delete', store, id, data }),
   appliquées ensemble en local et envoyées par lots. La promesse renvoyée
   se résout quand le serveur a tout reçu (hors ligne : au retour du réseau) ;
   on ne l'attend que pour l'import. */
export function commit(ops) {
  if (!refs || !ops.length) return Promise.resolve();
  const batches = [];
  let batch = null;
  let n = 0;
  for (const op of ops) {
    if (!batch || n >= BATCH_OPS) {
      batch = writeBatch(firestore);
      batches.push(batch);
      n = 0;
    }
    const ref = doc(refs[op.store], op.id);
    if (op.type === 'delete') batch.delete(ref);
    else batch.set(ref, plain(op.data));
    n++;
  }
  return track(Promise.all(batches.map((b) => b.commit())));
}

/* Réécrit un lot d'éléments ({ books: [...], notes: [...] }) : annulation
   d'une suppression. */
export function putMany(data) {
  const ops = [];
  for (const store of STORES) {
    for (const item of data[store] || []) ops.push({ type: 'set', store, id: item.id, data: item });
  }
  commit(ops);
  return Promise.resolve();
}

/* ——— Vérifications ——— */

/* Tout est-il parti vers le serveur ? Faux si des écritures attendent encore
   le réseau au bout du délai. */
export async function flushed(ms = 2500) {
  let timer;
  try {
    return await Promise.race([
      waitForPendingWrites(firestore).then(() => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), ms); })
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/* Document de config/ (clés d'API saisies dans la console Firebase, jamais
   dans le code) ; lisible une fois connecté, gardé dans le cache hors ligne.
   null s'il n'existe pas ou reste injoignable. */
export async function configDoc(name) {
  try {
    const snap = await getDoc(doc(firestore, 'config', name));
    return snap.exists() ? snap.data() : null;
  } catch {
    return null;
  }
}

/* Lecture directe sur le serveur (vérification d'un import, suppression). */
export async function serverDocs(store) {
  const snap = await getDocsFromServer(refs[store]);
  return new Map(snap.docs.map((d) => [d.id, d.data()]));
}

/* ——— Déconnexion : arrêt de Firestore et effacement de son cache local ———
   Seul le cache de l'instance « lecture » est effacé (celui d'À tester est à
   part). S'il est encore ouvert ailleurs (autre onglet), l'effacement est
   refait au prochain lancement, avant toute lecture. */
export async function wipeLocalCache() {
  stop();
  try {
    await terminate(firestore);
    await clearIndexedDbPersistence(firestore);
    return true;
  } catch {
    try { localStorage.setItem(WIPE_FLAG, '1'); } catch { /* stockage indisponible */ }
    return false;
  }
}

export async function pendingWipe() {
  let flag = null;
  try { flag = localStorage.getItem(WIPE_FLAG); } catch { /* stockage indisponible */ }
  if (!flag) return;
  try {
    await clearIndexedDbPersistence(firestore);
    localStorage.removeItem(WIPE_FLAG);
  } catch { /* réessayé au prochain lancement */ }
}
