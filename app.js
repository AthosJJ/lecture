import * as db from './db.js';
import { watchAuth, currentUser, signIn, signUp, resetPassword, signOutUser, authMessage, MIN_PASSWORD } from './account.js';
import { legacySummary, readLegacy, deleteLegacy } from './legacy.js';
import { parseBackup, planImport, sendImport, verifyImport, describeCounts } from './importer.js';
import { setBooksKey, booksSearchReady, searchBooks, photoThumbnail, googleBooksPage, validCover } from './covers.js';

/* Synchroniser avec VERSION dans sw.js à chaque mise à jour. */
const APP_VERSION = '16';

/* ——— État en mémoire : copie des données du compte, tenue à jour par la
   synchronisation Firestore (db.js) ——— */
const state = {
  books: [],
  notes: [],
  quotes: [],
  words: [],
  route: 'library',
  currentBookId: null,
  bookTab: 'quotes',
  query: '',
  libraryTag: null,
  quotesBook: '',
  quotesTag: null,
  quotesQuery: '',
  wordsQuery: '',
  wordsBook: '',
  wordsSort: 'recent',
  editing: { bookId: null, noteId: null, noteBookId: null, quoteId: null, quoteBookId: null, wordId: null },
  form: { type: 'book', status: 'toread', rating: 0, cover: null }
};

const STATUS_LABELS = { toread: 'À lire', reading: 'En cours', done: 'Terminé' };
const STATUS_ORDER = ['reading', 'toread', 'done'];
const TYPE_LABELS = { book: 'Livre', article: 'Article', podcast: 'Podcast' };

/* Sous-titre d'une carte : auteur, ou « Émission — auteur » pour un podcast. */
function subtitleOf(book) {
  return book.type === 'podcast'
    ? [book.show, book.author].filter(Boolean).join(' — ')
    : (book.author || '');
}

/* Titre complet d'un livre, pour rappeler la source dans les formulaires. */
function bookLabel(book) {
  const sub = subtitleOf(book);
  return book.title + (sub ? ' — ' + sub : '');
}

/* Position d'une citation : « p. 42 » ou « à 42 min » pour un podcast. */
function quotePlace(qt, book) {
  if (qt.page == null || qt.page === '') return null;
  return book && book.type === 'podcast' ? `à ${qt.page} min` : `p. ${qt.page}`;
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* ——— Utilitaires ——— */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));

const todayISO = () => new Date().toISOString().slice(0, 10);

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function parseTags(input) {
  return [...new Set(String(input || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

function hueFromString(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}

function initials(title) {
  const words = String(title).trim().split(/\s+/).filter((w) => /\p{L}|\p{N}/u.test(w));
  return words.slice(0, 2).map((w) => [...w][0].toUpperCase()).join('');
}

function stars(n) {
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function pct(book) {
  if (!book.totalPages) return null;
  return Math.max(0, Math.min(100, Math.round(((book.currentPage || 0) / book.totalPages) * 100)));
}

const byRecent = (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '');

function bookById(id) { return state.books.find((b) => b.id === id); }
function notesOf(id) { return state.notes.filter((n) => n.bookId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
function quotesOf(id) { return state.quotes.filter((q) => q.bookId === id).sort((a, b) => (a.page ?? 1e9) - (b.page ?? 1e9)); }
function wordsOf(id) {
  return state.words.filter((w) => w.bookId === id)
    .sort((a, b) => (a.page ?? 1e9) - (b.page ?? 1e9) || a.createdAt.localeCompare(b.createdAt));
}

/* Forme comparable d'un mot : minuscules, sans accents ni apostrophe typographique. */
const normWord = (s) => String(s || '').trim().toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, "'").replace(/\s+/g, ' ');

function fmtShortDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ——— Toast, avec bouton d'action facultatif (« Annuler ») ——— */
let toastTimer = null;
let toastAction = null;

function toast(msg, action = null) {
  const el = $('#toast');
  $('#toast-msg').textContent = msg;
  const btn = $('#toast-action');
  toastAction = action;
  btn.hidden = !action;
  if (action) btn.textContent = action.label;
  el.classList.toggle('actionable', Boolean(action));
  el.classList.add('show');
  clearTimeout(toastTimer);
  // Les messages longs restent affichés plus longtemps.
  const duration = action ? 5500 : Math.min(6000, Math.max(2200, msg.length * 55));
  toastTimer = setTimeout(hideToast, duration);
}

function hideToast() {
  clearTimeout(toastTimer);
  $('#toast').classList.remove('show');
  toastAction = null;
}

/* Champ à remplir : il est signalé (contour rouge, petite secousse) sans y
   placer le curseur. Le clavier ne s'ouvre jamais tout seul : seulement
   quand on touche un champ. */
function flagField(el) {
  if (!el) return;
  el.classList.remove('needs-input');
  void el.offsetWidth; // rejoue l'animation
  el.classList.add('needs-input');
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  clearTimeout(el.flagTimer);
  el.flagTimer = setTimeout(() => el.classList.remove('needs-input'), 1800);
}

/* ——— Routage par hash (le geste retour iOS fonctionne) ——— */
function navigate(hash) { location.hash = hash; }

function router() {
  const hash = location.hash || '#/library';
  const m = hash.match(/^#\/book\/(.+)$/);
  if (m && bookById(m[1])) {
    // Un autre livre s'ouvre sur ses citations ; le même garde son onglet.
    if (state.currentBookId !== m[1]) state.bookTab = 'quotes';
    state.route = 'book';
    state.currentBookId = m[1];
  } else if (hash === '#/quotes') {
    state.route = 'quotes';
  } else if (hash === '#/words') {
    state.route = 'words';
  } else if (hash === '#/account' || hash === '#/stats' || hash === '#/settings') {
    state.route = 'account';
  } else {
    state.route = 'library';
  }
  render();
}

function render() {
  const r = state.route;
  // Ne remonte en haut et n'anime les cartes qu'en changeant d'écran, pas à
  // chaque rafraîchissement (page +1, ajout d'une note, frappe…).
  const screenKey = r + (r === 'book' ? ':' + state.currentBookId : '');
  const sameScreen = render.lastScreen === screenKey;
  $('#app').classList.toggle('no-anim', sameScreen);

  $$('.view').forEach((v) => v.classList.remove('active'));
  $('#tabbar').classList.toggle('hidden', r === 'book');
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.route === r));
  $('#book-actions').hidden = r !== 'book';

  if (r === 'library') { $('#view-library').classList.add('active'); renderLibrary(); }
  if (r === 'quotes') { $('#view-quotes').classList.add('active'); renderQuotesView(); }
  if (r === 'words') { $('#view-words').classList.add('active'); renderWordsView(); }
  if (r === 'account') { $('#view-account').classList.add('active'); renderStats(); renderSettings(); }
  if (r === 'book') { $('#view-book').classList.add('active'); renderBook(); }

  if (!sameScreen) window.scrollTo(0, 0);
  render.lastScreen = screenKey;
}

/* Rafraîchit la liste sans rejouer les animations d'entrée. */
function refresh(fn) {
  $('#app').classList.add('no-anim');
  fn();
}

/* ═══════════ ÉCRAN BIBLIOTHÈQUE ═══════════ */

/* Vignette d'un livre : sa couverture (Google Books ou photo) si elle en a
   une, sinon initiales sur un dégradé. Si l'image ne charge pas (hors ligne,
   lien mort), les initiales reprennent la place. */
function coverHTML(book, extra = '') {
  const key = book.type === 'podcast' && book.show ? book.show : book.title;
  const kind = book.type === 'article' ? ' article' : (book.type === 'podcast' ? ' podcast' : '');
  const img = validCover(book.cover)
    ? `<img src="${esc(book.cover)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : '';
  return `<div class="cover${kind}${img ? ' has-img' : ''}${extra}" style="--h:${hueFromString(key)}"><span>${esc(initials(key))}</span>${img}</div>`;
}

function bookCard(book, i, matchBadge) {
  const p = pct(book);
  const sub = subtitleOf(book);
  return `
  <article class="card book-card" data-id="${book.id}" style="animation-delay:${Math.min(i * 35, 350)}ms">
    ${coverHTML(book)}
    <div class="book-info">
      <h3>${esc(book.title)}</h3>
      ${sub ? `<p class="author">${esc(sub)}</p>` : ''}
      ${p !== null && book.status !== 'toread' ? `
      <div class="progress-row">
        <div class="progress"><i style="width:${p}%"></i></div>
        <span class="progress-label">${book.currentPage || 0}/${book.totalPages}</span>
      </div>` : ''}
      <div class="badges">
        ${book.type && book.type !== 'book' ? `<span class="badge">${TYPE_LABELS[book.type] || ''}</span>` : ''}
        ${book.status === 'done' && book.rating ? `<span class="rating-inline">${stars(book.rating)}</span>` : ''}
        ${matchBadge ? `<span class="badge match">${matchBadge}</span>` : ''}
      </div>
    </div>
  </article>`;
}

function renderLibrary() {
  const listEl = $('#library-list');
  const q = state.query.trim().toLowerCase();

  // Puces de tags (tags des livres)
  const allTags = [...new Set(state.books.flatMap((b) => b.tags || []))].sort();
  if (state.libraryTag && !allTags.includes(state.libraryTag)) state.libraryTag = null;
  const chipsEl = $('#library-tags');
  chipsEl.hidden = allTags.length === 0;
  chipsEl.innerHTML = allTags.map((t) =>
    `<button class="chip ${state.libraryTag === t ? 'active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('');

  let books = state.books.slice();
  if (state.libraryTag) books = books.filter((b) => (b.tags || []).includes(state.libraryTag));

  if (state.books.length === 0) {
    listEl.innerHTML = `<div class="empty">
      <span class="glyph">❧</span>
      <h3>Votre bibliothèque est vide</h3>
      <p>Touchez + pour ajouter votre premier livre, article ou podcast.</p>
    </div>`;
    return;
  }

  // Recherche globale : titres, auteurs, tags, notes et citations
  if (q) {
    const results = [];
    for (const b of books) {
      const inBook = (b.title + ' ' + (b.author || '') + ' ' + (b.show || '') + ' ' + (b.tags || []).join(' ')).toLowerCase().includes(q);
      const inNote = notesOf(b.id).some((n) => n.text.toLowerCase().includes(q));
      const inQuote = quotesOf(b.id).some((qt) => qt.text.toLowerCase().includes(q));
      const inWord = wordsOf(b.id).some((w) => (w.text + ' ' + (w.definition || '')).toLowerCase().includes(q));
      if (inBook || inNote || inQuote || inWord) {
        results.push({ book: b, badge: inBook ? null : (inNote ? 'trouvé dans les notes' : (inQuote ? 'trouvé dans les citations' : 'trouvé dans les mots')) });
      }
    }
    listEl.innerHTML = results.length
      ? `<h2 class="section-title">Résultats <span class="count">· ${results.length}</span></h2>`
        + results.map((r, i) => bookCard(r.book, i, r.badge)).join('')
      : `<div class="empty"><h3>Aucun résultat</h3><p>Rien ne correspond à « ${esc(state.query)} ».</p></div>`;
    return;
  }

  // Classement par statut
  listEl.innerHTML = STATUS_ORDER.map((status) => {
    const group = books.filter((b) => b.status === status).sort(byRecent);
    if (!group.length) return '';
    return `<h2 class="section-title">${STATUS_LABELS[status]} <span class="count">· ${group.length}</span></h2>`
      + group.map((b, i) => bookCard(b, i)).join('');
  }).join('') || `<div class="empty"><h3>Aucun livre</h3><p>Aucun livre ne porte ce tag.</p></div>`;
}

/* ═══════════ NOTES & CITATIONS : cartes ═══════════
   Toucher une carte l'ouvre pour la modifier ; la glisser vers la gauche
   la supprime (avec « Annuler » dans le toast). */

const LIST_HINT = '<p class="list-hint">Touchez pour modifier · glissez vers la gauche pour supprimer</p>';

function quoteCard(qt, i, withSource = true) {
  const book = bookById(qt.bookId);
  const place = quotePlace(qt, book) || (book && book.type === 'podcast' ? 'minutage non précisé' : 'page non précisée');
  return `
  <div class="swipe-wrap" style="animation-delay:${Math.min(i * 35, 350)}ms">
    <div class="swipe-bg" aria-hidden="true">Supprimer</div>
    <blockquote class="card quote-card swipeable" data-kind="quote" data-id="${qt.id}" tabindex="0" aria-label="Citation — toucher pour modifier">
      <span class="qmark">“</span>
      <p class="qtext">${esc(qt.text)}</p>
      <footer class="entry-foot">
        <span>${withSource && book ? `<button type="button" class="qsource" data-book="${qt.bookId}">${esc(book.title)}</button> · ` : ''}${esc(place)}</span>
        ${(qt.tags || []).length ? `<span class="tagline">${qt.tags.map((t) => `<span class="minitag">#${esc(t)}</span>`).join('')}</span>` : ''}
      </footer>
    </blockquote>
  </div>`;
}

function noteCard(n, i) {
  return `
  <div class="swipe-wrap" style="animation-delay:${Math.min(i * 35, 350)}ms">
    <div class="swipe-bg" aria-hidden="true">Supprimer</div>
    <article class="card note-card swipeable" data-kind="note" data-id="${n.id}" tabindex="0" aria-label="Note — toucher pour modifier">
      <p>${esc(n.text)}</p>
      <footer class="entry-foot"><span>${fmtDate(n.createdAt)}</span></footer>
    </article>
  </div>`;
}

/* ═══════════ ÉCRAN CITATIONS ═══════════ */

function renderQuotesView() {
  // Filtre par livre (levé si le livre filtré a été supprimé)
  const sel = $('#quotes-book-filter');
  const bookIds = [...new Set(state.quotes.map((q) => q.bookId))];
  if (state.quotesBook && !bookIds.includes(state.quotesBook)) state.quotesBook = '';
  const options = bookIds.map(bookById).filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title, 'fr'))
    .map((b) => `<option value="${b.id}" ${state.quotesBook === b.id ? 'selected' : ''}>${esc(b.title)}</option>`);
  sel.innerHTML = `<option value="">Tous les livres</option>` + options.join('');

  // Filtres : livre, recherche plein texte, puis tag
  let quotes = state.quotes.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (state.quotesBook) quotes = quotes.filter((q) => q.bookId === state.quotesBook);

  const qq = state.quotesQuery.trim().toLowerCase();
  if (qq) {
    quotes = quotes.filter((q) => {
      const book = bookById(q.bookId);
      return q.text.toLowerCase().includes(qq)
        || (q.tags || []).some((t) => t.includes(qq))
        || (book && (book.title + ' ' + (book.show || '')).toLowerCase().includes(qq));
    });
  }

  const tags = [...new Set(quotes.flatMap((q) => q.tags || []))].sort();
  // Un tag actif qui n'existe plus dans la sélection courante est levé,
  // sinon il filtrerait tout en silence (les puces étant cachées).
  if (state.quotesTag && !tags.includes(state.quotesTag)) state.quotesTag = null;
  const chipsEl = $('#quotes-tags');
  chipsEl.hidden = tags.length === 0;
  chipsEl.innerHTML = tags.map((t) =>
    `<button class="chip ${state.quotesTag === t ? 'active' : ''}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('');

  if (state.quotesTag) quotes = quotes.filter((q) => (q.tags || []).includes(state.quotesTag));

  $('#quotes-list').innerHTML = quotes.length
    ? quotes.map((q, i) => quoteCard(q, i)).join('') + LIST_HINT
    : `<div class="empty">
        <span class="glyph">”</span>
        <h3>Aucune citation</h3>
        <p>${state.books.length
          ? 'Touchez « Citation » pour en ajouter une : tapez, dictez ou scannez le passage.'
          : 'Ajoutez d’abord un livre dans la Bibliothèque.'}</p>
      </div>`;
}

/* ═══════════ ÉCRAN FICHE LIVRE ═══════════ */

function renderBook() {
  const book = bookById(state.currentBookId);
  if (!book) { navigate('#/library'); return; }

  const pod = book.type === 'podcast';
  const p = pct(book);
  const dates = [];
  if (book.startDate) dates.push('début : ' + fmtDate(book.startDate));
  if (book.endDate) dates.push('fin : ' + fmtDate(book.endDate));

  const sub = subtitleOf(book);
  let progressHTML = '';
  if (book.totalPages) {
    progressHTML = `
    <div class="card progress-card">
      <div class="head"><b>Progression</b><span>${pod ? `${book.currentPage || 0} / ${book.totalPages} min` : `p. ${book.currentPage || 0} / ${book.totalPages}`} · ${p}%</span></div>
      <div class="progress"><i style="width:${p}%"></i></div>
      <div class="stepper">
        <button id="pg-minus" aria-label="${pod ? 'Reculer d’une minute' : 'Reculer d’une page'}">−</button>
        <input id="pg-input" type="number" min="0" max="${book.totalPages}" inputmode="numeric" value="${book.currentPage || 0}" aria-label="${pod ? 'Minute actuelle' : 'Page actuelle'}">
        <button id="pg-plus" aria-label="${pod ? 'Avancer d’une minute' : 'Avancer d’une page'}">+</button>
        <button id="pg-plus10" aria-label="${pod ? 'Avancer de dix minutes' : 'Avancer de dix pages'}">+10</button>
      </div>
    </div>`;
  } else if (book.status !== 'done') {
    // Réglage express du nombre de pages, sans passer par « Modifier ».
    progressHTML = `
    <div class="card progress-card setup-card">
      <div class="head"><b>Progression</b></div>
      <p>${pod ? 'Indiquez la durée de l’épisode' : 'Indiquez le nombre de pages'} pour suivre votre avancée.</p>
      <form class="inline-form" id="pg-setup">
        <input id="pg-total" type="number" min="1" inputmode="numeric" enterkeyhint="done" placeholder="${pod ? 'Durée en minutes' : 'Nombre de pages'}" aria-label="${pod ? 'Durée en minutes' : 'Nombre de pages'}">
        <button type="submit">OK</button>
      </form>
    </div>`;
  }

  const heroCover = validCover(book.cover) ? `
      <div class="hero-cover">
        ${coverHTML(book, ' big')}
        ${book.coverSource === 'googlebooks' && book.googleBooksId
    ? `<a class="gb-link" href="${esc(googleBooksPage(book.googleBooksId))}" target="_blank" rel="noopener">Google Books</a>` : ''}
      </div>` : '';
  $('#book-content').innerHTML = `
    <div class="book-hero${heroCover ? ' with-cover' : ''}">
      ${heroCover}
      <p class="kicker">${TYPE_LABELS[book.type] || 'Livre'}${book.createdAt ? ' · ajouté le ' + fmtDate(book.createdAt) : ''}</p>
      <h2>${esc(book.title)}</h2>
      ${sub ? `<p class="author">${esc(sub)}</p>` : ''}
      <div class="meta">
        <span class="pill status-${book.status}">${STATUS_LABELS[book.status]}</span>
        ${dates.map((d) => `<span class="pill">${esc(d)}</span>`).join('')}
        ${(book.tags || []).map((t) => `<span class="pill">#${esc(t)}</span>`).join('')}
      </div>
      ${book.status === 'done' && book.rating ? `<span class="rating-big">${stars(book.rating)}</span>` : ''}
    </div>
    ${progressHTML}`;

  // Onglets (avec compteurs)
  const notes = notesOf(book.id);
  const quotes = quotesOf(book.id);
  const words = wordsOf(book.id);
  $('#count-quotes').textContent = quotes.length || '';
  $('#count-notes').textContent = notes.length || '';
  $('#count-words').textContent = words.length || '';
  $$('#book-tabs .seg-btn').forEach((b) => {
    const on = b.dataset.tab === state.bookTab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });

  const contentEl = $('#book-tab-content');
  if (state.bookTab === 'notes') {
    contentEl.innerHTML = notes.length
      ? notes.map(noteCard).join('') + LIST_HINT
      : `<div class="empty"><h3>Aucune note</h3><p>Touchez « Note » en bas pour noter vos réflexions au fil de la lecture.</p></div>`;
  } else if (state.bookTab === 'words') {
    contentEl.innerHTML = words.length
      ? words.map((w, i) => wordCard(w, i, false)).join('') + LIST_HINT
      : `<div class="empty"><h3>Aucun mot</h3><p>Touchez « Mot » en bas pour noter un mot ou une expression inconnus : la définition s’affiche toute seule.</p></div>`;
  } else {
    contentEl.innerHTML = quotes.length
      ? quotes.map((q, i) => quoteCard(q, i, false)).join('') + LIST_HINT
      : `<div class="empty"><h3>Aucune citation</h3><p>Touchez « Citation » en bas : tapez, dictez ou scannez le passage.</p></div>`;
  }

  bindProgressStepper(book);
  bindProgressSetup(book);
}

function bindProgressStepper(book) {
  const input = $('#pg-input');
  if (!input) return;
  const apply = async (value) => {
    const v = Math.max(0, Math.min(book.totalPages, Number(value) || 0));
    book.currentPage = v;
    book.updatedAt = new Date().toISOString();
    if (v > 0 && book.status === 'toread') {
      book.status = 'reading';
      if (!book.startDate) book.startDate = todayISO();
    }
    if (v >= book.totalPages && book.status !== 'done'
        && confirm(book.type === 'podcast'
          ? 'Épisode écouté en entier. Marquer comme terminé ?'
          : 'Vous avez atteint la dernière page. Marquer comme terminé ?')) {
      book.status = 'done';
      if (!book.endDate) book.endDate = todayISO();
    }
    await db.put('books', book);
    render();
  };
  $('#pg-minus').addEventListener('click', () => apply((book.currentPage || 0) - 1));
  $('#pg-plus').addEventListener('click', () => apply((book.currentPage || 0) + 1));
  $('#pg-plus10').addEventListener('click', () => apply((book.currentPage || 0) + 10));
  input.addEventListener('change', () => apply(input.value));
}

function bindProgressSetup(book) {
  const form = $('#pg-setup');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#pg-total');
    const total = parseInt(input.value, 10);
    if (!(total > 0)) { flagField(input); return; }
    input.blur();
    book.totalPages = total;
    book.currentPage = Math.min(book.currentPage || 0, total);
    book.updatedAt = new Date().toISOString();
    await db.put('books', book);
    render();
  });
}

/* ═══════════ ÉCRAN STATISTIQUES ═══════════ */

function renderStats() {
  const counts = { toread: 0, reading: 0, done: 0 };
  for (const b of state.books) counts[b.status] = (counts[b.status] || 0) + 1;

  const pagesRead = state.books.reduce((sum, b) => {
    if (b.type === 'podcast') return sum;
    if (b.status === 'done') return sum + (b.totalPages || 0);
    if (b.status === 'reading') return sum + (b.currentPage || 0);
    return sum;
  }, 0);

  const minutesHeard = state.books.reduce((sum, b) => {
    if (b.type !== 'podcast') return sum;
    if (b.status === 'done') return sum + (b.totalPages || 0);
    if (b.status === 'reading') return sum + (b.currentPage || 0);
    return sum;
  }, 0);

  const rated = state.books.filter((b) => b.status === 'done' && b.rating);
  const avg = rated.length ? (rated.reduce((s, b) => s + b.rating, 0) / rated.length).toFixed(1) : null;

  const byYear = {};
  for (const b of state.books) {
    if (b.status === 'done' && b.endDate) {
      const y = b.endDate.slice(0, 4);
      byYear[y] = (byYear[y] || 0) + 1;
    }
  }
  const years = Object.keys(byYear).sort().reverse();
  const maxYear = Math.max(1, ...Object.values(byYear));

  $('#stats-content').innerHTML = `
    <div class="stat-grid">
      <div class="card stat-card"><b>${counts.reading}</b><span>En cours</span></div>
      <div class="card stat-card"><b>${counts.toread}</b><span>À lire</span></div>
      <div class="card stat-card"><b>${counts.done}</b><span>Terminés</span></div>
    </div>
    <div class="card stat-wide">
      <div class="kpis">
        <div><b>${pagesRead.toLocaleString('fr-FR')}</b><span>pages lues</span></div>
        ${minutesHeard ? `<div><b>${minutesHeard.toLocaleString('fr-FR')}</b><span>min écoutées</span></div>` : ''}
        <div><b>${state.quotes.length}</b><span>citations</span></div>
        <div><b>${state.notes.length}</b><span>notes</span></div>
        <div><b>${state.words.length}</b><span>mots</span></div>
        <div><b>${avg ? avg + ' ★' : '—'}</b><span>note moyenne</span></div>
      </div>
    </div>
    ${years.length ? `
    <div class="card stat-wide">
      <h3>Terminés par année</h3>
      ${years.map((y) => `
        <div class="year-row">
          <span class="yr">${y}</span>
          <div class="bar"><i style="width:${(byYear[y] / maxYear) * 100}%"></i></div>
          <span class="n">${byYear[y]}</span>
        </div>`).join('')}
    </div>` : ''}`;
}

/* ═══════════ FEUILLES MODALES ═══════════
   En-tête collant « Annuler / titre / Enregistrer », fermeture en glissant
   vers le bas, et feuille toujours posée au-dessus du clavier iOS. */

let openedSheet = null;
let backdropTimer = null;

const sheetKind = (sheet) => (sheet.id === 'sheet-quote' ? 'quote' : (sheet.id === 'sheet-note' ? 'note' : null));

function openSheet(id) {
  const sheet = $(id);
  const backdrop = $('#backdrop');
  if (openedSheet && openedSheet !== sheet) closeSheet({ keepBackdrop: true });
  hideToast(); // un ancien message ne doit pas masquer le formulaire
  clearTimeout(sheet.hideTimer);
  clearTimeout(backdropTimer);
  openedSheet = sheet;
  sheet.hidden = false;
  backdrop.hidden = false;
  sheet.scrollTop = 0;
  sheet.style.transform = '';
  void sheet.offsetHeight; // applique la position de départ avant l'animation
  sheet.classList.add('open');
  backdrop.classList.add('open');
  document.documentElement.classList.add('sheet-open');
}

function closeSheet({ discard = false, keepBackdrop = false } = {}) {
  const sheet = openedSheet;
  if (!sheet) return;
  openedSheet = null;
  stopDictation();
  const kind = sheetKind(sheet);
  if (kind) {
    if (discard) dropDraft(kind);
    else { saveDraft(kind); draftBase[kind] = null; }
  }
  if (sheet.id === 'sheet-quote') closeOcrPanel();
  if (sheet.id === 'sheet-word') { clearTimeout(wl.timer); wl.run++; hideWordSuggest(); }
  if (sheet.id === 'sheet-book') hideBookSuggest();
  if (sheet.contains(document.activeElement)) document.activeElement.blur();

  sheet.classList.remove('open', 'dragging');
  sheet.style.transform = '';
  sheet.hideTimer = setTimeout(() => { sheet.hidden = true; }, 400);

  if (!keepBackdrop) {
    const backdrop = $('#backdrop');
    backdrop.style.opacity = '';
    backdrop.classList.remove('open');
    backdropTimer = setTimeout(() => { if (!openedSheet) backdrop.hidden = true; }, 400);
    document.documentElement.classList.remove('sheet-open');
    // Une mise à jour arrivée pendant la saisie s'applique maintenant.
    setTimeout(applyPendingUpdate, 2500);
  }
}

/* Glisser la feuille vers le bas pour la fermer : depuis l'en-tête, ou
   depuis le contenu quand il est tout en haut (hors champs de saisie). */
function bindSheetDrag(sheet) {
  const backdrop = $('#backdrop');
  let g = null;
  sheet.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || openedSheet !== sheet) { g = null; return; }
    const t = e.target;
    const fromHead = Boolean(t.closest('.sheet-head'));
    if (!fromHead && (sheet.scrollTop > 0 || t.closest('input, textarea, select, .ocr-lines'))) { g = null; return; }
    g = { y0: e.touches[0].clientY, x0: e.touches[0].clientX, t0: Date.now(), dy: 0, fromHead, dragging: false, decided: false };
  }, { passive: true });

  sheet.addEventListener('touchmove', (e) => {
    if (!g) return;
    const dy = e.touches[0].clientY - g.y0;
    const dx = e.touches[0].clientX - g.x0;
    if (!g.decided) {
      if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
      g.decided = true;
      g.dragging = dy > 0 && Math.abs(dy) > Math.abs(dx) && (g.fromHead || sheet.scrollTop <= 0);
      if (!g.dragging) { g = null; return; }
      sheet.classList.add('dragging');
    }
    e.preventDefault();
    g.dy = Math.max(0, dy);
    sheet.style.transform = `translateY(${g.dy}px)`;
    backdrop.style.opacity = String(Math.max(0.15, 1 - g.dy / Math.max(1, sheet.offsetHeight)));
  }, { passive: false });

  const end = () => {
    if (!g) return;
    const { dragging, dy, t0 } = g;
    g = null;
    if (!dragging) return;
    sheet.classList.remove('dragging');
    backdrop.style.opacity = '';
    const speed = dy / Math.max(1, Date.now() - t0);
    if (dy > 110 || (dy > 40 && speed > 0.5)) closeSheet();
    else sheet.style.transform = '';
  };
  sheet.addEventListener('touchend', end);
  sheet.addEventListener('touchcancel', end);
}

/* Le clavier iOS ne redimensionne pas la page : on suit la zone visible
   pour garder la feuille (et son bouton Enregistrer) au-dessus du clavier. */
function syncViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const kb = Math.round(window.innerHeight - vv.height - vv.offsetTop);
  const st = document.documentElement.style;
  st.setProperty('--kb', (kb > 60 ? kb : 0) + 'px');
  st.setProperty('--vvh', Math.round(vv.height) + 'px');
}

function setSegmented(containerId, value) {
  $$(`#${containerId} .seg-btn`).forEach((b) => b.classList.toggle('active', b.dataset.value === value));
}

/* ——— Suggestions de tags : un toucher ajoute ou retire le tag ——— */
function tagPool(items) {
  const counts = new Map();
  for (const it of items) for (const t of it.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))
    .map(([t]) => t);
}

function renderTagSuggest(input, box, pool) {
  const current = parseTags(input.value);
  const shown = pool.slice(0, 12);
  for (const t of current) if (pool.includes(t) && !shown.includes(t)) shown.push(t);
  box.hidden = shown.length === 0;
  box.innerHTML = shown.map((t) =>
    `<button type="button" class="chip ${current.includes(t) ? 'active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('');
}

function bindTagSuggest(input, box, poolFn) {
  input.addEventListener('input', () => renderTagSuggest(input, box, poolFn()));
  box.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const tags = parseTags(input.value);
    const t = chip.dataset.tag;
    input.value = (tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]).join(', ');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const bookTagPool = () => tagPool(state.books);
const quoteTagPool = () => tagPool(state.quotes);

/* ——— Livre ——— */
function syncRatingUI() {
  $('#rating-field').hidden = state.form.status !== 'done';
  $$('#rating-stars button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) <= state.form.rating));
}

function setBookDetails(open) {
  $('#book-more').hidden = !open;
  $('#book-more-btn').setAttribute('aria-expanded', String(open));
  $('#book-more-btn span').textContent = open ? 'Moins de détails' : 'Plus de détails';
}

function openBookForm(book = null) {
  const form = $('#form-book');
  form.reset();
  state.editing.bookId = book ? book.id : null;
  state.form.type = book ? book.type : 'book';
  state.form.status = book ? book.status : 'toread';
  state.form.rating = book ? (book.rating || 0) : 0;

  form.title.value = book ? book.title : '';
  form.author.value = book ? (book.author || '') : '';
  form.show.value = book ? (book.show || '') : '';
  form.currentPage.value = book && book.currentPage != null ? book.currentPage : '';
  form.totalPages.value = book && book.totalPages ? book.totalPages : '';
  form.startDate.value = book ? (book.startDate || '') : '';
  form.endDate.value = book ? (book.endDate || '') : '';
  form.tags.value = book ? (book.tags || []).join(', ') : '';
  state.form.cover = book && validCover(book.cover)
    ? { url: book.cover, source: book.coverSource || '', gbId: book.googleBooksId || '' }
    : null;
  hideBookSuggest();
  renderCoverField();
  warmBooksSearch();
  $('#btn-delete-book').hidden = !book;

  // Formulaire court par défaut ; détails dépliés s'ils sont déjà remplis.
  const hasDetails = Boolean(book && (book.totalPages || book.currentPage || book.startDate
    || book.endDate || (book.tags || []).length));
  setBookDetails(hasDetails);
  renderTagSuggest(form.tags, $('#book-tag-suggest'), bookTagPool());

  setSegmented('field-type', state.form.type);
  setSegmented('field-status', state.form.status);
  syncRatingUI();
  syncTypeUI();
  openSheet('#sheet-book');
}

/* Adapte le formulaire au type : champ Émission et unités pour un podcast. */
function syncTypeUI() {
  const t = state.form.type;
  const pod = t === 'podcast';
  $('#field-show').hidden = !pod;
  $('#label-title').textContent = pod ? 'Titre de l’épisode *' : 'Titre *';
  $('#label-current').textContent = pod ? 'Minute actuelle' : 'Page actuelle';
  $('#label-total').textContent = pod ? 'Durée (min)' : 'Pages total';
  $('#label-start').textContent = pod ? 'Début d’écoute' : 'Début de lecture';
  $('#label-end').textContent = pod ? 'Fin d’écoute' : 'Fin de lecture';
  if (!state.editing.bookId) {
    $('#sheet-book-title').textContent = pod ? 'Nouveau podcast' : (t === 'article' ? 'Nouvel article' : 'Nouveau livre');
  } else {
    $('#sheet-book-title').textContent = 'Modifier';
  }
}

async function saveBookForm(e) {
  e.preventDefault();
  const form = $('#form-book');
  const title = form.title.value.trim();
  if (!title) { flagField(form.title); toast('Le titre est obligatoire'); return; }

  const now = new Date().toISOString();
  const existing = state.editing.bookId ? bookById(state.editing.bookId) : null;
  const book = existing || { id: uid(), createdAt: now };

  book.type = state.form.type;
  book.title = title;
  book.author = form.author.value.trim();
  book.show = state.form.type === 'podcast' ? form.show.value.trim() : '';
  book.status = state.form.status;
  book.totalPages = Math.max(0, parseInt(form.totalPages.value, 10) || 0) || null;
  book.currentPage = Math.max(0, parseInt(form.currentPage.value, 10) || 0);
  if (book.totalPages) book.currentPage = Math.min(book.currentPage, book.totalPages);
  book.startDate = form.startDate.value || null;
  book.endDate = form.endDate.value || null;
  book.tags = parseTags(form.tags.value);
  book.rating = state.form.status === 'done' ? state.form.rating : 0;
  const cover = state.form.cover;
  book.cover = cover ? cover.url : null;
  book.coverSource = cover ? (cover.source || null) : null;
  book.googleBooksId = cover && cover.source === 'googlebooks' ? (cover.gbId || null) : null;
  book.updatedAt = now;

  // Automatismes de statut
  if (book.status === 'reading' && !book.startDate) book.startDate = todayISO();
  if (book.status === 'done') {
    if (!book.endDate) book.endDate = todayISO();
    if (book.totalPages) book.currentPage = book.totalPages;
  }

  // En mémoire d'abord : l'écho de la synchronisation trouve alors le livre.
  if (!existing) state.books.push(book);
  await db.put('books', book);
  closeSheet();
  toast(existing ? 'Modifications enregistrées' : 'Ajouté à la bibliothèque');
  render();
}

/* ——— Couverture dans le formulaire ———
   Suggestions de Google Books pendant la frappe du titre (livres seulement,
   en ligne, si la clé est dans config/googlebooks), ou photo de la
   couverture. La vignette du formulaire montre le rendu dans la liste. */
const bs = { timer: null, run: 0, items: [], error: '', ctrl: null, cache: new Map(), warmed: false };

/* Connexions à Google Books ouvertes dès l'ouverture du formulaire : la
   première recherche n'attend pas la poignée de main réseau. */
function warmBooksSearch() {
  if (bs.warmed || !booksSearchReady()) return;
  bs.warmed = true;
  for (const [href, cors] of [['https://www.googleapis.com', true], ['https://books.google.com', false]]) {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = href;
    if (cors) link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }
}

function renderCoverField() {
  const form = $('#form-book');
  const cover = state.form.cover;
  const preview = {
    type: state.form.type,
    title: form.title.value.trim() || '?',
    show: form.show.value.trim(),
    cover: cover ? cover.url : null
  };
  $('#cover-preview').innerHTML = coverHTML(preview);
  $('#cover-remove').hidden = !cover;
  $('#cover-photo').textContent = cover ? 'Autre photo' : 'Prendre en photo';
  $('#cover-hint').textContent = cover
    ? (cover.source === 'googlebooks' ? 'Couverture Google Books' : 'Votre photo')
    : (booksSearchReady() && state.form.type === 'book' ? 'ou choisissez un livre proposé en tapant le titre' : '');
}

function hideBookSuggest() {
  clearTimeout(bs.timer);
  if (bs.ctrl) { bs.ctrl.abort(); bs.ctrl = null; }
  bs.run++;
  bs.items = [];
  bs.error = '';
  const box = $('#book-suggest');
  box.hidden = true;
  box.innerHTML = '';
}

function renderBookSuggest() {
  const box = $('#book-suggest');
  if (bs.error) {
    box.innerHTML = `<p class="gb-attrib">${esc(bs.error)}</p>`;
    box.hidden = false;
    return;
  }
  if (!bs.items.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.innerHTML = bs.items.map((b, i) => `
    <button type="button" class="gb-item" role="option" data-i="${i}">
      ${b.cover ? `<img src="${esc(b.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="gb-noimg" aria-hidden="true"></span>'}
      <span class="gb-info"><b>${esc(b.title)}</b><small>${esc([b.authors, b.year, b.pages ? b.pages + ' p.' : ''].filter(Boolean).join(' · '))}</small></span>
    </button>`).join('')
    + '<p class="gb-attrib">Livres proposés par Google Books</p>';
  box.hidden = false;
}

function scheduleBookSuggest() {
  clearTimeout(bs.timer);
  const term = $('#form-book').title.value.trim();
  if (state.form.type !== 'book' || term.length < 3 || !navigator.onLine || !booksSearchReady()) {
    hideBookSuggest();
    return;
  }
  const key = term.toLowerCase();
  if (bs.cache.has(key)) {
    // Déjà cherché (retour arrière) : réponse immédiate.
    bs.run++;
    bs.items = bs.cache.get(key);
    bs.error = '';
    renderBookSuggest();
    return;
  }
  bs.timer = setTimeout(async () => {
    const run = ++bs.run;
    if (bs.ctrl) bs.ctrl.abort();
    const ctrl = new AbortController();
    bs.ctrl = ctrl;
    try {
      const items = await searchBooks(term, ctrl.signal);
      if (run !== bs.run) return;
      bs.cache.set(key, items);
      if (bs.cache.size > 40) bs.cache.delete(bs.cache.keys().next().value);
      bs.items = items;
      bs.error = '';
    } catch (err) {
      if (run !== bs.run || err.name === 'AbortError') return;
      bs.items = [];
      // Clé refusée ou quota atteint : on le dit (utile au réglage de la clé).
      bs.error = err.status === 400 || err.status === 403
        ? 'Recherche Google Books indisponible : clé refusée ou quota atteint.'
        : '';
    }
    renderBookSuggest();
  }, 250);
}

function pickBookSuggestion(i) {
  const b = bs.items[i];
  if (!b) return;
  const form = $('#form-book');
  form.title.value = b.title;
  if (b.authors) form.author.value = b.authors;
  if (b.pages && !form.totalPages.value) form.totalPages.value = b.pages;
  if (b.cover) state.form.cover = { url: b.cover, source: 'googlebooks', gbId: b.id };
  hideBookSuggest();
  renderCoverField();
}

async function takeCoverPhoto(file) {
  $('#cover-hint').textContent = 'Préparation de la photo…';
  const url = await photoThumbnail(file);
  if (!url) {
    toast('Impossible d’utiliser cette photo — essayez-en une autre.');
    renderCoverField();
    return;
  }
  state.form.cover = { url, source: 'photo', gbId: '' };
  renderCoverField();
}

/* Suppression immédiate, rattrapable avec « Annuler » dans le toast. */
async function deleteCurrentBook() {
  const book = bookById(state.editing.bookId);
  if (!book) return;
  const notes = notesOf(book.id);
  const quotes = quotesOf(book.id);
  // Le vocabulaire survit au livre : ses mots passent « sans livre ».
  const words = wordsOf(book.id);
  for (const w of words) w.bookId = null;
  // Un seul lot : le livre, ses notes et citations partent, ses mots restent.
  db.commit([
    ...words.map((w) => ({ type: 'set', store: 'words', id: w.id, data: w })),
    { type: 'delete', store: 'books', id: book.id },
    ...notes.map((n) => ({ type: 'delete', store: 'notes', id: n.id })),
    ...quotes.map((q) => ({ type: 'delete', store: 'quotes', id: q.id }))
  ]);
  state.books = state.books.filter((b) => b.id !== book.id);
  state.notes = state.notes.filter((n) => n.bookId !== book.id);
  state.quotes = state.quotes.filter((q) => q.bookId !== book.id);
  closeSheet();
  if (state.route === 'book') navigate('#/library');
  render();
  toast(`${TYPE_LABELS[book.type] || 'Livre'} supprimé${words.length ? ' · mots conservés' : ''}`, {
    label: 'Annuler',
    run: async () => {
      for (const w of words) w.bookId = book.id;
      await db.putMany({ books: [book], notes, quotes, words });
      if (!bookById(book.id)) state.books.push(book);
      state.notes.push(...notes.filter((n) => !state.notes.some((x) => x.id === n.id)));
      state.quotes.push(...quotes.filter((q) => !state.quotes.some((x) => x.id === q.id)));
      render();
      toast('Restauré');
    }
  });
}

/* ═══════════ BROUILLONS ═══════════
   Le texte d'une note ou d'une citation non enregistrée est gardé
   (localStorage) : une fermeture par erreur, un rechargement ou iOS qui
   ferme l'app ne font rien perdre. « Annuler » l'efface volontairement. */

const DRAFT_PREFIX = 'lecture-brouillon:';
const draftBase = { note: null, quote: null }; // valeurs à l'ouverture
let draftTimer = null;

function draftKey(kind) {
  const e = state.editing;
  const id = kind === 'quote' ? e.quoteId : e.noteId;
  const bookId = kind === 'quote' ? e.quoteBookId : e.noteBookId;
  return DRAFT_PREFIX + kind + ':' + (id || 'nouveau:' + bookId);
}

function readEntryForm(kind) {
  const f = kind === 'quote' ? $('#form-quote') : $('#form-note');
  return kind === 'quote'
    ? { text: f.text.value, page: f.page.value, tags: f.tags.value }
    : { text: f.text.value };
}

function writeEntryForm(kind, v) {
  const f = kind === 'quote' ? $('#form-quote') : $('#form-note');
  f.text.value = v.text || '';
  if (kind === 'quote') {
    f.page.value = v.page ?? '';
    f.tags.value = v.tags ?? '';
    renderTagSuggest(f.tags, $('#quote-tag-suggest'), quoteTagPool());
  }
}

function saveDraft(kind) {
  clearTimeout(draftTimer);
  const base = draftBase[kind];
  if (!base) return;
  const cur = readEntryForm(kind);
  const dirty = Object.keys(cur).some((k) => cur[k] !== base[k]);
  try {
    if (dirty && cur.text.trim()) localStorage.setItem(draftKey(kind), JSON.stringify(cur));
    else localStorage.removeItem(draftKey(kind));
  } catch { /* stockage plein ou bloqué : tant pis pour le brouillon */ }
}

function scheduleDraftSave(kind) {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => saveDraft(kind), 400);
}

/* À l'ouverture : remet le brouillon s'il y en a un, avec un bandeau. */
function restoreDraft(kind) {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(draftKey(kind)) || 'null'); } catch { d = null; }
  const has = Boolean(d && typeof d.text === 'string' && d.text.trim() && d.text !== draftBase[kind].text);
  if (has) writeEntryForm(kind, { ...draftBase[kind], ...d });
  $(`#${kind}-draft`).hidden = !has;
}

function dropDraft(kind) {
  clearTimeout(draftTimer);
  try { localStorage.removeItem(draftKey(kind)); } catch { /* rien à faire */ }
  draftBase[kind] = null;
}

function forgetDraftOf(kind, id) {
  try { localStorage.removeItem(DRAFT_PREFIX + kind + ':' + id); } catch { /* rien à faire */ }
}

/* ——— Notes ——— */
function openNoteForm(note = null, bookId = null) {
  const bid = note ? note.bookId : (bookId || state.currentBookId);
  const book = bookById(bid);
  if (!book) return;
  const form = $('#form-note');
  form.reset();
  state.editing.noteId = note ? note.id : null;
  state.editing.noteBookId = bid;
  $('#sheet-note-title').textContent = note ? 'Modifier la note' : 'Nouvelle note';
  $('#sheet-note-book').textContent = bookLabel(book);
  draftBase.note = { text: note ? note.text : '' };
  writeEntryForm('note', draftBase.note);
  restoreDraft('note');
  $('#btn-delete-note').hidden = !note;
  openSheet('#sheet-note');
}

async function saveNoteForm(e) {
  e.preventDefault();
  const form = $('#form-note');
  const text = form.text.value.trim();
  if (!text) { flagField(form.text); toast('La note est vide'); return; }
  const book = bookById(state.editing.noteBookId);
  if (!book) { closeSheet(); return; }
  const now = new Date().toISOString();
  let note = state.editing.noteId ? state.notes.find((n) => n.id === state.editing.noteId) : null;
  if (note) {
    note.text = text;
    note.updatedAt = now;
  } else {
    note = { id: uid(), bookId: book.id, text, createdAt: now, updatedAt: now };
    state.notes.push(note);
  }
  await db.put('notes', note);
  dropDraft('note');
  closeSheet();
  if (state.route === 'book' && state.currentBookId === book.id) state.bookTab = 'notes';
  toast('Note enregistrée');
  render();
}

async function deleteNote(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  await db.remove('notes', id);
  state.notes = state.notes.filter((n) => n.id !== id);
  forgetDraftOf('note', id);
  render();
  toast('Note supprimée', {
    label: 'Annuler',
    run: async () => {
      await db.put('notes', note);
      if (!state.notes.some((n) => n.id === note.id)) state.notes.push(note);
      render();
    }
  });
}

/* ——— Citations ——— */
function openQuoteForm(quote = null, bookId = null) {
  const bid = quote ? quote.bookId : (bookId || state.currentBookId);
  const book = bookById(bid);
  if (!book) return;
  const form = $('#form-quote');
  form.reset();
  closeOcrPanel();
  state.editing.quoteId = quote ? quote.id : null;
  state.editing.quoteBookId = bid;
  $('#quote-page-label').textContent = book.type === 'podcast' ? 'Minute' : 'Page';
  $('#sheet-quote-title').textContent = quote ? 'Modifier la citation' : 'Nouvelle citation';
  $('#sheet-quote-book').textContent = bookLabel(book);
  // Nouvelle citation : page pré-remplie avec la page où l'on en est.
  draftBase.quote = quote
    ? { text: quote.text, page: quote.page != null ? String(quote.page) : '', tags: (quote.tags || []).join(', ') }
    : { text: '', page: book.currentPage > 0 ? String(book.currentPage) : '', tags: '' };
  writeEntryForm('quote', draftBase.quote);
  restoreDraft('quote');
  $('#btn-delete-quote').hidden = !quote;
  $('#quote-to-word').hidden = !quote;
  openSheet('#sheet-quote');
}

async function saveQuoteForm(e) {
  e.preventDefault();
  const form = $('#form-quote');
  const text = form.text.value.trim();
  if (!text) { flagField(form.text); toast('Écrivez, dictez ou scannez la citation'); return; }
  const book = bookById(state.editing.quoteBookId);
  if (!book) { closeSheet(); return; }
  const now = new Date().toISOString();
  let quote = state.editing.quoteId ? state.quotes.find((q) => q.id === state.editing.quoteId) : null;
  const isNewQuote = !quote;
  if (quote) {
    quote.text = text;
    quote.updatedAt = now;
  } else {
    quote = { id: uid(), bookId: book.id, text, createdAt: now, updatedAt: now };
    state.quotes.push(quote);
  }
  quote.page = form.page.value === '' ? null : Math.max(0, parseInt(form.page.value, 10) || 0);
  quote.tags = parseTags(form.tags.value);
  await db.put('quotes', quote);

  const progressed = await advanceProgress(book, quote.page, now);

  dropDraft('quote');
  closeSheet();
  if (state.route === 'book' && state.currentBookId === book.id) state.bookTab = 'quotes';
  toast('Citation enregistrée' + progressNote(book, progressed),
    isNewQuote ? { label: 'Noter un mot', run: () => openWordFromQuote(quote) } : null);
  render();
}

async function deleteQuote(id) {
  const quote = state.quotes.find((q) => q.id === id);
  if (!quote) return;
  await db.remove('quotes', id);
  state.quotes = state.quotes.filter((q) => q.id !== id);
  forgetDraftOf('quote', id);
  render();
  toast('Citation supprimée', {
    label: 'Annuler',
    run: async () => {
      await db.put('quotes', quote);
      if (!state.quotes.some((q) => q.id === quote.id)) state.quotes.push(quote);
      render();
    }
  });
}

function deleteEntry(kind, id) {
  if (kind === 'word') return deleteWord(id);
  return kind === 'note' ? deleteNote(id) : deleteQuote(id);
}

function openEntry(kind, id) {
  if (kind === 'word') {
    const word = state.words.find((w) => w.id === id);
    if (word) openWordForm(word);
    return;
  }
  if (kind === 'note') {
    const note = state.notes.find((n) => n.id === id);
    if (note) openNoteForm(note);
  } else {
    const quote = state.quotes.find((q) => q.id === id);
    if (quote) openQuoteForm(quote);
  }
}

/* ——— Citation rapide : bouton + de l'onglet Citations ——— */
function quickQuote() {
  if (!state.books.length) { openBookForm(); toast('Ajoutez d’abord un livre'); return; }
  if (state.route === 'quotes' && state.quotesBook && bookById(state.quotesBook)) {
    openQuoteForm(null, state.quotesBook);
    return;
  }
  const reading = state.books.filter((b) => b.status === 'reading');
  if (reading.length === 1) { openQuoteForm(null, reading[0].id); return; }
  if (state.books.length === 1) { openQuoteForm(null, state.books[0].id); return; }
  openBookPicker();
}

function openBookPicker() {
  const reading = state.books.filter((b) => b.status === 'reading').sort(byRecent);
  const others = state.books.filter((b) => b.status !== 'reading').sort(byRecent);
  const row = (b) => {
    const sub = subtitleOf(b);
    return `<button type="button" class="pick-row" data-id="${b.id}">
      ${coverHTML(b)}
      <span class="pick-info"><b>${esc(b.title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
    </button>`;
  };
  $('#pick-list').innerHTML =
    (reading.length ? `<h3 class="section-title">En cours</h3>` + reading.map(row).join('') : '')
    + (others.length ? `<h3 class="section-title">${reading.length ? 'Autres' : 'Tous les titres'}</h3>` + others.map(row).join('') : '');
  openSheet('#sheet-pick');
}

/* ——— Glisser une carte vers la gauche pour la supprimer ——— */
let swipeEndedAt = 0;
const swipeThreshold = (card) => Math.min(130, card.offsetWidth * 0.35);

function bindSwipeToDelete(container) {
  let s = null;
  const settle = (card) => {
    card.classList.remove('swiping');
    card.style.transform = '';
    card.parentElement.classList.remove('revealing', 'armed');
  };
  container.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !e.isPrimary) return;
    const card = e.target.closest('.swipeable');
    if (!card || e.target.closest('button, a')) return;
    s = { card, id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, swiping: false };
  });
  container.addEventListener('pointermove', (e) => {
    if (!s || e.pointerId !== s.id) return;
    const mx = e.clientX - s.x0;
    const my = e.clientY - s.y0;
    if (!s.swiping) {
      if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
      if (mx >= 0 || Math.abs(mx) < Math.abs(my) * 1.3) { s = null; return; } // défilement
      s.swiping = true;
      s.card.classList.add('swiping');
      s.card.parentElement.classList.add('revealing');
      try { s.card.setPointerCapture(s.id); } catch { /* déjà capturé */ }
    }
    s.dx = Math.min(0, mx);
    s.card.style.transform = `translateX(${s.dx}px)`;
    s.card.parentElement.classList.toggle('armed', -s.dx > swipeThreshold(s.card));
  });
  const finish = (e, cancelled) => {
    if (!s || e.pointerId !== s.id) return;
    const { card, swiping, dx } = s;
    s = null;
    if (!swiping) return;
    swipeEndedAt = Date.now();
    if (!cancelled && -dx > swipeThreshold(card)) {
      card.classList.remove('swiping');
      card.style.transform = 'translateX(-110%)';
      card.style.opacity = '0';
      setTimeout(() => deleteEntry(card.dataset.kind, card.dataset.id), 200);
    } else {
      settle(card);
    }
  };
  container.addEventListener('pointerup', (e) => finish(e, false));
  container.addEventListener('pointercancel', (e) => finish(e, true));
}

/* ═══════════ MOTS (vocabulaire) ═══════════
   Mots et expressions inconnus, notés comme des citations. La définition
   vient du Wiktionnaire, le seul grand dictionnaire français qu'une app a
   le droit d'interroger (CNRTL, Larousse et Le Robert le bloquent) ; elle
   est enregistrée avec le mot, donc lisible hors ligne. Un bouton ouvre le
   mot sur le CNRTL, et « Coller » reprend la définition copiée là-bas. */

const cnrtlURL = (word) => 'https://www.cnrtl.fr/definition/' + encodeURIComponent(word.trim());
// Larousse et Le Robert : définitions collées avec une version précédente.
const SOURCE_LABELS = { wiktionnaire: 'Wiktionnaire', perso: 'votre définition', cnrtl: 'CNRTL', larousse: 'Larousse', robert: 'Le Robert' };
const WORDS_SORT_KEY = 'lecture-tri-mots';

/* ——— Définitions du Wiktionnaire ——— */
const WIKT_API = 'https://fr.wiktionary.org/w/api.php';
const wiktURL = (title) => 'https://fr.wiktionary.org/wiki/' + encodeURIComponent(String(title).trim().replace(/ /g, '_'));
const POS_LABELS = {
  nom: 'nom commun', adj: 'adjectif', adv: 'adverbe', verb: 'verbe', 'nom-pr': 'nom propre',
  'loc-phr': 'locution-phrase', prép: 'préposition', conj: 'conjonction', interj: 'interjection'
};
// Modèles sans contenu utile dans une définition (renvois, marques d'ébauche…)
const WIKT_DROP = new Set(['ébauche-déf', 'ébauche', 'réf', 'réf ?', 'ref', 'référence nécessaire', 'source',
  'm', 'f', 'mf', 'n', 'pron', 'phon', 'conj', 'invar', 'sp', 'p', 's', 'i', 't', 'prnl', 'réfl', 'note']);
const WIKT_SUP = { e: 'ᵉ', er: 'ᵉʳ', re: 'ʳᵉ', ère: 'ʳᵉ', ème: 'ᵉ' };

const capFirst = (s) => (s ? s.charAt(0).toLocaleUpperCase('fr') + s.slice(1) : s);

function decodeEntities(s) {
  return s.replace(/&nbsp;|&#160;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

/* Rend un modèle {{…}} en texte : marques d'usage entre parenthèses
   (« (Figuré) », « (Médecine) »), liens, variantes ; le reste est ignoré. */
function renderWiktTemplate(inner) {
  const parts = inner.split('|').map((p) => p.trim());
  const name = parts[0].toLowerCase().replace(/_/g, ' ');
  const named = {};
  const args = [];
  for (const p of parts.slice(1)) {
    const m = p.match(/^([\w-]+)\s*=\s*([\s\S]*)$/);
    if (m) named[m[1]] = m[2]; else args.push(p);
  }
  const isLang = (a) => /^[a-z]{2,3}(-[a-z]+)?$/.test(a);
  if (WIKT_DROP.has(name)) return '';
  if (WIKT_SUP[name]) return WIKT_SUP[name];
  switch (name) {
    case 'term': case 'term lien':
      return args[0] ? `(${capFirst(args[0])})` : '';
    case 'lexique': case 'info lex': case 'domaine':
      return `(${args.filter((a) => !isLang(a)).map(capFirst).join(', ')})`;
    case 'w': case 'wp':
      return args[1] || args[0] || '';
    case 'lien': case 'l':
      return named.dif || args[0] || '';
    case 'nom w pc':
      return args.join(' ');
    case 'siècle':
      return args[0] ? `${args[0]}ᵉ siècle` : '';
    case 'variante de': case 'variante ortho de': case 'variante orthographique de':
      return `Variante${name.includes('ortho') ? ' orthographique' : ''} de ${args[0] || ''}`;
    case 'cf': case 'voir':
      return args.length ? '→ voir ' + args.filter((a) => !isLang(a)).join(', ') : '';
    default:
      // Marque d'usage : {{figuré|fr}}, {{familier|fr}}, {{médecine|fr}}…
      if (!args.length || args.every(isLang)) return `(${capFirst(name)})`;
      return args[0];
  }
}

function wikiToText(s) {
  const special = (target) => /^(catégorie|category|fichier|file|image|annexe):/i.test(target);
  let t = s.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  for (let i = 0; i < 12 && t.includes('{{'); i++) {
    const next = t.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => renderWiktTemplate(inner));
    if (next === t) break;
    t = next;
  }
  t = t.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, (_, target, label) => (special(target) ? '' : label))
    .replace(/\[\[([^\]]*)\]\]/g, (_, target) => (special(target) ? '' : target.replace(/^[a-z]{1,3}:/i, '').replace(/#.*$/, '')))
    .replace(/\[(?:https?:)?\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(t).replace(/\(\s*\)/g, '').replace(/\s+/g, ' ')
    .replace(/\s+([.,)])/g, '$1').replace(/\(\s+/g, '(').trim();
}

/* Extrait la section française d'une page : nature (nom, verbe…) et
   définitions. Les formes fléchies indiquent leur lemme (« sibyllin »). */
function parseWiktionary(wikitext) {
  const blocks = [];
  let inFr = false;
  let cur = null;
  for (const raw of String(wikitext || '').split('\n')) {
    const line = raw.trim();
    const lang = line.match(/^==\s*\{\{langue\|([^}|]+)/);
    if (lang) { inFr = lang[1].trim() === 'fr'; cur = null; continue; }
    if (!inFr) continue;
    const head = line.match(/^(={3,})\s*\{\{S\|([^|}]+)((?:\|[^}]*)?)\}\}/);
    if (head) {
      cur = null;
      if (head[1].length === 3 && /\|\s*fr\s*(\||$)/.test(head[3] || '')) {
        const key = head[2].trim().toLowerCase();
        cur = { pos: POS_LABELS[key] || key, flexion: /flexion/.test(head[3]), items: [], lemma: null };
        blocks.push(cur);
      }
      continue;
    }
    if (/^==/.test(line)) { cur = null; continue; }
    if (!cur) continue;
    const def = line.match(/^#(?![#*:])\s*(.*)$/);
    if (!def) continue;
    if (cur.flexion && !cur.lemma) {
      const links = [...def[1].matchAll(/\[\[([^\]|#]+)[^\]]*\]\]/g)];
      const tpl = def[1].match(/\{\{lien\|([^|}]+)/);
      cur.lemma = links.length ? links[links.length - 1][1].trim() : (tpl ? tpl[1].trim() : null);
    }
    const text = wikiToText(def[1]);
    if (text && cur.items.length < 6) cur.items.push(text);
  }
  return blocks.filter((b) => b.items.length);
}

function formatDefinition(blocks, title = '') {
  return blocks.slice(0, 3).map((b) => [
    title ? `${title} (${b.pos})` : b.pos,
    ...b.items.slice(0, 4).map((t, i) => `${i + 1}. ${t}`)
  ].join('\n')).join('\n\n');
}

async function wiktPage(title) {
  const url = `${WIKT_API}?action=parse&format=json&formatversion=2&origin=*&redirects=1&prop=wikitext&page=${encodeURIComponent(title)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (data.error || !data.parse) return null; // page absente
  return { title: data.parse.title, blocks: parseWiktionary(data.parse.wikitext) };
}

/* Variantes essayées : telle quelle, sans majuscule initiale, apostrophe
   typographique (titres du Wiktionnaire), sans « se » pour un verbe. */
function lookupCandidates(term) {
  const t = term.trim().replace(/\s+/g, ' ');
  const low = t.charAt(0).toLowerCase() + t.slice(1);
  const out = [t, low, t.replace(/'/g, '’'), low.replace(/'/g, '’')];
  const bare = low.replace(/^(se |s[’'])/i, '');
  if (bare !== low && bare) out.push(bare);
  return [...new Set(out)];
}

async function lookupDefinition(term) {
  for (const cand of lookupCandidates(term)) {
    const page = await wiktPage(cand);
    if (!page || !page.blocks.length) continue;
    const own = page.blocks.filter((b) => !b.flexion);
    const flex = page.blocks.find((b) => b.flexion && b.lemma);
    if (!own.length && flex) {
      // Forme fléchie (pluriel, féminin, verbe conjugué) : on va chercher le lemme.
      const lemma = await wiktPage(flex.lemma).catch(() => null);
      const lemmaBlocks = lemma ? lemma.blocks.filter((b) => !b.flexion) : [];
      return {
        title: page.title,
        text: flex.items[0] + (lemmaBlocks.length ? '\n\n' + formatDefinition(lemmaBlocks, lemma.title) : '')
      };
    }
    return { title: page.title, text: formatDefinition(own.length ? own : page.blocks) };
  }
  return null;
}

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/* Orthographe incertaine : « Vouliez-vous dire… ? » */
async function wiktSuggest(term) {
  const url = `${WIKT_API}?action=query&format=json&formatversion=2&origin=*&list=search&srnamespace=0&srlimit=5&srinfo=suggestion&srsearch=${encodeURIComponent(term)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const q = (await res.json()).query || {};
  const differs = (t) => t && t.toLowerCase() !== term.trim().toLowerCase();
  const sug = q.searchinfo && q.searchinfo.suggestion;
  if (differs(sug)) return sug;
  const close = (q.search || []).map((r) => r.title)
    .find((t) => differs(t) && levenshtein(normWord(t), normWord(term)) <= 2);
  return close || null;
}

/* ——— Aperçus ——— */
function defPreview(w) {
  if (!w.definition) {
    return { muted: true, html: w.defStatus === 'none' ? 'Sans définition — touchez le dictionnaire' : 'Définition en attente…' };
  }
  const lines = w.definition.split('\n').map((l) => l.trim()).filter(Boolean);
  const k = lines.findIndex((l) => /^\d+\.\s/.test(l));
  if (k < 0) return { html: esc(lines.join(' ')) };
  const pos = k > 0 && !/^\d+\./.test(lines[k - 1]) ? lines[k - 1] : '';
  return { html: (pos ? `<span class="pos">${esc(pos)}</span> · ` : '') + esc(lines[k].replace(/^\d+\.\s*/, '')) };
}

function defOneLine(w) {
  if (!w.definition) return '';
  const lines = w.definition.split('\n').map((l) => l.trim()).filter(Boolean);
  const senses = lines.filter((l) => /^\d+\.\s/.test(l)).slice(0, 3).map((l) => l.replace(/^\d+\.\s*/, ''));
  if (!senses.length) return lines.join(' ');
  // Forme fléchie : « Féminin singulier de sibyllin : Qui appartient… »
  const lead = !/^\d+\./.test(lines[0]) && /[.!?…]$/.test(lines[0]) ? lines[0].replace(/\.$/, '') + ' : ' : '';
  return lead + senses.join(' ; ');
}

const cleanContext = (s) => String(s || '').replace(/^[«"“\s]+|[»"”\s]+$/g, '');

function wordCard(w, i, showBook = true) {
  const book = w.bookId ? bookById(w.bookId) : null;
  const meta = [];
  if (showBook && book) meta.push(esc(book.title));
  if (w.page != null) meta.push(book && book.type === 'podcast' ? `à ${w.page} min` : `p. ${w.page}`);
  meta.push(esc(fmtShortDate(w.createdAt)));
  const prev = defPreview(w);
  return `
  <div class="swipe-wrap" style="animation-delay:${Math.min(i * 35, 350)}ms">
    <div class="swipe-bg" aria-hidden="true">Supprimer</div>
    <article class="card word-card swipeable" data-kind="word" data-id="${w.id}" tabindex="0" aria-label="${esc(w.text)} — toucher pour ouvrir">
      <div class="word-top">
        <h3 class="word-text">${esc(w.text)}</h3>
        <a class="dico-quick" data-dico="cnrtl" href="${esc(cnrtlURL(w.text))}" target="_blank" rel="noopener">CNRTL ↗</a>
      </div>
      <p class="word-def${prev.muted ? ' muted' : ''}">${prev.html}</p>
      ${w.context ? `<p class="word-ctx">« ${esc(cleanContext(w.context))} »</p>` : ''}
      <p class="word-meta">${meta.join(' · ')}</p>
    </article>
  </div>`;
}

/* ——— Écran Mots ——— */
const wordLetter = (w) => (normWord(w.text).replace(/^[^a-z0-9]+/, '').charAt(0) || '#').toUpperCase();
const byAlpha = (a, b) => a.text.localeCompare(b.text, 'fr', { sensitivity: 'base', ignorePunctuation: true });
const byPage = (a, b) => (a.page ?? 1e9) - (b.page ?? 1e9) || a.createdAt.localeCompare(b.createdAt);

function renderWordsView() {
  // Filtre par livre : seulement les livres qui ont des mots, et « Sans livre ».
  const loose = (w) => !w.bookId || !bookById(w.bookId);
  const ids = [...new Set(state.words.map((w) => w.bookId).filter((id) => id && bookById(id)))];
  const hasLoose = state.words.some(loose);
  if ((state.wordsBook && state.wordsBook !== 'none' && !ids.includes(state.wordsBook))
      || (state.wordsBook === 'none' && !hasLoose)) state.wordsBook = '';
  $('#words-book-filter').innerHTML = `<option value="">Tous les livres</option>`
    + ids.map(bookById).sort((a, b) => a.title.localeCompare(b.title, 'fr'))
      .map((b) => `<option value="${b.id}" ${state.wordsBook === b.id ? 'selected' : ''}>${esc(b.title)}</option>`).join('')
    + (hasLoose ? `<option value="none" ${state.wordsBook === 'none' ? 'selected' : ''}>Sans livre</option>` : '');
  $$('#words-sort .chip').forEach((c) => c.classList.toggle('active', c.dataset.sort === state.wordsSort));

  const listEl = $('#words-list');
  if (!state.words.length) {
    listEl.innerHTML = `<div class="empty">
      <span class="glyph">Aa</span>
      <h3>Aucun mot pour l’instant</h3>
      <p>Touchez + pour noter un mot ou une expression que vous ne connaissez pas : sa définition s’affiche toute seule.</p>
    </div>`;
    return;
  }

  let words = state.words.slice();
  if (state.wordsBook === 'none') words = words.filter(loose);
  else if (state.wordsBook) words = words.filter((w) => w.bookId === state.wordsBook);
  const q = normWord(state.wordsQuery);
  if (q) {
    words = words.filter((w) => {
      const book = w.bookId ? bookById(w.bookId) : null;
      return normWord([w.text, w.definition, w.context, book && book.title].filter(Boolean).join(' ')).includes(q);
    });
  }
  if (!words.length) {
    listEl.innerHTML = `<div class="empty"><h3>Aucun résultat</h3><p>${q ? `Rien ne correspond à « ${esc(state.wordsQuery)} ».` : 'Aucun mot pour ce livre.'}</p></div>`;
    return;
  }

  const sort = state.wordsSort;
  let html = '';
  let i = 0;
  if (sort === 'az' || sort === 'za') {
    words.sort(sort === 'az' ? byAlpha : (a, b) => byAlpha(b, a));
    let letter = null;
    for (const w of words) {
      const L = wordLetter(w);
      if (L !== letter) { html += `<h2 class="section-title letter">${esc(L)}</h2>`; letter = L; }
      html += wordCard(w, i++);
    }
  } else if (sort === 'book') {
    const groups = new Map();
    for (const w of words) {
      const key = loose(w) ? '' : w.bookId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(w);
    }
    const keys = [...groups.keys()].sort((a, b) => (!a) - (!b)
      || (a && b ? bookById(a).title.localeCompare(bookById(b).title, 'fr') : 0));
    for (const key of keys) {
      const list = groups.get(key).sort(byPage);
      html += `<h2 class="section-title">${esc(key ? bookById(key).title : 'Sans livre')} <span class="count">· ${list.length}</span></h2>`;
      html += list.map((w) => wordCard(w, i++, false)).join('');
    }
  } else {
    words.sort(sort === 'old'
      ? (a, b) => a.createdAt.localeCompare(b.createdAt)
      : (a, b) => b.createdAt.localeCompare(a.createdAt));
    html = `<p class="words-count">${words.length} mot${words.length > 1 ? 's' : ''}</p>`
      + words.map((w) => wordCard(w, i++)).join('');
  }
  listEl.innerHTML = html + LIST_HINT;
}

/* ——— Fiche d'un mot ——— */
/* source : d'où vient le texte de la définition — 'wiktionnaire' (trouvée
   automatiquement), 'perso' (écrite à la main) ou 'cnrtl' (collée depuis
   le CNRTL). Seule une définition du Wiktionnaire peut être remplacée par
   une nouvelle recherche automatique. */
const wl = { timer: null, run: 0, found: null, notFound: '', openedDef: '', source: '', defTitle: '', lastDico: '' };
const ws = { timer: null, run: 0, list: [], hidden: true }; // suggestions pendant la frappe

const sourceLabel = (src) => SOURCE_LABELS[src] || '';

/* Définition écrite ou collée par l'utilisateur : jamais écrasée d'office. */
function manualDefinition() {
  return Boolean($('#form-word').definition.value.trim()) && wl.source !== 'wiktionnaire';
}

function fillBookSelect(select, selectedId) {
  const books = state.books.slice().sort((a, b) =>
    (a.status === 'reading' ? 0 : 1) - (b.status === 'reading' ? 0 : 1) || a.title.localeCompare(b.title, 'fr'));
  select.innerHTML = '<option value="">Aucun livre</option>'
    + books.map((b) => `<option value="${b.id}">${esc(b.title)}</option>`).join('');
  select.value = selectedId && bookById(selectedId) ? selectedId : '';
}

/* Livre proposé : celui de la fiche ouverte, du filtre, ou l'unique livre en cours. */
function defaultWordBook() {
  if (state.route === 'book' && bookById(state.currentBookId)) return state.currentBookId;
  if (state.route === 'words' && state.wordsBook && bookById(state.wordsBook)) return state.wordsBook;
  const reading = state.books.filter((b) => b.status === 'reading');
  return reading.length === 1 ? reading[0].id : '';
}

function syncWordBookUI(prefillPage) {
  const form = $('#form-word');
  const book = bookById(form.bookId.value);
  $('#word-page-label').textContent = book && book.type === 'podcast' ? 'Minute' : 'Page';
  if (prefillPage && form.page.value === '' && book && book.currentPage > 0) form.page.value = book.currentPage;
}

function setDefStatus(html, busy = false) {
  const el = $('#def-status');
  el.innerHTML = html;
  el.classList.toggle('busy', busy);
}

/* Source affichée à côté de « Définition » ; celle du Wiktionnaire renvoie
   à sa page d'origine (licence CC BY-SA : attribution et lien). */
function setDefSource(src) {
  const el = $('#def-source');
  if (src === 'wiktionnaire') {
    const title = (wl.found && wl.found.title) || wl.defTitle || $('#form-word').text.value.trim();
    el.innerHTML = `· <a href="${esc(wiktURL(title))}" target="_blank" rel="noopener">Wiktionnaire</a>`;
    return;
  }
  const label = sourceLabel(src);
  el.textContent = label ? '· ' + label : '';
}

function renderCnrtlLink() {
  const term = $('#form-word').text.value.trim();
  $('#dico-links').innerHTML = term
    ? `<a class="dico-link" data-dico="cnrtl" href="${esc(cnrtlURL(term))}" target="_blank" rel="noopener">Voir dans le CNRTL ↗</a>`
    : '';
}

/* ——— Suggestions pendant la frappe (Wiktionnaire, par début de mot) ——— */
async function wiktPrefix(term) {
  const url = `${WIKT_API}?action=opensearch&format=json&formatversion=2&origin=*&namespace=0&limit=8&search=${encodeURIComponent(term)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
}

function renderWordSuggest() {
  const box = $('#word-suggest');
  const term = $('#form-word').text.value.trim();
  if (ws.hidden || term.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
  const n = normWord(term);
  const lower = term.toLowerCase();
  // La dernière liste reçue, filtrée tout de suite sur ce qui est tapé.
  const items = [...new Set(ws.list)].filter((t) => normWord(t).startsWith(n) && t.toLowerCase() !== lower).slice(0, 5);
  const known = ws.list.some((t) => t.toLowerCase() === lower) || (wl.found && wl.found.title.toLowerCase() === lower);
  box.innerHTML = items.map((t) => `<button type="button" class="chip" role="option" data-pick="${esc(t)}">${esc(t)}</button>`).join('')
    + (known ? '' : `<button type="button" class="chip add" data-add>+ Ajouter « ${esc(term)} »</button>`);
  box.hidden = !box.innerHTML;
}

function scheduleWordSuggest() {
  clearTimeout(ws.timer);
  ws.hidden = false;
  renderWordSuggest();
  const term = $('#form-word').text.value.trim();
  if (term.length < 2 || !navigator.onLine) return;
  ws.timer = setTimeout(async () => {
    const run = ++ws.run;
    let list;
    try { list = await wiktPrefix(term); } catch { return; }
    if (run !== ws.run) return;
    ws.list = list;
    renderWordSuggest();
  }, 220);
}

function hideWordSuggest() {
  clearTimeout(ws.timer);
  ws.run++;
  ws.hidden = true;
  renderWordSuggest();
}

/* ——— Mot choisi dans une citation ———
   Un toucher sur un mot le sélectionne, un second sur un autre mot étend
   la sélection en expression ; la phrase devient le contexte. */
const qp = { quote: null, tokens: [], a: -1, b: -1 };

function tokenizeWords(text) {
  const out = [];
  const re = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu;
  let m;
  while ((m = re.exec(text))) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

function syncFromQuoteButton() {
  $('#word-from-quote').hidden = state.quotes.length === 0 || !$('#qpick').hidden;
}

function openQuotePicker(quote = null) {
  hideWordSuggest();
  $('#qpick').hidden = false;
  syncFromQuoteButton();
  if (quote) showQuoteWords(quote); else showQuoteList();
}

function closeQuotePicker() {
  $('#qpick').hidden = true;
  qp.quote = null;
  syncFromQuoteButton();
}

function showQuoteList() {
  qp.quote = null;
  const recent = (a, b) => b.createdAt.localeCompare(a.createdAt);
  const bid = $('#form-word').bookId.value;
  let quotes = state.quotes.filter((q) => q.bookId === bid).sort(recent);
  if (!quotes.length) quotes = state.quotes.slice().sort(recent);
  $('#qpick-title').textContent = 'Choisissez une citation';
  $('#qpick-list').innerHTML = quotes.slice(0, 40).map((q) => {
    const book = bookById(q.bookId);
    const where = [book && book.title, quotePlace(q, book)].filter(Boolean).join(' · ');
    return `<button type="button" class="qpick-item" data-id="${q.id}"><span class="qtext-mini">${esc(q.text)}</span>${where ? `<small>${esc(where)}</small>` : ''}</button>`;
  }).join('');
  $('#qpick-list').hidden = false;
  $('#qpick-words').hidden = true;
  $('#qpick-actions').hidden = true;
}

function showQuoteWords(quote) {
  qp.quote = quote;
  qp.tokens = tokenizeWords(quote.text);
  qp.a = qp.b = -1;
  $('#qpick-title').textContent = 'Touchez un mot, ou deux pour une expression';
  let html = '';
  let pos = 0;
  qp.tokens.forEach((t, i) => {
    html += esc(quote.text.slice(pos, t.start))
      + `<button type="button" class="qw" data-i="${i}">${esc(quote.text.slice(t.start, t.end))}</button>`;
    pos = t.end;
  });
  $('#qpick-words').innerHTML = html + esc(quote.text.slice(pos));
  $('#qpick-list').hidden = true;
  $('#qpick-words').hidden = false;
  $('#qpick-actions').hidden = false;
  $('#qpick-back').hidden = state.quotes.length < 2;
  syncQuoteSelection();
}

function quoteSelectionText() {
  if (!qp.quote || qp.a < 0) return '';
  return qp.quote.text.slice(qp.tokens[qp.a].start, qp.tokens[qp.b].end);
}

function syncQuoteSelection() {
  $$('#qpick-words .qw').forEach((b) => {
    const i = Number(b.dataset.i);
    b.classList.toggle('on', qp.a >= 0 && i >= qp.a && i <= qp.b);
  });
  const sel = quoteSelectionText();
  const use = $('#qpick-use');
  use.disabled = !sel;
  use.textContent = sel ? `Choisir « ${sel.length > 38 ? sel.slice(0, 37) + '…' : sel} »` : 'Touchez un mot';
}

function onQuoteWordTap(i) {
  if (qp.a < 0 || qp.a !== qp.b) qp.a = qp.b = i;   // premier mot (ou nouveau départ)
  else if (i === qp.a) qp.a = qp.b = -1;            // même mot : désélection
  else { qp.a = Math.min(qp.a, i); qp.b = Math.max(qp.b, i); } // second mot : expression
  syncQuoteSelection();
}

/* Phrase qui contient la sélection (entre deux ponctuations fortes). */
function sentenceAround(text, start, end) {
  let s = start;
  while (s > 0 && !/[.!?…]/.test(text[s - 1])) s--;
  let e = end;
  while (e < text.length && !/[.!?…]/.test(text[e])) e++;
  while (e < text.length && /[.!?…»"”]/.test(text[e])) e++;
  const raw = text.slice(s, e);
  return { sentence: raw.trim(), start: s + raw.length - raw.trimStart().length };
}

function useQuoteSelection() {
  const q = qp.quote;
  if (!q || qp.a < 0) return;
  const start = qp.tokens[qp.a].start;
  const end = qp.tokens[qp.b].end;
  let text = q.text.slice(start, end);
  const { sentence, start: sStart } = sentenceAround(q.text, start, end);
  // Majuscule de début de phrase : « Sibyllin » → « sibyllin »
  if (start === sStart && /^\p{Lu}\p{Ll}/u.test(text)) text = text.charAt(0).toLocaleLowerCase('fr') + text.slice(1);
  const form = $('#form-word');
  form.text.value = text;
  if (!form.context.value.trim()) form.context.value = sentence;
  if (q.bookId && bookById(q.bookId)) form.bookId.value = q.bookId;
  if (q.page != null && q.page !== '' && !isNaN(q.page)) form.page.value = q.page;
  syncWordBookUI(false);
  closeQuotePicker();
  updateDupHint();
  renderCnrtlLink();
  runWordLookup(text);
}

function openWordFromQuote(q) {
  openWordForm(null, q.bookId, { quote: q });
}

function updateDupHint() {
  const n = normWord($('#form-word').text.value);
  const dup = n && state.words.find((w) => w.id !== state.editing.wordId && normWord(w.text) === n);
  const el = $('#word-dup');
  el.hidden = !dup;
  if (!dup) return;
  const book = dup.bookId ? bookById(dup.bookId) : null;
  el.innerHTML = `Déjà noté le ${esc(fmtShortDate(dup.createdAt))}${book ? ' (' + esc(book.title) + ')' : ''} · `
    + `<button type="button" class="link-btn" data-open-word="${dup.id}">Voir</button>`;
}

function openWordForm(word = null, bookId, opts = {}) {
  const form = $('#form-word');
  form.reset();
  clearTimeout(wl.timer);
  wl.run++;
  wl.found = null;
  wl.notFound = '';
  ws.list = [];
  ws.hidden = true;
  renderWordSuggest();
  closeQuotePicker();
  state.editing.wordId = word ? word.id : null;
  fillBookSelect(form.bookId, word ? word.bookId : (bookId !== undefined ? bookId : defaultWordBook()));
  form.text.value = word ? word.text : '';
  form.definition.value = word ? (word.definition || '') : '';
  wl.openedDef = form.definition.value;
  wl.source = word && word.definition ? (word.defSource || 'perso') : '';
  wl.defTitle = word ? (word.defTitle || '') : '';
  form.context.value = word ? (word.context || '') : '';
  form.page.value = word && word.page != null ? word.page : '';
  syncWordBookUI(!word);
  $('#sheet-word-title').textContent = word ? 'Modifier le mot' : 'Nouveau mot';
  setDefSource(wl.source);
  setDefStatus(word && !word.definition && word.defStatus === 'none' ? 'Aucune définition trouvée sur le Wiktionnaire.' : '');
  renderCnrtlLink();
  updateDupHint();
  $('#btn-delete-word').hidden = !word;
  syncFromQuoteButton();
  openSheet('#sheet-word');
  if (opts.quote) openQuotePicker(opts.quote);
  else if (word && !word.definition && word.defStatus !== 'none') runWordLookup(word.text);
}

function scheduleWordLookup() {
  clearTimeout(wl.timer);
  const term = $('#form-word').text.value.trim();
  if (!term) { wl.run++; setDefStatus(''); return; }
  if (term.length < 2 || manualDefinition()) return;
  wl.timer = setTimeout(() => runWordLookup(term), 650);
}

/* Cherche la définition pendant la saisie ; « force » (bouton Rechercher,
   suggestion d'orthographe) remplace aussi une définition écrite ou collée. */
async function runWordLookup(term, force = false) {
  const form = $('#form-word');
  if (manualDefinition() && !force) return;
  clearTimeout(wl.timer);
  const run = ++wl.run;
  if (!navigator.onLine) {
    setDefStatus('Hors ligne : la définition sera cherchée au retour du réseau.');
    return;
  }
  setDefStatus('Recherche de la définition…', true);
  try {
    const res = await lookupDefinition(term);
    if (run !== wl.run) return;
    if (res) {
      wl.found = res;
      wl.notFound = '';
      wl.source = 'wiktionnaire';
      form.definition.value = res.text;
      setDefSource('wiktionnaire');
      setDefStatus('');
      renderWordSuggest();
      return;
    }
    wl.found = null;
    wl.notFound = normWord(term);
    if (!manualDefinition()) { form.definition.value = ''; wl.source = ''; setDefSource(''); }
    setDefStatus('Aucune définition trouvée sur le Wiktionnaire.');
    renderWordSuggest();
    const sug = await wiktSuggest(term).catch(() => null);
    if (run !== wl.run || !sug) return;
    setDefStatus(`Aucune définition trouvée. Vouliez-vous dire <button type="button" class="link-btn" data-suggest="${esc(sug)}">${esc(sug)}</button> ?`);
  } catch {
    if (run === wl.run) setDefStatus('Définition indisponible pour le moment (réseau) : elle sera cherchée plus tard.');
  }
}

/* Une citation ou un mot plus loin que la page notée fait avancer la lecture. */
async function advanceProgress(book, page, now) {
  if (!book || page == null || book.status === 'done') return null;
  const target = book.totalPages ? Math.min(page, book.totalPages) : page;
  if (target <= (book.currentPage || 0)) return null;
  book.currentPage = target;
  if (book.status === 'toread') {
    book.status = 'reading';
    if (!book.startDate) book.startDate = todayISO();
  }
  book.updatedAt = now;
  await db.put('books', book);
  return target;
}

const progressNote = (book, p) => (p == null ? '' : ` · progression : ${book.type === 'podcast' ? p + ' min' : 'p. ' + p}`);

async function saveWordForm(e) {
  e.preventDefault();
  const form = $('#form-word');
  const text = form.text.value.trim().replace(/\s+/g, ' ');
  if (!text) { flagField(form.text); toast('Écrivez le mot ou l’expression'); return; }
  const now = new Date().toISOString();
  let word = state.editing.wordId ? state.words.find((w) => w.id === state.editing.wordId) : null;
  const isNew = !word;
  if (!word) word = { id: uid(), createdAt: now, definition: '', defSource: '' };
  const sameWord = normWord(word.text) === normWord(text);
  const def = form.definition.value.trim();
  if (def) {
    word.defSource = wl.source || 'perso';
    if (wl.source === 'wiktionnaire' && wl.found) word.defTitle = wl.found.title;
    word.definition = def;
    word.defStatus = 'ok';
  } else if (wl.openedDef.trim()) {
    // Définition effacée volontairement : on ne la recherche plus d'office.
    Object.assign(word, { definition: '', defSource: '', defStatus: 'none' });
  } else if (!(sameWord && word.definition)) {
    // (sinon : définition arrivée en arrière-plan pendant la saisie, on la garde)
    Object.assign(word, { definition: '', defSource: '', defStatus: wl.notFound === normWord(text) ? 'none' : undefined });
  }
  word.text = text;
  word.context = form.context.value.trim();
  word.bookId = form.bookId.value || null;
  word.page = form.page.value === '' ? null : Math.max(0, parseInt(form.page.value, 10) || 0);
  word.updatedAt = now;
  if (isNew) state.words.push(word);
  await db.put('words', word);

  const book = word.bookId ? bookById(word.bookId) : null;
  const progressed = await advanceProgress(book, word.page, now);
  closeSheet();
  if (state.route === 'book' && book && state.currentBookId === book.id) state.bookTab = 'words';
  toast((isNew ? 'Mot noté' : 'Mot enregistré') + progressNote(book, progressed));
  render();
  if (!word.definition && word.defStatus === undefined) fillMissingDefinitions();
}

async function deleteWord(id) {
  const word = state.words.find((w) => w.id === id);
  if (!word) return;
  await db.remove('words', id);
  state.words = state.words.filter((w) => w.id !== id);
  render();
  toast('Mot supprimé', {
    label: 'Annuler',
    run: async () => {
      await db.put('words', word);
      if (!state.words.some((w) => w.id === word.id)) state.words.push(word);
      render();
    }
  });
}

/* Définitions manquantes (mot noté hors ligne…) : cherchées en arrière-plan
   au démarrage, au retour du réseau et au retour dans l'app. */
let fillingDefs = false;
async function fillMissingDefinitions() {
  if (fillingDefs || !navigator.onLine) return;
  const todo = state.words.filter((w) => !w.definition && !w.defStatus);
  if (!todo.length) return;
  fillingDefs = true;
  try {
    for (const w of todo.slice(0, 15)) {
      let res;
      try { res = await lookupDefinition(w.text); } catch { break; } // réseau : plus tard
      if (!state.words.includes(w) || w.definition || w.defStatus) continue;
      if (res) Object.assign(w, { definition: res.text, defSource: 'wiktionnaire', defTitle: res.title, defStatus: 'ok' });
      else w.defStatus = 'none';
      await db.put('words', w);
      if (state.route === 'words' || (state.route === 'book' && state.bookTab === 'words')) refresh(render);
    }
  } finally {
    fillingDefs = false;
  }
}

/* ═══════════ MONDE CACHÉ ═══════════
   Cinq touchers sur le titre « Mots » : un texte où l'on ne parle qu'avec
   les mots notés, au hasard. Ça ne veut rien dire, et c'est le but. */

let secretTaps = [];
let secretPlain = '';

function onWordsTitleTap() {
  const now = Date.now();
  secretTaps = secretTaps.filter((t) => now - t < 1800);
  secretTaps.push(now);
  const title = $('#words-title');
  if (secretTaps.length >= 3) {
    title.classList.remove('wobble');
    void title.offsetWidth; // rejoue l'animation
    title.classList.add('wobble');
  }
  if (secretTaps.length >= 5) {
    secretTaps = [];
    openSecretWorld();
  }
}

function makeNonsense(pool) {
  const rnd = (n) => Math.floor(Math.random() * n);
  const pick = (avoid) => {
    let w = pool[rnd(pool.length)];
    for (let g = 0; g < 8 && w === avoid && pool.length > 1; g++) w = pool[rnd(pool.length)];
    return w;
  };
  const ENDS = ['.', '.', '.', '…', ' !', ' ?'];
  const paras = [];
  for (let p = 0; p < 2; p++) {
    const sentences = [];
    const nSent = 2 + rnd(3);
    for (let s = 0; s < nSent; s++) {
      const len = 3 + rnd(5);
      const toks = [];
      let prev = null;
      for (let i = 0; i < len; i++) {
        const w = pick(prev);
        prev = w;
        if (i > 0) toks.push({ text: i > 1 && Math.random() < 0.2 ? ', ' : ' ' });
        toks.push({ text: i === 0 ? capFirst(w.text.trim()) : w.text.trim(), word: w });
      }
      toks.push({ text: ENDS[rnd(ENDS.length)] });
      sentences.push(toks);
    }
    paras.push(sentences);
  }
  return paras;
}

function renderSecretText() {
  const pool = state.words.filter((w) => w.text.trim());
  const el = $('#secret-text');
  const enough = pool.length >= 3;
  $('#secret-again').hidden = !enough;
  $('#secret-copy').hidden = !enough;
  if (!enough) {
    el.innerHTML = '<p class="secret-empty">Ce monde est encore désert… Notez au moins trois mots pour lui donner vie.</p>';
    secretPlain = '';
    return;
  }
  const paras = makeNonsense(pool);
  let k = 0;
  el.innerHTML = paras.map((sentences) => '<p>' + sentences.map((toks) => toks.map((t) => (t.word
    ? `<span class="sw" data-id="${t.word.id}" style="animation-delay:${Math.min(k++ * 70, 4000)}ms">${esc(t.text)}</span>`
    : esc(t.text))).join('')).join(' ') + '</p>').join('');
  secretPlain = paras.map((sentences) => sentences.map((toks) => toks.map((t) => t.text).join('')).join(' ')).join('\n\n');
}

function openSecretWorld() {
  hideToast();
  const el = $('#secret');
  el.hidden = false;
  el.scrollTop = 0;
  document.documentElement.classList.add('secret-open');
  renderSecretText();
}

function closeSecretWorld() {
  $('#secret').hidden = true;
  document.documentElement.classList.remove('secret-open');
}

/* ═══════════ EXPORTS ═══════════ */

function quoteBlock(q, isPodcast) {
  const lines = q.text.split('\n').map((l) => '> ' + l).join('\n');
  const meta = [];
  if (q.page != null) meta.push(isPodcast ? `à ${q.page} min` : 'p. ' + q.page);
  if ((q.tags || []).length) meta.push(q.tags.map((t) => '#' + t).join(' '));
  return lines + (meta.length ? '\n>\n> — ' + meta.join(' · ') : '');
}

function bookMarkdown(book) {
  const sub = subtitleOf(book);
  const pod = book.type === 'podcast';
  const act = pod ? 'écoute' : 'lecture';
  const lines = [`## ${book.title}${sub ? ' — ' + sub : ''}`, ''];
  const meta = [`- Type : ${TYPE_LABELS[book.type] || 'Livre'}`, `- Statut : ${STATUS_LABELS[book.status]}`];
  if (pod && book.show) meta.push(`- Émission : ${book.show}`);
  if (book.totalPages) meta.push(`- Progression : ${book.currentPage || 0}/${book.totalPages}${pod ? ' min' : ''} (${pct(book)} %)`);
  if (book.startDate) meta.push(`- Début d'${act} : ${fmtDate(book.startDate)}`);
  if (book.endDate) meta.push(`- Fin d'${act} : ${fmtDate(book.endDate)}`);
  if ((book.tags || []).length) meta.push(`- Tags : ${book.tags.join(', ')}`);
  if (book.status === 'done' && book.rating) meta.push(`- Note : ${stars(book.rating)}`);
  lines.push(...meta, '');

  const notes = notesOf(book.id);
  if (notes.length) {
    lines.push('### Notes', '');
    for (const n of notes) lines.push(`**${fmtDate(n.createdAt)}**`, '', n.text, '');
  }
  const quotes = quotesOf(book.id);
  if (quotes.length) {
    lines.push('### Citations', '');
    for (const q of quotes) lines.push(quoteBlock(q, pod), '');
  }
  const words = wordsOf(book.id);
  if (words.length) {
    lines.push('### Mots', '');
    for (const w of words) lines.push(wordLine(w, pod));
    lines.push('');
  }
  return lines.join('\n');
}

/* « - **sibyllin** (p. 42) — Relatif aux sibylles ; obscur, énigmatique. » */
function wordLine(w, isPodcast) {
  const where = w.page != null ? ` (${isPodcast ? `à ${w.page} min` : 'p. ' + w.page})` : '';
  const def = defOneLine(w);
  return `- **${w.text}**${where}${def ? ' — ' + def : ''}`;
}

function exportMarkdown(book = null) {
  let md;
  let filename;
  if (book) {
    md = `# ${book.title}\n\n` + bookMarkdown(book).split('\n').slice(2).join('\n');
    filename = book.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'livre';
  } else {
    const parts = [`# Ma bibliothèque`, ``, `_Export du ${fmtDate(todayISO())} — ${state.books.length} titres, ${state.quotes.length} citations, ${state.notes.length} notes, ${state.words.length} mots._`, ''];
    for (const status of STATUS_ORDER) {
      const group = state.books.filter((b) => b.status === status)
        .sort((a, b) => a.title.localeCompare(b.title, 'fr'));
      for (const b of group) parts.push(bookMarkdown(b), '---', '');
    }
    const loose = state.words.filter((w) => !w.bookId || !bookById(w.bookId)).sort(byAlpha);
    if (loose.length) parts.push('## Mots sans livre', '', ...loose.map((w) => wordLine(w, false)), '');
    md = parts.join('\n');
    filename = 'bibliotheque';
  }
  shareOrDownload(`${filename}-${todayISO()}.md`, md, 'text/markdown');
}

/* Lexique complet, par ordre alphabétique, pour réviser. */
function exportWordsMarkdown() {
  if (!state.words.length) { toast('Aucun mot noté pour le moment'); return; }
  const words = state.words.slice().sort(byAlpha);
  const lines = ['# Mes mots', '', `_Export du ${fmtDate(todayISO())} — ${words.length} mot${words.length > 1 ? 's' : ''}._`, ''];
  let letter = null;
  for (const w of words) {
    const L = wordLetter(w);
    if (L !== letter) { lines.push(`## ${L}`, ''); letter = L; }
    const book = w.bookId ? bookById(w.bookId) : null;
    const src = [book && book.title, w.page != null && (book && book.type === 'podcast' ? `à ${w.page} min` : 'p. ' + w.page)].filter(Boolean).join(', ');
    lines.push(`### ${w.text}${src ? ` — _${src}_` : ''}`, '');
    if (w.definition) lines.push(w.definition, '');
    if (w.context) lines.push(`> ${cleanContext(w.context)}`, '');
  }
  shareOrDownload(`mes-mots-${todayISO()}.md`, lines.join('\n'), 'text/markdown');
}

/* Sauvegarde facultative : tout le compte, au format des versions
   précédentes (réimportable sans doublon). */
function exportJSON() {
  const data = {
    app: 'lecture', version: 2, exportedAt: new Date().toISOString(),
    books: state.books, notes: state.notes, quotes: state.quotes, words: state.words
  };
  shareOrDownload(`lecture-sauvegarde-${todayISO()}.json`, JSON.stringify(data, null, 2), 'application/json');
}

/* Sur iPhone, la feuille de partage est plus pratique qu'un téléchargement. */
async function shareOrDownload(name, content, mime) {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const file = new File([blob], name, { type: mime });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // partage annulé par l'utilisateur
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Fichier exporté');
}

async function importJSONFile(file) {
  let parsed;
  try { parsed = parseBackup(await file.text()); } catch { parsed = { error: 'Fichier illisible.' }; }
  if (parsed.error) { alert(parsed.error); return; }
  const { data } = parsed;
  const summary = describeCounts(Object.fromEntries(db.STORES.map((s) => [s, (data[s] || []).length])));
  if (!confirm(`Importer cette sauvegarde (${summary}) dans votre compte ?\n\nRien n’est supprimé : un élément déjà présent garde sa version la plus récente.`)) return;
  await importIntoAccount(data, 'file');
}

/* ═══════════ MISES À JOUR ═══════════
   Une nouvelle version recharge l'app, mais jamais pendant une saisie :
   elle attend la fermeture du formulaire ou le passage en arrière-plan. */

let updatePending = false;
let reloading = false;

function reloadApp() {
  if (reloading) return;
  reloading = true;
  location.reload();
}

function isEditing() {
  const a = document.activeElement;
  return Boolean(openedSheet) || !$('#cropper').hidden
    || Boolean(a && a.matches && a.matches('input, textarea, select'));
}

function applyPendingUpdate() {
  if (updatePending && !isEditing()) reloadApp();
}

async function forceUpdate() {
  if (!('serviceWorker' in navigator)) { location.reload(); return; }
  toast('Recherche de mise à jour…');
  try {
    // Vérifie le réseau avant de toucher au cache.
    await fetch('./sw.js', { cache: 'no-store' });
  } catch {
    toast('Hors ligne — réessayez plus tard');
    return;
  }
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) { location.reload(); return; }

  // Le nouveau service worker prend le contrôle (skipWaiting + claim) : on recharge.
  navigator.serviceWorker.addEventListener('controllerchange', reloadApp, { once: true });

  await reg.update();
  if (reg.installing || reg.waiting) {
    toast('Mise à jour en cours…');
    setTimeout(reloadApp, 15000); // garde-fou si controllerchange n'arrive pas
  } else {
    toast('Application déjà à jour');
  }
}

/* ═══════════ DICTÉE (Web Speech API) ═══════════
   Limitation Apple : l'API SpeechRecognition est bloquée dans les web
   apps installées sur l'écran d'accueil iOS (erreur service-not-allowed,
   bug WebKit #225298). Dans ce cas on bascule sur la dictée Apple du
   clavier iOS : même moteur, sur l'appareil, et elle marche hors ligne. */

const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const dict = { active: false, rec: null, btn: null, ta: null, base: '', startedAt: 0, gotResult: false, failedHard: false };

function speechSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

let speechFailedThisSession = false;

function speechAvailable() {
  // Sur iOS, l'API Web Speech est bloquée en app installée et instable
  // dans Safari : on passe systématiquement par la dictée du clavier,
  // qui utilise le même moteur Apple et fonctionne partout.
  return speechSupported()
    && !IS_IOS
    && !speechFailedThisSession;
}

function keyboardDictationFallback(textarea) {
  textarea.focus();
  toast(IS_IOS
    ? 'Touchez le micro 🎤 en bas du clavier et parlez. Pas de micro ? Réglages → Général → Clavier → Activer la dictée.'
    : 'Dictée indisponible sur ce navigateur — utilisez le clavier.');
}

/* Safari échoue silencieusement si la permission micro n'a jamais été accordée. */
async function ensureMicPermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

function dictationSession() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR();
  r.lang = 'fr-FR';
  // continuous est instable sur iOS : sessions courtes relancées en boucle.
  r.continuous = !IS_IOS;
  r.interimResults = true;
  r.onstart = () => { dict.startedAt = Date.now(); };
  r.onresult = (e) => {
    dict.gotResult = true;
    let transcript = '';
    for (const res of e.results) transcript += res[0].transcript;
    dict.ta.value = (dict.base ? dict.base + ' ' : '') + transcript.trim();
    dict.ta.dispatchEvent(new Event('input', { bubbles: true })); // brouillon
  };
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
      dict.failedHard = true;
    }
  };
  r.onend = () => {
    if (!dict.active) { finishDictation(); return; }
    const diedInstantly = !dict.gotResult && Date.now() - dict.startedAt < 1200;
    if (dict.failedHard || diedInstantly) {
      // Service indisponible (souvent : dictée désactivée dans les
      // réglages iOS). On bascule pour cette session seulement.
      if (dict.failedHard) speechFailedThisSession = true;
      const ta = dict.ta;
      finishDictation();
      keyboardDictationFallback(ta);
      return;
    }
    // iOS coupe la session après un silence : on mémorise et on repart.
    dict.base = dict.ta.value.trim();
    dict.gotResult = false;
    dict.rec = dictationSession();
    try { dict.rec.start(); } catch { finishDictation(); }
  };
  return r;
}

function finishDictation() {
  if (dict.btn) {
    dict.btn.classList.remove('rec');
    dict.btn.querySelector('.cap-label').textContent = 'Dicter';
  }
  dict.active = false;
  dict.rec = null;
  dict.btn = null;
  dict.ta = null;
}

function stopDictation() {
  if (!dict.active) return;
  dict.active = false;
  if (dict.rec) { try { dict.rec.stop(); } catch { finishDictation(); } }
  else finishDictation();
}

async function toggleDictation(textarea, btn) {
  if (dict.active) { stopDictation(); return; }
  if (!speechAvailable()) { keyboardDictationFallback(textarea); return; }

  btn.classList.add('rec');
  btn.querySelector('.cap-label').textContent = 'Arrêter';
  if (!(await ensureMicPermission())) {
    btn.classList.remove('rec');
    btn.querySelector('.cap-label').textContent = 'Dicter';
    toast('Accès au micro refusé — autorisez-le dans les réglages.');
    return;
  }

  dict.active = true;
  dict.btn = btn;
  dict.ta = textarea;
  dict.base = textarea.value.trim();
  dict.gotResult = false;
  dict.failedHard = false;
  dict.rec = dictationSession();
  try {
    dict.rec.start();
  } catch {
    finishDictation();
    keyboardDictationFallback(textarea);
  }
}

/* ═══════════ SCAN DE TEXTE (OCR Tesseract.js, 100 % local) ═══════════
   Parcours : photo (appareil photo ou galerie) → recadrage du passage →
   prétraitement → lecture → lignes à cocher → insertion nettoyée.
   Le recadrage est décisif : sur une photo de livre ouvert, lire toute
   l'image mélange les lignes des deux pages. */

let ocrWorkerPromise = null;
let ocrProgress = null; // rappel de progression de la lecture en cours
const ocr = { url: null, previewURL: null, box: null, drag: null, run: 0 };
const CROP_MIN = 0.04; // taille minimale du cadre (fraction de la photo)

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('échec de chargement : ' + src));
    document.head.appendChild(s);
  });
}

/* Les chemins doivent être absolus : le worker OCR résout les URLs
   relatives par rapport à son propre fichier, pas à la page. */
const vendorURL = (p) => new URL(p, document.baseURI).href;

function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      if (!window.Tesseract) await loadScript('./vendor/tesseract/tesseract.min.js');
      const worker = await Tesseract.createWorker('fra', 1, {
        workerPath: vendorURL('vendor/tesseract/worker.min.js'),
        corePath: vendorURL('vendor/tesseract'),
        langPath: vendorURL('vendor/tesseract/lang/best_int'),
        gzip: true,
        // Clé de cache neuve : sans elle, l'ancien modèle « fast », gardé
        // dans IndexedDB sous « ./fra.traineddata », resterait utilisé.
        cachePath: 'fra-best-int',
        logger: (m) => {
          if (m.status === 'recognizing text' && ocrProgress) ocrProgress(m.progress);
        }
      });
      await worker.setParameters({
        tessedit_pageseg_mode: '6', // un seul bloc de texte : le passage recadré
        user_defined_dpi: '300'
      });
      dropStaleOcrCache();
      return worker;
    })();
    ocrWorkerPromise.catch(() => { ocrWorkerPromise = null; }); // on retentera
  }
  return ocrWorkerPromise;
}

/* Démarre le moteur pendant que l'on recadre : pas d'attente ensuite. */
function warmOcr() { getOcrWorker().catch(() => {}); }

/* Moteur en échec (iOS peut arrêter le worker faute de mémoire) :
   on le jette, le prochain scan en recrée un neuf. */
function resetOcrWorker() {
  const p = ocrWorkerPromise;
  ocrWorkerPromise = null;
  if (p) p.then((w) => w.terminate()).catch(() => {});
}

/* Libère l'ancien modèle (« fast ») laissé en cache par les versions précédentes. */
function dropStaleOcrCache() {
  try {
    const req = indexedDB.open('keyval-store');
    req.onupgradeneeded = () => req.transaction.abort(); // base absente : ne rien créer
    req.onsuccess = () => {
      const idb = req.result;
      try {
        if (idb.objectStoreNames.contains('keyval')) {
          idb.transaction('keyval', 'readwrite').objectStore('keyval').delete('./fra.traineddata');
        }
      } catch { /* sans importance */ }
      idb.close();
    };
    req.onerror = () => {};
  } catch { /* stockage indisponible */ }
}

function setOcrStatus(msg, busy = false) {
  const el = $('#ocr-status');
  el.textContent = msg;
  el.classList.toggle('busy', busy);
}

function closeOcrPanel() {
  closeCropper();
  $('#ocr-panel').hidden = true;
  setOcrStatus('');
  $('#ocr-lines').innerHTML = '';
  $('#ocr-actions').hidden = true;
  const preview = $('#ocr-preview');
  preview.hidden = true;
  preview.removeAttribute('src');
  if (ocr.previewURL) { URL.revokeObjectURL(ocr.previewURL); ocr.previewURL = null; }
  $('#crop-img').removeAttribute('src');
  if (ocr.url) { URL.revokeObjectURL(ocr.url); ocr.url = null; }
  ocrProgress = null;
  ocr.run++; // une lecture encore en cours sera ignorée
}

/* ——— Recadrage ——— */
function openCropper(file) {
  if (ocr.url) URL.revokeObjectURL(ocr.url);
  ocr.url = URL.createObjectURL(file);
  ocr.box = { x: 0.06, y: 0.22, w: 0.88, h: 0.56 };
  showCropper();
}

function showCropper() {
  const img = $('#crop-img');
  $('#cropper').hidden = false;
  document.documentElement.classList.add('cropping');
  const ready = () => { layoutCrop(); warmOcr(); };
  if (img.getAttribute('src') === ocr.url && img.complete && img.naturalWidth) {
    ready();
    return;
  }
  img.onload = ready;
  img.onerror = () => {
    closeCropper();
    toast('Impossible d’ouvrir cette photo — essayez-en une autre.');
  };
  img.src = ocr.url;
}

function closeCropper() {
  $('#cropper').hidden = true;
  document.documentElement.classList.remove('cropping');
  ocr.drag = null;
}

/* Position de la photo affichée (entière, centrée) dans la zone de recadrage. */
function cropGeometry() {
  const stage = $('#crop-stage');
  const img = $('#crop-img');
  const sw = stage.clientWidth;
  const sh = stage.clientHeight;
  const iw = img.naturalWidth || 1;
  const ih = img.naturalHeight || 1;
  const s = Math.min(sw / iw, sh / ih);
  return { left: (sw - iw * s) / 2, top: (sh - ih * s) / 2, width: iw * s, height: ih * s };
}

function layoutCrop() {
  if ($('#cropper').hidden || !ocr.box) return;
  const g = cropGeometry();
  const img = $('#crop-img');
  img.style.left = g.left + 'px';
  img.style.top = g.top + 'px';
  img.style.width = g.width + 'px';
  img.style.height = g.height + 'px';
  const b = ocr.box;
  const box = $('#crop-box');
  box.style.left = g.left + b.x * g.width + 'px';
  box.style.top = g.top + b.y * g.height + 'px';
  box.style.width = b.w * g.width + 'px';
  box.style.height = b.h * g.height + 'px';
}

/* Bords et coins pour redimensionner, intérieur pour déplacer, extérieur
   pour tracer un nouveau cadre. La zone saisie est calculée ici plutôt que
   par les poignées : sur un cadre fin, elles recouvriraient tout l'intérieur. */
function cropHitMode(px, py, g) {
  const GRAB = 24; // tolérance en px autour des bords
  const b = ocr.box;
  const L = b.x * g.width;
  const R = (b.x + b.w) * g.width;
  const T = b.y * g.height;
  const B = (b.y + b.h) * g.height;
  // À l'intérieur, la bande de saisie d'un bord ne dépasse pas le tiers du
  // cadre : le centre reste toujours disponible pour le déplacer.
  const tx = Math.min(GRAB, (R - L) / 3);
  const ty = Math.min(GRAB, (B - T) / 3);
  const inX = px > L - GRAB && px < R + GRAB;
  const inY = py > T - GRAB && py < B + GRAB;
  let v = '';
  let h = '';
  if (inX) {
    const nearT = py > T - GRAB && py < T + ty;
    const nearB = py > B - ty && py < B + GRAB;
    if (nearT && nearB) v = Math.abs(py - T) <= Math.abs(py - B) ? 't' : 'b';
    else v = nearT ? 't' : (nearB ? 'b' : '');
  }
  if (inY) {
    const nearL = px > L - GRAB && px < L + tx;
    const nearR = px > R - tx && px < R + GRAB;
    if (nearL && nearR) h = Math.abs(px - L) <= Math.abs(px - R) ? 'l' : 'r';
    else h = nearL ? 'l' : (nearR ? 'r' : '');
  }
  if (v || h) return v + h;
  return px > L && px < R && py > T && py < B ? 'move' : 'new';
}

function bindCropper() {
  const stage = $('#crop-stage');
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  // Position du doigt en fraction de la photo (non bornée, pour les écarts).
  const toNorm = (e, g) => {
    const r = stage.getBoundingClientRect();
    return { x: (e.clientX - r.left - g.left) / g.width, y: (e.clientY - r.top - g.top) / g.height };
  };
  stage.addEventListener('pointerdown', (e) => {
    if (ocr.drag || !ocr.box) return;
    const g = cropGeometry();
    const p = toNorm(e, g);
    const mode = cropHitMode(p.x * g.width, p.y * g.height, g);
    ocr.drag = { id: e.pointerId, mode, start: p, box: { ...ocr.box } };
    try { stage.setPointerCapture(e.pointerId); } catch { /* sans importance */ }
    e.preventDefault();
  });
  stage.addEventListener('pointermove', (e) => {
    const d = ocr.drag;
    if (!d || e.pointerId !== d.id) return;
    const p = toNorm(e, cropGeometry());
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    const o = d.box;
    let x = o.x;
    let y = o.y;
    let x2 = o.x + o.w;
    let y2 = o.y + o.h;
    if (d.mode === 'move') {
      x = clamp(o.x + dx, 0, 1 - o.w);
      y = clamp(o.y + dy, 0, 1 - o.h);
      x2 = x + o.w;
      y2 = y + o.h;
    } else if (d.mode === 'new') {
      const sx = clamp(d.start.x, 0, 1);
      const sy = clamp(d.start.y, 0, 1);
      const ex = clamp(p.x, 0, 1);
      const ey = clamp(p.y, 0, 1);
      x = Math.min(sx, ex);
      x2 = Math.max(sx, ex);
      y = Math.min(sy, ey);
      y2 = Math.max(sy, ey);
    } else {
      // Le bord suit le doigt de l'écart parcouru (pas de saut initial).
      if (d.mode.includes('l')) x = clamp(o.x + dx, 0, x2 - CROP_MIN);
      if (d.mode.includes('r')) x2 = clamp(o.x + o.w + dx, x + CROP_MIN, 1);
      if (d.mode.includes('t')) y = clamp(o.y + dy, 0, y2 - CROP_MIN);
      if (d.mode.includes('b')) y2 = clamp(o.y + o.h + dy, y + CROP_MIN, 1);
    }
    ocr.box = { x, y, w: x2 - x, h: y2 - y };
    layoutCrop();
  });
  const end = (e) => {
    const d = ocr.drag;
    if (!d || e.pointerId !== d.id) return;
    // Cadre trop petit (simple toucher hors du cadre) : on garde l'ancien.
    if (ocr.box.w < CROP_MIN || ocr.box.h < CROP_MIN) ocr.box = d.box;
    ocr.drag = null;
    layoutCrop();
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  window.addEventListener('resize', layoutCrop);
}

function readCrop() {
  const img = $('#crop-img');
  if (!img.naturalWidth || !ocr.box) return;
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const b = ocr.box;
  const x = Math.min(W - 1, Math.max(0, Math.round(b.x * W)));
  const y = Math.min(H - 1, Math.max(0, Math.round(b.y * H)));
  const rect = {
    x, y,
    w: Math.max(1, Math.min(W - x, Math.round(b.w * W))),
    h: Math.max(1, Math.min(H - y, Math.round(b.h * H)))
  };
  closeCropper();
  runOCR(img, rect);
}

/* ——— Prétraitement ———
   1. recadrage à la résolution native (plafonnée à 3000 px : mémoire iPhone) ;
   2. niveaux de gris + léger flou (2 × 3×3) pour gommer le grain du capteur ;
   3. agrandissement des petits recadrages vers ~1800 px (petits caractères) ;
   4. binarisation adaptative locale (moyenne par zone via image intégrale),
      qui neutralise l'ombre de la reliure et l'éclairage inégal. */

const makeCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), type, quality);
  });
}

/* iOS plafonne la mémoire totale des canvas : on les vide après usage. */
function releaseCanvas(c) { c.width = 0; c.height = 0; }

function boxBlur3(src, w, h) {
  const tmp = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = (src[row + Math.max(0, x - 1)] + src[row + x] + src[row + Math.min(w - 1, x + 1)]) / 3;
    }
  }
  for (let y = 0; y < h; y++) {
    const up = Math.max(0, y - 1) * w;
    const mid = y * w;
    const dn = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) src[mid + x] = (tmp[up + x] + tmp[mid + x] + tmp[dn + x]) / 3;
  }
}

async function preprocessCrop(img, r) {
  const MAX_SIDE = 3000;
  const TARGET = 1800;
  const s1 = Math.min(1, MAX_SIDE / Math.max(r.w, r.h));
  const w1 = Math.max(1, Math.round(r.w * s1));
  const h1 = Math.max(1, Math.round(r.h * s1));
  const c1 = makeCanvas(w1, h1);
  const x1 = c1.getContext('2d', { willReadFrequently: true });
  x1.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, w1, h1);
  const preview = await canvasBlob(c1, 'image/jpeg', 0.85);

  let data = x1.getImageData(0, 0, w1, h1);
  let gray = new Uint8ClampedArray(w1 * h1);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
    gray[j] = (data.data[i] * 299 + data.data[i + 1] * 587 + data.data[i + 2] * 114) / 1000;
  }
  boxBlur3(gray, w1, h1);
  boxBlur3(gray, w1, h1);

  let W = w1;
  let H = h1;
  let out = c1;
  let ctx = x1;
  const k = Math.min(3, TARGET / Math.max(w1, h1));
  if (k > 1.05) {
    for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
      data.data[i] = data.data[i + 1] = data.data[i + 2] = gray[j];
    }
    x1.putImageData(data, 0, 0);
    W = Math.round(w1 * k);
    H = Math.round(h1 * k);
    out = makeCanvas(W, H);
    ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c1, 0, 0, W, H);
    releaseCanvas(c1);
    data = ctx.getImageData(0, 0, W, H);
    gray = new Uint8ClampedArray(W * H);
    for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = data.data[i];
  }

  // Image intégrale (Uint32 suffit : 3000 × 3000 × 255 < 2³²)
  const stride = W + 1;
  const integ = new Uint32Array(stride * (H + 1));
  for (let y = 0; y < H; y++) {
    let rowSum = 0;
    for (let x = 0; x < W; x++) {
      rowSum += gray[y * W + x];
      integ[(y + 1) * stride + x + 1] = integ[y * stride + x + 1] + rowSum;
    }
  }
  // Noir si nettement plus sombre que la moyenne de son voisinage.
  const rad = Math.max(12, Math.round(Math.max(W, H) / 40));
  const px = data.data;
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - rad);
    const y1 = Math.min(H - 1, y + rad);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - rad);
      const x1b = Math.min(W - 1, x + rad);
      const area = (y1 - y0 + 1) * (x1b - x0 + 1);
      const sum = integ[(y1 + 1) * stride + x1b + 1] - integ[y0 * stride + x1b + 1]
        - integ[(y1 + 1) * stride + x0] + integ[y0 * stride + x0];
      const v = gray[y * W + x] * area * 100 < sum * 85 ? 0 : 255;
      const o = (y * W + x) * 4;
      px[o] = px[o + 1] = px[o + 2] = v;
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(data, 0, 0);
  const blob = await canvasBlob(out, 'image/png');
  releaseCanvas(out);
  releaseCanvas(c1);
  return { blob, preview };
}

/* ——— Lecture ——— */
async function runOCR(img, rect) {
  // Chaque lecture a son numéro : un nouveau scan ou une annulation rend
  // caduque la lecture précédente, dont le résultat est alors ignoré.
  const run = ++ocr.run;
  const stale = () => run !== ocr.run;
  const panel = $('#ocr-panel');
  panel.hidden = false;
  $('#ocr-lines').innerHTML = '';
  $('#ocr-actions').hidden = true;
  setOcrStatus('Préparation de l’image…', true);
  panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  let step = 'prep';
  try {
    const { blob, preview } = await preprocessCrop(img, rect);
    if (stale()) return;
    if (ocr.previewURL) URL.revokeObjectURL(ocr.previewURL);
    ocr.previewURL = URL.createObjectURL(preview);
    const previewEl = $('#ocr-preview');
    previewEl.src = ocr.previewURL;
    previewEl.hidden = false;

    step = 'engine';
    setOcrStatus('Démarrage du moteur de lecture…', true);
    const worker = await getOcrWorker();
    if (stale()) return;

    step = 'read';
    setOcrStatus('Lecture du passage…', true);
    ocrProgress = (p) => { if (!stale()) setOcrStatus(`Lecture du passage… ${Math.round(p * 100)} %`, true); };
    const { data } = await worker.recognize(blob);
    if (stale()) return; // scan annulé ou remplacé entre-temps
    ocrProgress = null;

    const lines = data.text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (!lines.length) {
      setOcrStatus('Aucun texte trouvé dans le cadre. Recadrez au plus près du passage, sur une photo nette et bien éclairée.');
      showOcrActions(false);
      return;
    }
    const tip = IS_IOS ? ' Astuce : un appui long sur la photo permet aussi d’en copier le texte.' : '';
    setOcrStatus(data.confidence && data.confidence < 60
      ? 'Lecture incertaine : vérifiez les lignes, ou recadrez plus serré.' + tip
      : 'Touchez une ligne pour l’exclure ou la reprendre, puis insérez.');
    // Les débris (bords de page, taches) sont désélectionnés d'office.
    const looksJunk = (l) => {
      const letters = (l.match(/\p{L}/gu) || []).length;
      return l.length < 4 || letters / l.length < 0.5;
    };
    $('#ocr-lines').innerHTML = lines.map((l) =>
      `<button type="button" class="ocr-line${looksJunk(l) ? '' : ' on'}">${esc(l)}</button>`).join('');
    showOcrActions(true);
  } catch {
    if (step === 'read') resetOcrWorker();
    if (stale()) return;
    ocrProgress = null;
    setOcrStatus(step === 'engine'
      ? 'Le moteur de lecture n’a pas pu démarrer. Au tout premier scan, une connexion est nécessaire ; réessayez.'
      : 'Échec de la lecture. Réessayez avec une photo plus nette.');
    showOcrActions(false);
  }
}

function showOcrActions(hasLines) {
  $('#ocr-actions').hidden = false;
  $('#ocr-insert').hidden = !hasLines;
}

/* Recolle les lignes : mot coupé en fin de ligne → mot entier, sauf mots
   composés (« elle-même », « peut-être », « Jean-Paul », « a-t-il »…). */
const HYPHEN_KEEP_NEXT = new Set(['même', 'mêmes', 'être', 'dessus', 'dessous', 'delà', 'deçà', 'dedans', 'dehors',
  'devant', 'derrière', 'ci', 'là', 'bas', 'haut', 'moi', 'toi', 'lui', 'soi', 'nous', 'vous', 'elle', 'elles', 'il',
  'ils', 'on', 'en', 'y', 'le', 'la', 'uns', 'unes', 't', 'midi', 'mère', 'père', 'frère', 'sœur', 'fils', 'fille', 'chose']);
const HYPHEN_KEEP_PREV = new Set(['à', 'grand', 'demi', 'arrière', 'avant', 'vice', 'chef', 'nord', 'sud']);

function cleanOcrText(lines) {
  let out = '';
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (!out) { out = line; continue; }
    const cut = out.match(/([\p{L}\p{N}’']+)[-\u2010\u2011\u00AD¬]$/u); // trait d'union, césure
    if (cut && /^[\p{L}\p{N}]/u.test(line)) {
      const prev = cut[1].toLowerCase().replace(/'/g, '’').split('’').pop();
      const next = (line.match(/^[\p{L}’']+/u) || [''])[0].toLowerCase().replace(/'/g, '’');
      const keep = /^[\p{Lu}\p{N}]/u.test(line) || /\p{N}$/u.test(prev)
        || HYPHEN_KEEP_NEXT.has(next) || HYPHEN_KEEP_NEXT.has(next.split('’')[0])
        || HYPHEN_KEEP_PREV.has(prev);
      out = out.slice(0, -1) + (keep ? '-' : '') + line;
    } else {
      out += ' ' + line;
    }
  }
  return out.replace(/'/g, '’').replace(/ {2,}/g, ' ');
}

function insertOcrSelection() {
  const selected = $$('#ocr-lines .ocr-line.on').map((b) => b.textContent);
  if (!selected.length) { toast('Aucune ligne sélectionnée'); return; }
  const ta = $('#form-quote').text;
  const text = cleanOcrText(selected);
  ta.value = ta.value.trim() ? ta.value.trim() + '\n' + text : text;
  closeOcrPanel();
  saveDraft('quote');
  ta.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* ═══════════ ÉVÉNEMENTS ═══════════ */

function bindEvents() {
  window.addEventListener('hashchange', router);

  // Bibliothèque
  $('#btn-add-book').addEventListener('click', () => openBookForm());
  $('#search-input').addEventListener('input', (e) => { state.query = e.target.value; refresh(renderLibrary); });
  $('#library-tags').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.libraryTag = state.libraryTag === chip.dataset.tag ? null : chip.dataset.tag;
    refresh(renderLibrary);
  });
  $('#library-list').addEventListener('click', (e) => {
    const card = e.target.closest('.book-card');
    if (card) navigate('#/book/' + card.dataset.id);
  });
  // La touche « Rechercher » du clavier le referme.
  $$('input[type="search"]').forEach((input) => input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  }));

  // Citation rapide
  $('#btn-add-quote-global').addEventListener('click', quickQuote);
  $('#pick-list').addEventListener('click', (e) => {
    const row = e.target.closest('.pick-row');
    if (row) openQuoteForm(null, row.dataset.id);
  });

  // Citations (vue globale) : toucher = modifier, titre = aller au livre
  $('#quotes-search').addEventListener('input', (e) => {
    state.quotesQuery = e.target.value;
    refresh(renderQuotesView);
  });
  $('#quotes-book-filter').addEventListener('change', (e) => {
    state.quotesBook = e.target.value;
    state.quotesTag = null;
    refresh(renderQuotesView);
  });
  $('#quotes-tags').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.quotesTag = state.quotesTag === chip.dataset.tag ? null : chip.dataset.tag;
    refresh(renderQuotesView);
  });

  // Notes et citations : toucher pour modifier, glisser pour supprimer
  for (const list of [$('#quotes-list'), $('#book-tab-content'), $('#words-list')]) {
    bindSwipeToDelete(list);
    list.addEventListener('click', (e) => {
      if (e.target.closest('a')) return; // lien vers le dictionnaire
      if (Date.now() - swipeEndedAt < 450) return;
      const source = e.target.closest('.qsource');
      if (source) {
        state.bookTab = 'quotes';
        state.currentBookId = source.dataset.book;
        navigate('#/book/' + source.dataset.book);
        return;
      }
      const card = e.target.closest('.swipeable');
      if (card) openEntry(card.dataset.kind, card.dataset.id);
    });
    list.addEventListener('keydown', (e) => {
      const card = e.target.closest('.swipeable');
      if (card && e.target === card && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        openEntry(card.dataset.kind, card.dataset.id);
      }
    });
  }

  // Fiche livre
  $('#btn-back').addEventListener('click', () => history.length > 1 ? history.back() : navigate('#/library'));
  $('#btn-edit-book').addEventListener('click', () => openBookForm(bookById(state.currentBookId)));
  $('#book-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    state.bookTab = btn.dataset.tab;
    refresh(renderBook);
  });
  $('#btn-add-quote').addEventListener('click', () => openQuoteForm(null, state.currentBookId));
  $('#btn-add-note').addEventListener('click', () => openNoteForm(null, state.currentBookId));
  $('#btn-add-word-book').addEventListener('click', () => openWordForm(null, state.currentBookId));

  // Mots : liste, tri, filtres, dictionnaire préféré
  $('#btn-add-word').addEventListener('click', () => openWordForm());
  $('#words-title').addEventListener('click', onWordsTitleTap);
  $('#words-search').addEventListener('input', (e) => {
    state.wordsQuery = e.target.value;
    refresh(renderWordsView);
  });
  $('#words-sort').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.wordsSort = chip.dataset.sort;
    try { localStorage.setItem(WORDS_SORT_KEY, state.wordsSort); } catch { /* sans importance */ }
    refresh(renderWordsView);
  });
  $('#words-book-filter').addEventListener('change', (e) => {
    state.wordsBook = e.target.value;
    refresh(renderWordsView);
  });

  // Fiche d'un mot
  const wordForm = $('#form-word');
  wordForm.addEventListener('submit', saveWordForm);
  wordForm.text.addEventListener('input', () => {
    updateDupHint();
    renderCnrtlLink();
    scheduleWordLookup();
    scheduleWordSuggest();
  });
  wordForm.definition.addEventListener('input', () => {
    // Retoucher la définition du Wiktionnaire en fait « votre définition » ;
    // une définition collée garde le nom de son dictionnaire.
    if (!wordForm.definition.value.trim()) wl.source = '';
    else if (!wl.source || wl.source === 'wiktionnaire') wl.source = 'perso';
    setDefSource(wl.source);
  });
  wordForm.bookId.addEventListener('change', () => {
    syncWordBookUI(true);
    if (!$('#qpick').hidden && !qp.quote) showQuoteList();
  });
  $('#word-suggest').addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      wordForm.text.value = pick.dataset.pick;
      hideWordSuggest();
      updateDupHint();
      renderCnrtlLink();
      runWordLookup(pick.dataset.pick);
      return;
    }
    if (e.target.closest('[data-add]')) saveWordForm(new Event('submit'));
  });
  // Définition copiée sur le site du CNRTL : un toucher pour la reprendre.
  $('#def-paste').addEventListener('click', async () => {
    let text = '';
    try { text = (await navigator.clipboard.readText()) || ''; } catch { text = ''; }
    text = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) {
      toast('Copiez d’abord la définition sur le site du CNRTL, puis touchez « Coller ».');
      return;
    }
    wordForm.definition.value = text;
    wl.source = wl.lastDico === 'cnrtl' ? 'cnrtl' : 'perso';
    setDefSource(wl.source);
    setDefStatus('');
  });
  // CNRTL ouvert juste avant : la définition collée vient de là.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-dico]');
    if (a) wl.lastDico = a.dataset.dico;
  });
  // Mot pris dans une citation
  $('#word-from-quote').addEventListener('click', () => openQuotePicker());
  $('#qpick-close').addEventListener('click', closeQuotePicker);
  $('#qpick-back').addEventListener('click', showQuoteList);
  $('#qpick-use').addEventListener('click', useQuoteSelection);
  $('#qpick-list').addEventListener('click', (e) => {
    const item = e.target.closest('.qpick-item');
    const quote = item && state.quotes.find((q) => q.id === item.dataset.id);
    if (quote) showQuoteWords(quote);
  });
  $('#qpick-words').addEventListener('click', (e) => {
    const w = e.target.closest('.qw');
    if (w) onQuoteWordTap(Number(w.dataset.i));
  });
  $('#quote-to-word').addEventListener('click', () => {
    const f = $('#form-quote');
    const text = f.text.value.trim();
    if (!text) { flagField(f.text); return; }
    openWordFromQuote({ text, bookId: state.editing.quoteBookId, page: f.page.value === '' ? null : parseInt(f.page.value, 10) });
  });
  $('#def-refresh').addEventListener('click', () => {
    const term = wordForm.text.value.trim();
    if (!term) { flagField(wordForm.text); return; }
    runWordLookup(term, true);
  });
  $('#def-status').addEventListener('click', (e) => {
    const b = e.target.closest('[data-suggest]');
    if (!b) return;
    wordForm.text.value = b.dataset.suggest;
    updateDupHint();
    renderCnrtlLink();
    runWordLookup(b.dataset.suggest, true);
  });
  $('#word-dup').addEventListener('click', (e) => {
    const b = e.target.closest('[data-open-word]');
    const word = b && state.words.find((w) => w.id === b.dataset.openWord);
    if (word) openWordForm(word);
  });
  $('#btn-delete-word').addEventListener('click', () => {
    const id = state.editing.wordId;
    closeSheet({ discard: true });
    if (id) deleteWord(id);
  });

  // Monde caché
  $('#secret-again').addEventListener('click', renderSecretText);
  $('#secret-exit').addEventListener('click', closeSecretWorld);
  $('#secret-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(secretPlain);
      toast('Texte copié');
    } catch {
      toast('Copie impossible sur cet appareil');
    }
  });
  $('#secret-text').addEventListener('click', (e) => {
    const span = e.target.closest('.sw');
    const word = span && state.words.find((w) => w.id === span.dataset.id);
    if (word) toast(`${word.text} : ${defOneLine(word) || 'sens inconnu… même ici.'}`);
  });
  $('#btn-export-book').addEventListener('click', () => exportMarkdown(bookById(state.currentBookId)));

  // Compte : session, ancienne version, sauvegarde et exports, installation
  $('#btn-logout').addEventListener('click', logout);
  $('#btn-delete-all').addEventListener('click', deleteAllData);
  $('#btn-install').addEventListener('click', promptInstall);
  $('#btn-import-local').addEventListener('click', importLocal);
  $('#btn-clear-local').addEventListener('click', () => {
    if (confirm('Vider l’ancien stockage de cet appareil ?\n\nVos données sont déjà dans votre compte : seule cette copie locale est supprimée.')) clearLegacy();
  });
  $('#import-card-go').addEventListener('click', importLocal);
  $('#import-card-later').addEventListener('click', () => {
    legacyCardLater = true;
    renderImportCard();
    toast('L’import reste possible depuis l’onglet Compte');
  });
  $('#btn-export-md').addEventListener('click', () => {
    if (!state.books.length) { toast('Rien à exporter pour le moment'); return; }
    exportMarkdown();
  });
  $('#btn-export-words').addEventListener('click', exportWordsMarkdown);
  $('#btn-export-json').addEventListener('click', exportJSON);
  $('#btn-update-app').addEventListener('click', forceUpdate);
  $('#btn-import-json').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importJSONFile(file);
  });

  // Feuilles modales
  $('#backdrop').addEventListener('click', () => closeSheet());
  $$('[data-cancel]').forEach((b) => b.addEventListener('click', () => closeSheet({ discard: true })));
  $$('.sheet').forEach(bindSheetDrag);
  $$('[data-clear-draft]').forEach((b) => b.addEventListener('click', () => {
    const kind = b.dataset.clearDraft;
    if (!draftBase[kind]) return;
    writeEntryForm(kind, draftBase[kind]);
    try { localStorage.removeItem(draftKey(kind)); } catch { /* rien à faire */ }
    $(`#${kind}-draft`).hidden = true;
  }));
  $('#form-note').addEventListener('input', () => scheduleDraftSave('note'));
  $('#form-quote').addEventListener('input', () => scheduleDraftSave('quote'));

  $('#field-type').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    state.form.type = b.dataset.value;
    setSegmented('field-type', state.form.type);
    syncTypeUI();
    if (state.form.type !== 'book') hideBookSuggest();
    renderCoverField();
  });
  $('#field-status').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    state.form.status = b.dataset.value;
    setSegmented('field-status', state.form.status);
    syncRatingUI();
  });
  $('#rating-stars').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const v = Number(b.dataset.v);
    state.form.rating = state.form.rating === v ? 0 : v;
    syncRatingUI();
  });
  $('#book-more-btn').addEventListener('click', () => setBookDetails($('#book-more').hidden));
  // Couverture : suggestions Google Books pendant la frappe du titre, ou photo
  const bookForm = $('#form-book');
  bookForm.title.addEventListener('input', () => { renderCoverField(); scheduleBookSuggest(); });
  bookForm.show.addEventListener('input', renderCoverField);
  $('#book-suggest').addEventListener('click', (e) => {
    const item = e.target.closest('.gb-item');
    if (item) pickBookSuggestion(Number(item.dataset.i));
  });
  $('#cover-photo').addEventListener('click', () => $('#cover-file').click());
  $('#cover-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) takeCoverPhoto(file);
  });
  $('#cover-remove').addEventListener('click', () => { state.form.cover = null; renderCoverField(); });
  // Couverture qui ne charge pas (hors ligne, lien mort) : les initiales reviennent.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    const cover = img.closest('.cover');
    if (cover) { cover.classList.remove('has-img'); img.remove(); return; }
    if (img.closest('.gb-item')) img.replaceWith(Object.assign(document.createElement('span'), { className: 'gb-noimg' }));
  }, true);
  bindTagSuggest($('#form-book').tags, $('#book-tag-suggest'), bookTagPool);
  bindTagSuggest($('#form-quote').tags, $('#quote-tag-suggest'), quoteTagPool);
  $('#form-book').addEventListener('submit', saveBookForm);
  $('#btn-delete-book').addEventListener('click', deleteCurrentBook);
  $('#form-note').addEventListener('submit', saveNoteForm);
  $('#btn-delete-note').addEventListener('click', () => {
    const id = state.editing.noteId;
    closeSheet({ discard: true });
    if (id) deleteNote(id);
  });
  $('#form-quote').addEventListener('submit', saveQuoteForm);
  $('#btn-delete-quote').addEventListener('click', () => {
    const id = state.editing.quoteId;
    closeSheet({ discard: true });
    if (id) deleteQuote(id);
  });
  // La page pré-remplie se remplace d'un geste : tout est sélectionné.
  $('#form-quote').page.addEventListener('focus', (e) => {
    setTimeout(() => { try { e.target.select(); } catch { /* champ numérique */ } }, 0);
  });

  // Dictée & scan
  const dictateQuoteBtn = $('#btn-dictate-quote');
  const dictateNoteBtn = $('#btn-dictate-note');
  // Sur iOS le bouton reste utile même sans Web Speech (bascule clavier).
  if (!speechSupported() && !IS_IOS) {
    dictateQuoteBtn.hidden = true;
    dictateNoteBtn.hidden = true;
  }
  dictateQuoteBtn.addEventListener('click', () => toggleDictation($('#form-quote').text, dictateQuoteBtn));
  dictateNoteBtn.addEventListener('click', () => toggleDictation($('#form-note').text, dictateNoteBtn));
  $('#btn-scan-camera').addEventListener('click', () => { stopDictation(); $('#ocr-camera').click(); });
  $('#btn-scan-gallery').addEventListener('click', () => { stopDictation(); $('#ocr-file').click(); });
  for (const input of [$('#ocr-camera'), $('#ocr-file')]) {
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) openCropper(file);
    });
  }
  bindCropper();
  $('#crop-cancel').addEventListener('click', closeCropper);
  $('#crop-all').addEventListener('click', () => { ocr.box = { x: 0, y: 0, w: 1, h: 1 }; layoutCrop(); });
  $('#crop-ok').addEventListener('click', readCrop);
  $('#ocr-lines').addEventListener('click', (e) => {
    const line = e.target.closest('.ocr-line');
    if (line) line.classList.toggle('on');
  });
  $('#ocr-insert').addEventListener('click', insertOcrSelection);
  $('#ocr-recrop').addEventListener('click', () => { if (ocr.url) showCropper(); });
  $('#ocr-cancel').addEventListener('click', closeOcrPanel);

  // Toast : bouton « Annuler »
  $('#toast-action').addEventListener('click', () => {
    const action = toastAction;
    hideToast();
    if (action) action.run();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#secret').hidden) closeSecretWorld();
    else if (!$('#cropper').hidden) closeCropper();
    else closeSheet();
  });

  // Définitions manquantes : au retour du réseau
  window.addEventListener('online', fillMissingDefinitions);

  // Clavier iOS : la feuille suit la zone visible.
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', syncViewport);
    visualViewport.addEventListener('scroll', syncViewport);
    syncViewport();
  }

  // Verrouille le zoom par pincement sur iOS (Safari ignore user-scalable=no).
  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
}

/* ═══════════ SYNCHRONISATION ═══════════
   Les changements reçus de Firestore (premier chargement, autre appareil,
   écho de nos propres écritures) mettent à jour la copie en mémoire. Un
   élément déjà présent est modifié sur place : un formulaire ouvert garde
   ses références. L'écran n'est redessiné que si quelque chose a vraiment
   changé. */

let appStarted = false;

/* Forme comparable d'un élément : clés triées, sans valeur indéfinie. */
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().filter((key) => x[key] !== undefined).map((key) => [key, x[key]]))
  : x));

function applyRemote(store, changes, { first }) {
  let list = state[store];
  let dirty = false;
  if (first) {
    // Premier instantané (ou reprise après une panne) : il fait foi.
    const ids = new Set(changes.map((c) => c.id));
    const kept = list.filter((x) => ids.has(x.id));
    if (kept.length !== list.length) { list = state[store] = kept; dirty = true; }
  }
  const index = new Map(list.map((x, i) => [x.id, i]));
  const gone = new Set();
  for (const c of changes) {
    const i = index.get(c.id);
    if (c.type === 'removed') {
      if (i !== undefined) { gone.add(c.id); dirty = true; }
      continue;
    }
    if (i === undefined) {
      index.set(c.id, list.length);
      list.push(c.data);
      dirty = true;
      continue;
    }
    const cur = list[i];
    if (canon(cur) === canon(c.data)) continue;
    for (const k of Object.keys(cur)) if (!(k in c.data)) delete cur[k];
    Object.assign(cur, c.data);
    dirty = true;
  }
  if (gone.size) state[store] = list.filter((x) => !gone.has(x.id));
  if (dirty) scheduleSyncRender();
}

let syncRenderQueued = false;
function scheduleSyncRender() {
  if (!appStarted || syncRenderQueued) return;
  syncRenderQueued = true;
  requestAnimationFrame(() => {
    syncRenderQueued = false;
    refresh(render);
    // Fiche d'un mot ouverte : un doublon peut arriver d'un autre appareil.
    if (openedSheet && openedSheet.id === 'sheet-word') updateDupHint();
  });
}

function onSyncChange() {
  if (appStarted && state.route === 'account') renderSyncLine();
}

const syncErrorsShown = new Map();
let pendingSyncError = null;

function syncErrorMessage(code) {
  if (code === 'permission-denied') return 'Le serveur refuse l’accès à vos données. Reconnectez-vous ou réessayez plus tard.';
  if (code === 'resource-exhausted') return 'Le serveur est très sollicité aujourd’hui : vos changements partiront un peu plus tard.';
  return 'Synchronisation momentanément impossible. Vos changements sont gardés sur l’appareil.';
}

function onSyncError(err) {
  const code = (err && err.code) || 'unknown';
  if (code === 'unauthenticated') { endSession(); return; }
  // Un message par type d'erreur, pas une avalanche.
  if (Date.now() - (syncErrorsShown.get(code) || 0) < 30000) return;
  syncErrorsShown.set(code, Date.now());
  const msg = syncErrorMessage(code);
  if (appStarted) toast(msg); else pendingSyncError = msg;
}

/* ═══════════ COMPTE ═══════════
   Connexion par e-mail et mot de passe : les comptes sont ceux d'À tester.
   Les champs sont reconnus par le trousseau iCloud et le gestionnaire de
   mots de passe d'Android. */

const login = { mode: 'signin', busy: false };

function showSplash() { $('#splash').classList.remove('gone'); }
function hideSplash() { $('#splash').classList.add('gone'); }

function showLogin() {
  const root = document.documentElement;
  root.classList.remove('booting');
  root.classList.add('signed-out');
  $('#login').hidden = false;
  hideSplash();
  setLoginBusy(false);
  // Données de l'ancienne version sur cet appareil : on rassure avant la connexion.
  legacySummary().then((sum) => {
    if (!sum) return;
    const el = $('#login-legacy');
    el.textContent = `Vos données actuelles (${describeCounts(sum)}) restent sur cet appareil : vous pourrez les importer dans votre compte juste après la connexion.`;
    el.hidden = false;
  }).catch(() => {});
}

function sayLogin(text, tone = 'error') {
  const el = $('#login-msg');
  el.textContent = text;
  el.classList.toggle('ok', tone === 'ok');
}

function setLoginBusy(on, label = '') {
  login.busy = on;
  const btn = $('#login-submit');
  btn.disabled = on;
  btn.textContent = on ? label : (login.mode === 'signup' ? 'Créer mon compte' : 'Se connecter');
}

function setLoginMode(mode) {
  login.mode = mode;
  const signup = mode === 'signup';
  $$('#login-mode .seg-btn').forEach((b) => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  $('#form-login').password.autocomplete = signup ? 'new-password' : 'current-password';
  $('#pw-hint').hidden = !signup;
  $('#login-forgot').hidden = signup;
  setLoginBusy(false);
  sayLogin('');
}

async function submitLogin(e) {
  e.preventDefault();
  if (login.busy) return;
  const form = $('#form-login');
  const email = form.email.value.trim();
  const password = form.password.value;
  if (!email) { sayLogin('Indiquez votre adresse e-mail.'); flagField(form.email); return; }
  if (!password) { sayLogin('Indiquez votre mot de passe.'); flagField(form.password); return; }
  if (login.mode === 'signup' && password.length < MIN_PASSWORD) {
    sayLogin(`Choisissez un mot de passe d’au moins ${MIN_PASSWORD} caractères.`);
    flagField(form.password);
    return;
  }
  if (!navigator.onLine) { sayLogin('Pas de connexion : la connexion à votre compte demande le réseau.'); return; }
  sayLogin('');
  setLoginBusy(true, login.mode === 'signup' ? 'Création du compte…' : 'Connexion…');
  try {
    if (login.mode === 'signup') await signUp(email, password);
    else await signIn(email, password);
    // La suite (chargement des données) part de watchAuth.
  } catch (err) {
    setLoginBusy(false);
    sayLogin(authMessage(err));
  }
}

async function forgotPassword() {
  if (login.busy) return;
  const input = $('#form-login').email;
  const email = input.value.trim();
  if (!email) {
    sayLogin('Indiquez votre adresse e-mail ci-dessus, puis touchez « Mot de passe oublié ? ».');
    flagField(input);
    return;
  }
  if (!navigator.onLine) { sayLogin('Pas de connexion : réessayez quand le réseau sera revenu.'); return; }
  login.busy = true;
  try {
    await resetPassword(email);
    sayLogin(`Si un compte existe pour ${email}, un e-mail pour choisir un nouveau mot de passe vient de partir. Pensez à regarder dans les indésirables.`, 'ok');
  } catch (err) {
    sayLogin(authMessage(err));
  } finally {
    login.busy = false;
  }
}

function bindLogin() {
  const form = $('#form-login');
  form.addEventListener('submit', submitLogin);
  $('#login-mode').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b && b.dataset.mode !== login.mode) setLoginMode(b.dataset.mode);
  });
  $('#login-forgot').addEventListener('click', forgotPassword);
  $('#pw-toggle').addEventListener('click', () => {
    const show = form.password.type === 'password';
    form.password.type = show ? 'text' : 'password';
    $('#pw-toggle').textContent = show ? 'Masquer' : 'Afficher';
    $('#pw-toggle').setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
  });
  form.email.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); form.password.focus(); }
  });
}

/* Déconnexion (réglages, session expirée ou fermée dans un autre onglet) :
   ce que l'appareil garde du compte est effacé (cache Firestore de Lecture,
   brouillons), puis l'app repart de l'écran de connexion. Le modèle de
   reconnaissance de texte, qui n'a rien de personnel, reste. */
let ending = null;
function endSession() {
  if (!ending) {
    ending = (async () => {
      appStarted = false;
      await db.wipeLocalCache();
      await signOutUser().catch(() => {});
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith(DRAFT_PREFIX)) localStorage.removeItem(k);
      } catch { /* stockage indisponible */ }
      location.reload();
    })();
  }
  return ending;
}

async function logout() {
  const btn = $('#btn-logout');
  if (btn.disabled) return;
  btn.disabled = true;
  const sent = await db.flushed(2500);
  const question = sent
    ? 'Se déconnecter ?\n\nVos données restent dans votre compte : elles sont effacées de cet appareil jusqu’à votre prochaine connexion.'
    : 'Certains changements n’ont pas encore été envoyés (pas de connexion). Si vous vous déconnectez maintenant, ils seront perdus.\n\nSe déconnecter quand même ?';
  if (!confirm(question)) { btn.disabled = false; return; }
  btn.textContent = 'Déconnexion…';
  await endSession();
}

/* ═══════════ ANCIENNE VERSION ET IMPORT ═══════════
   Les données des versions précédentes restent dans le stockage local de
   l'appareil tant qu'on ne le vide pas. « Importer mes données locales » les
   envoie dans le compte sans doublon, vérifie sur le serveur que tout y est,
   puis propose de vider l'ancien stockage. Un fichier de sauvegarde JSON
   passe par le même chemin. */

const IMPORTED_KEY = 'lecture:ancien-importe';
let legacy = null;              // nombre d'éléments par type, ou null
let legacyCardLater = false;    // « Plus tard » : carte retirée jusqu'au prochain lancement
let importing = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Le serveur a-t-il répondu au moins une fois depuis l'ouverture ? (15 s au plus) */
async function serverReached() {
  for (let i = 0; i < 60 && !db.syncState().server; i++) await sleep(250);
  return db.syncState().server;
}

/* Date de l'import de l'ancien stockage dans ce compte, s'il a été fait. */
function legacyImportedAt() {
  const user = currentUser();
  try {
    const v = JSON.parse(localStorage.getItem(IMPORTED_KEY) || 'null');
    return v && user && v.uid === user.uid ? v.at : null;
  } catch {
    return null;
  }
}

async function refreshLegacy() {
  legacy = await legacySummary().catch(() => null);
  renderImportCard();
  if (state.route === 'account') renderSettings();
}

function renderImportCard() {
  const show = Boolean(legacy) && !legacyImportedAt() && !legacyCardLater;
  $('#import-card').hidden = !show;
  if (show) {
    $('#import-card-text').textContent = `Sur cet appareil : ${describeCounts(legacy)}. Importez ces données dans votre compte pour les retrouver sur tous vos appareils.`;
  }
}

function setImportBusy(on) {
  importing = on;
  for (const id of ['#import-card-go', '#btn-import-local']) {
    $(id).disabled = on;
    $(id).textContent = on ? 'Import en cours…' : 'Importer mes données locales';
  }
  $('#btn-import-json').disabled = on;
}

/* Fusionne des données dans le compte, attend que le serveur ait tout reçu,
   puis vérifie en relisant le compte sur le serveur. Renvoie le bilan, ou
   null si l'import n'a pas abouti (le message est déjà affiché). */
async function importIntoAccount(data) {
  if (importing) return null;
  if (!navigator.onLine) {
    alert('L’import demande une connexion : réessayez une fois en ligne. Rien n’a été modifié.');
    return null;
  }
  setImportBusy(true);
  try {
    // Le compte doit avoir été lu sur le serveur, pour comparer avec ses versions à jour.
    if (!await serverReached()) {
      alert('Le serveur ne répond pas pour le moment : réessayez dans un instant. Rien n’a été modifié.');
      return null;
    }
    const plan = await planImport(data, state);
    const sum = (k) => db.STORES.reduce((n, s) => n + plan.counts[s][k], 0);
    const totals = Object.fromEntries(db.STORES.map((s) => [s, plan.counts[s].total]));
    if (!sum('total')) { toast('Rien à importer'); return null; }
    toast('Import en cours…');
    if (await sendImport(plan) !== 'sent') {
      alert('L’envoi prend plus de temps que prévu : il continue en arrière-plan. Relancez l’import un peu plus tard pour le vérifier (il n’ajoutera aucun doublon).');
      return null;
    }
    const check = await verifyImport(plan);
    if (!check.ok) {
      alert(`Import incomplet : ${check.missing} élément${check.missing > 1 ? 's manquent' : ' manque'} dans votre compte. Relancez l’import : il n’ajoutera aucun doublon.`);
      return null;
    }
    hideToast();
    return { totals, added: sum('added'), updated: sum('updated'), same: sum('same') };
  } catch (err) {
    console.error(err);
    alert('L’import n’a pas abouti' + (navigator.onLine ? '' : ' (connexion perdue)') + '. Rien n’a été supprimé : vous pouvez le relancer sans risque de doublon.');
    return null;
  } finally {
    setImportBusy(false);
  }
}

async function importLocal() {
  if (importing) return;
  const data = await readLegacy();
  if (!data) { await refreshLegacy(); toast('L’ancien stockage est vide'); return; }
  const res = await importIntoAccount(data);
  if (!res) return;
  try {
    localStorage.setItem(IMPORTED_KEY, JSON.stringify({ uid: currentUser().uid, at: new Date().toISOString() }));
  } catch { /* stockage indisponible */ }
  renderImportCard();
  if (state.route === 'account') renderSettings();
  if (confirm(`Import vérifié : tout est dans votre compte (${describeCounts(res.totals)}).\n\nVider l’ancien stockage de cet appareil ? Vos données restent dans votre compte.`)) {
    await clearLegacy();
  } else {
    toast('Import vérifié. L’ancien stockage pourra être vidé depuis l’onglet Compte.');
  }
}

async function clearLegacy() {
  const ok = await deleteLegacy();
  toast(ok ? 'Ancien stockage vidé' : 'Impossible de le vider maintenant : fermez les autres fenêtres de Lecture et réessayez.');
  await refreshLegacy();
}

/* ═══════════ COMPTE : réglages ═══════════ */

/* « Supprimer toutes mes données » : livres, notes, citations et mots de
   Lecture, dans le compte, donc sur tous les appareils. Le compte lui-même
   reste (il sert aussi à À tester), comme l'ancien stockage de l'appareil,
   qui a son propre bouton. Double confirmation ; en ligne seulement, pour
   vérifier sur le serveur que tout est parti. */
let deleting = false;

async function deleteAllData() {
  if (deleting || importing) return;
  const counts = Object.fromEntries(db.STORES.map((s) => [s, state[s].length]));
  if (!Object.values(counts).some(Boolean)) { toast('Votre compte Lecture est déjà vide'); return; }
  if (!confirm(`Supprimer toutes vos données de Lecture (${describeCounts(counts)}) ?\n\nElles disparaîtront de votre compte, sur tous vos appareils. Votre compte reste, avec vos données À tester.\n\nConseil : faites d’abord « Sauvegarder tout (JSON) ».`)) return;
  if (!confirm('Dernière vérification : la suppression est définitive.\n\nTout supprimer ?')) return;
  if (!navigator.onLine) {
    alert('La suppression demande une connexion : réessayez une fois en ligne. Rien n’a été supprimé.');
    return;
  }
  const btn = $('#btn-delete-all');
  deleting = true;
  btn.disabled = true;
  btn.textContent = 'Suppression en cours…';
  try {
    if (!await serverReached()) {
      alert('Le serveur ne répond pas pour le moment : réessayez dans un instant. Rien n’a été supprimé.');
      return;
    }
    // Ce que l'app a en mémoire, plus ce que le serveur aurait en plus.
    const ops = [];
    for (const store of db.STORES) {
      const ids = new Set(state[store].map((x) => x.id));
      for (const id of (await db.serverDocs(store)).keys()) ids.add(id);
      for (const id of ids) ops.push({ type: 'delete', store, id });
    }
    let timer;
    const sent = await Promise.race([
      db.commit(ops).then(() => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), 60000); })
    ]);
    clearTimeout(timer);
    let left = 0;
    if (sent) for (const store of db.STORES) left += (await db.serverDocs(store)).size;
    if (!sent || left) {
      alert('La suppression n’est pas allée jusqu’au bout. Relancez-la dans un instant.');
      return;
    }
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(DRAFT_PREFIX)) localStorage.removeItem(k);
      localStorage.removeItem(IMPORTED_KEY); // l'ancien stockage pourra être réimporté
    } catch { /* stockage indisponible */ }
    renderImportCard();
    toast('Toutes vos données de Lecture ont été supprimées');
  } catch (err) {
    console.error(err);
    alert('La suppression n’a pas abouti' + (navigator.onLine ? '' : ' (connexion perdue)') + '. Relancez-la dans un instant.');
  } finally {
    deleting = false;
    btn.disabled = false;
    btn.textContent = 'Supprimer toutes mes données';
  }
}

/* ——— Installation ———
   Android (Chrome) : l'app s'installe comme une vraie application, pas comme
   un simple raccourci qui rouvrirait Chrome. Le manifeste n'a pas d'« id » :
   son identité est son adresse de départ (/lecture/), distincte d'À tester
   sur le même domaine (leçon d'À tester 2.0.4). Chrome signale qu'il peut
   l'installer (beforeinstallprompt) : bouton dans Compte, et une proposition
   unique après la connexion. Sur iPhone, l'installation passe par Safari. */
const INSTALL_OFFERED_KEY = 'lecture:installation-proposee';
let installPrompt = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  renderInstall();
  offerInstallOnce();
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  renderInstall();
});

async function promptInstall() {
  if (!installPrompt) return;
  const ev = installPrompt;
  installPrompt = null;
  ev.prompt();
  try { await ev.userChoice; } catch { /* rien */ }
  renderInstall();
}

function offerInstallOnce() {
  if (!appStarted || !installPrompt) return;
  try {
    if (localStorage.getItem(INSTALL_OFFERED_KEY)) return;
    localStorage.setItem(INSTALL_OFFERED_KEY, '1');
  } catch { return; }
  setTimeout(() => {
    if (installPrompt && !openedSheet) toast('Installer Lecture comme une application ?', { label: 'Installer', run: promptInstall });
  }, 1500);
}

function renderInstall() {
  const btn = $('#btn-install');
  const hint = $('#install-hint');
  if (!btn) return;
  btn.hidden = !installPrompt;
  // iPhone dans Safari : pas d'invite possible, on explique.
  const iosTip = IS_IOS && !isStandalone();
  hint.hidden = !iosTip;
  if (iosTip) hint.textContent = 'Pour installer l’app : dans Safari, Partager › Sur l’écran d’accueil.';
}

function renderSettings() {
  const user = currentUser();
  $('#account-email').textContent = user ? user.email : '';
  renderSyncLine();
  renderInstall();
  $('#legacy-section').hidden = !legacy;
  if (legacy) {
    const at = legacyImportedAt();
    $('#legacy-summary').textContent = `Sur cet appareil : ${describeCounts(legacy)}.`
      + (at ? ` Ces données ont été importées dans votre compte le ${fmtDate(at)}.` : ' Ces données ne sont pas encore dans votre compte.');
    $('#btn-clear-local').hidden = !at;
  }
  $('#version-line').textContent = 'Lecture — version ' + APP_VERSION;
}

function renderSyncLine() {
  const s = db.syncState();
  const offline = !navigator.onLine;
  let text;
  if (offline) {
    text = s.pending
      ? 'Hors connexion : vos derniers changements partiront au retour du réseau.'
      : 'Hors connexion : vos données restent disponibles sur cet appareil.';
  } else if (s.pending) {
    text = 'Envoi de vos changements…';
  } else {
    text = s.server ? 'À jour avec votre compte.' : 'Connexion au serveur…';
  }
  const el = $('#sync-line');
  el.textContent = text;
  el.classList.toggle('warn', offline || s.pending);
}

/* ═══════════ DÉMARRAGE ═══════════
   La session Firebase d'abord (gardée d'une ouverture à l'autre, même hors
   ligne) : écran de connexion, ou chargement des données du compte puis
   affichage de l'app. */

let sessionStarted = false;

function fatal(err) {
  console.error(err);
  const splash = $('#splash');
  splash.classList.remove('gone');
  splash.classList.add('failed');
  splash.innerHTML = `<div class="splash-msg"><h2>Démarrage impossible</h2>
    <p>${esc(String((err && err.message) || err))}</p>
    <button type="button" class="primary-btn" onclick="location.reload()">Réessayer</button></div>`;
}

async function startApp(user) {
  // Données du compte : cache local d'abord, serveur ensuite.
  await db.start(user.uid, { onChange: applyRemote, onSync: onSyncChange, onError: onSyncError });
  try {
    const sort = localStorage.getItem(WORDS_SORT_KEY);
    if (['recent', 'old', 'az', 'za', 'book'].includes(sort)) state.wordsSort = sort;
  } catch { /* stockage bloqué */ }
  bindEvents();
  $('#version-line').textContent = 'Lecture — version ' + APP_VERSION;
  appStarted = true;
  document.documentElement.classList.remove('booting', 'signed-out');
  $('#login').hidden = true;
  router();
  hideSplash();
  if (pendingSyncError) { toast(pendingSyncError); pendingSyncError = null; }

  // Demande au navigateur de ne pas purger le stockage local (cache hors ligne).
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  // Mots notés hors ligne : définitions cherchées au démarrage et au retour dans l'app.
  setTimeout(fillMissingDefinitions, 2000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') fillMissingDefinitions();
  });
  for (const ev of ['online', 'offline']) window.addEventListener(ev, onSyncChange);

  refreshLegacy();
  offerInstallOnce();
  // Clé Google Books (couvertures) : config/googlebooks, saisie dans la console.
  db.configDoc('googlebooks').then((c) => setBooksKey(c && c.apiKey));
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  // updateViaCache:'none' : sw.js toujours revérifié sur le réseau.
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      reg.update().catch(() => {});
      // Revérifie à chaque retour au premier plan (lancement d'app iOS).
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch(() => {});
  // Nouvelle version aux commandes : rechargement, mais pas pendant une
  // saisie (sauf à la toute première installation, où rien ne change).
  let hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    updatePending = true;
    applyPendingUpdate();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') applyPendingUpdate();
  });
}

async function boot() {
  bindLogin();
  registerSW();
  // Effacement du cache laissé en suspens par une déconnexion (autre onglet ouvert).
  await db.pendingWipe().catch(() => {});
  watchAuth((user) => {
    if (user) {
      if (sessionStarted) return;
      sessionStarted = true;
      $('#login').hidden = true;
      showSplash();
      startApp(user).catch(fatal);
    } else if (sessionStarted) {
      endSession(); // session fermée ailleurs ou expirée
    } else {
      showLogin();
    }
  });
}

boot();
