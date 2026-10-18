/* Import dans le compte, depuis l'ancien stockage de l'appareil ou depuis un
   fichier de sauvegarde JSON (versions 1 et 2 de l'export).
   Fusion sans doublons : chaque élément garde son identifiant, donc un
   import relancé réécrit les mêmes documents au lieu d'en ajouter. Si un
   élément existe déjà dans le compte, la version la plus récente (updatedAt)
   est gardée. Rien n'est jamais supprimé du compte.
   L'import est ensuite vérifié en relisant le compte sur le serveur. */
import { STORES, commit, serverDocs } from './db.js';
import { validCover } from './covers.js';

const EPOCH = '2000-01-01T00:00:00.000Z';   // date de repli, stable d'un import à l'autre
const SEND_TIMEOUT = 60000;

const str = (v) => (typeof v === 'string' ? v : '');
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v)) ? Number(v) : null));
const date = (v) => (typeof v === 'string' && v && !isNaN(new Date(v)) ? v : null);
const tagList = (v) => (Array.isArray(v) ? [...new Set(v.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().toLowerCase()))] : []);

/* Identifiant utilisable comme nom de document Firestore. */
function validId(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v);
  if (!s || s.length > 200 || s.includes('/') || s === '.' || s === '..' || /^__.*__$/.test(s)) return null;
  return s;
}

/* Identifiant de remplacement, le même à chaque import du même élément. */
async function derivedId(store, raw) {
  const { id, ...rest } = raw;
  const bytes = new TextEncoder().encode(store + '\n' + JSON.stringify(rest));
  const hash = await crypto.subtle.digest('SHA-1', bytes);
  return 'import-' + [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* Vérifie un fichier de sauvegarde sans rien modifier : { data } ou { error }. */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { error: 'Ce fichier n’est pas une sauvegarde JSON valide.' }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'Le fichier est vide ou illisible.' };
  if (data.app && data.app !== 'lecture') return { error: 'Ce fichier ne vient pas de l’app Lecture.' };
  if (!Array.isArray(data.books)) return { error: 'Ce fichier ne contient pas de bibliothèque Lecture.' };
  if (Number(data.version) > 2) return { error: 'Cette sauvegarde vient d’une version plus récente de Lecture : mettez l’app à jour d’abord.' };
  return { data };
}

/* Remet chaque champ connu au bon type ; garde les autres tels quels.
   Renvoie null pour un élément inutilisable (sans titre, sans texte…). */
function clean(store, raw, id, bookIdOf) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  // Noms de champs refusés par Firestore (vide, « __…__ ») : écartés.
  const out = Object.fromEntries(Object.entries(raw).filter(([k]) => k && !/^__.*__$/.test(k)));
  out.id = id;
  const createdAt = date(raw.createdAt) || date(raw.updatedAt) || EPOCH;
  out.createdAt = createdAt;
  out.updatedAt = date(raw.updatedAt) || createdAt;
  if (store === 'books') {
    out.title = str(raw.title).trim();
    if (!out.title) return null;
    out.type = ['book', 'article', 'podcast'].includes(raw.type) ? raw.type : 'book';
    out.status = ['toread', 'reading', 'done'].includes(raw.status) ? raw.status : 'toread';
    out.author = str(raw.author);
    out.show = str(raw.show);
    out.totalPages = num(raw.totalPages) || null;
    out.currentPage = Math.max(0, num(raw.currentPage) || 0);
    out.startDate = date(raw.startDate);
    out.endDate = date(raw.endDate);
    out.tags = tagList(raw.tags);
    out.rating = Math.max(0, Math.min(5, num(raw.rating) || 0));
    // Couverture : lien https ou petite vignette seulement.
    if (!validCover(raw.cover)) {
      out.cover = null;
      out.coverSource = null;
      out.googleBooksId = null;
    }
    return out;
  }
  out.text = str(raw.text);
  if (!out.text.trim()) return null;
  out.bookId = raw.bookId == null || raw.bookId === '' ? null : bookIdOf(raw.bookId);
  if (store === 'notes') return out.bookId ? out : null;
  const page = num(raw.page);
  out.page = page == null ? null : Math.max(0, Math.round(page));
  if (store === 'quotes') {
    if (!out.bookId) return null;
    out.tags = tagList(raw.tags);
    return out;
  }
  // words
  out.definition = str(raw.definition);
  out.defSource = str(raw.defSource);
  out.context = str(raw.context);
  return out;
}

/* Prépare l'import sans rien écrire : les écritures à faire et, pour la
   vérification, la date attendue de chaque élément du fichier. */
export async function planImport(data, current) {
  const ids = new Map(); // « store:id du fichier » → id dans le compte
  const resolveId = async (store, raw) => {
    const key = store + ':' + String(raw && raw.id);
    if (!ids.has(key)) ids.set(key, validId(raw && raw.id) || await derivedId(store, raw || {}));
    return ids.get(key);
  };
  for (const raw of data.books || []) await resolveId('books', raw);
  const bookIdOf = (v) => ids.get('books:' + String(v)) || validId(v);

  const ops = [];
  const expected = {};
  const counts = {};
  for (const store of STORES) {
    const have = new Map((current[store] || []).map((x) => [x.id, x]));
    const exp = new Map();
    const c = { total: 0, added: 0, updated: 0, same: 0, skipped: 0 };
    for (const raw of Array.isArray(data[store]) ? data[store] : []) {
      const id = await resolveId(store, raw);
      const item = clean(store, raw, id, bookIdOf);
      if (!item) { c.skipped++; continue; }
      if (exp.has(id)) continue; // doublon dans le fichier même
      c.total++;
      exp.set(id, item.updatedAt);
      const mine = have.get(id);
      if (!mine) { ops.push({ type: 'set', store, id, data: item }); c.added++; }
      else if (item.updatedAt > (mine.updatedAt || '')) { ops.push({ type: 'set', store, id, data: item }); c.updated++; }
      else c.same++;
    }
    expected[store] = exp;
    counts[store] = c;
  }
  return { ops, expected, counts };
}

/* Envoie les écritures ; « sent » quand le serveur a tout reçu, « pending »
   si l'envoi dure (il continue alors en arrière-plan). */
export async function sendImport(plan, timeout = SEND_TIMEOUT) {
  if (!plan.ops.length) return 'sent';
  let timer;
  try {
    return await Promise.race([
      commit(plan.ops).then(() => 'sent'),
      new Promise((resolve) => { timer = setTimeout(() => resolve('pending'), timeout); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/* Relit le compte sur le serveur : chaque élément du fichier doit y être,
   dans sa version importée ou une plus récente. */
export async function verifyImport(plan) {
  let missing = 0;
  for (const store of STORES) {
    const exp = plan.expected[store];
    if (!exp || !exp.size) continue;
    const server = await serverDocs(store);
    for (const [id, updatedAt] of exp) {
      const doc = server.get(id);
      if (!doc || (doc.updatedAt || '') < updatedAt) missing++;
    }
  }
  return { ok: missing === 0, missing };
}

/* « 12 livres, 230 citations, 40 notes et 15 mots » */
export function describeCounts(n) {
  const part = (k, one, many) => (n[k] ? `${n[k]} ${n[k] > 1 ? many : one}` : '');
  const parts = [
    part('books', 'titre', 'titres'),
    part('quotes', 'citation', 'citations'),
    part('notes', 'note', 'notes'),
    part('words', 'mot', 'mots')
  ].filter(Boolean);
  if (!parts.length) return 'rien';
  return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' et ' + parts[parts.length - 1] : parts[0];
}
