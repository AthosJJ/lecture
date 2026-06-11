import * as db from './db.js';

/* Synchroniser avec VERSION dans sw.js à chaque mise à jour. */
const APP_VERSION = '5';

/* ——— État en mémoire (rechargé depuis IndexedDB au démarrage) ——— */
const state = {
  books: [],
  notes: [],
  quotes: [],
  route: 'library',
  currentBookId: null,
  bookTab: 'notes',
  query: '',
  libraryTag: null,
  quotesBook: '',
  quotesTag: null,
  editing: { bookId: null, noteId: null, quoteId: null },
  form: { type: 'book', status: 'toread', rating: 0 }
};

const STATUS_LABELS = { toread: 'À lire', reading: 'En cours', done: 'Terminé' };
const STATUS_ORDER = ['reading', 'toread', 'done'];

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

function bookById(id) { return state.books.find((b) => b.id === id); }
function notesOf(id) { return state.notes.filter((n) => n.bookId === id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
function quotesOf(id) { return state.quotes.filter((q) => q.bookId === id).sort((a, b) => (a.page ?? 1e9) - (b.page ?? 1e9)); }

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  // Les messages longs restent affichés plus longtemps.
  const duration = Math.min(6000, Math.max(2200, msg.length * 55));
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

/* ——— Routage par hash (le geste retour iOS fonctionne) ——— */
function navigate(hash) { location.hash = hash; }

function router() {
  const hash = location.hash || '#/library';
  const m = hash.match(/^#\/book\/(.+)$/);
  if (m && bookById(m[1])) {
    state.route = 'book';
    state.currentBookId = m[1];
  } else if (hash === '#/quotes') {
    state.route = 'quotes';
  } else if (hash === '#/stats') {
    state.route = 'stats';
  } else {
    state.route = 'library';
  }
  render();
}

function render() {
  $$('.view').forEach((v) => v.classList.remove('active'));
  $('#tabbar').classList.toggle('hidden', state.route === 'book');
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.route === state.route));

  if (state.route === 'library') { $('#view-library').classList.add('active'); renderLibrary(); }
  if (state.route === 'quotes') { $('#view-quotes').classList.add('active'); renderQuotesView(); }
  if (state.route === 'stats') { $('#view-stats').classList.add('active'); renderStats(); }
  if (state.route === 'book') { $('#view-book').classList.add('active'); renderBook(); }
  window.scrollTo(0, 0);
}

/* ═══════════ ÉCRAN BIBLIOTHÈQUE ═══════════ */

function bookCard(book, i, matchBadge) {
  const p = pct(book);
  const hue = hueFromString(book.title);
  return `
  <article class="card book-card" data-id="${book.id}" style="animation-delay:${Math.min(i * 35, 350)}ms">
    <div class="cover ${book.type === 'article' ? 'article' : ''}" style="--h:${hue}"><span>${esc(initials(book.title))}</span></div>
    <div class="book-info">
      <h3>${esc(book.title)}</h3>
      ${book.author ? `<p class="author">${esc(book.author)}</p>` : ''}
      ${p !== null && book.status !== 'toread' ? `
      <div class="progress-row">
        <div class="progress"><i style="width:${p}%"></i></div>
        <span class="progress-label">${book.currentPage || 0}/${book.totalPages}</span>
      </div>` : ''}
      <div class="badges">
        ${book.type === 'article' ? '<span class="badge">Article</span>' : ''}
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
      <p>Touchez + pour ajouter votre premier livre ou article.</p>
    </div>`;
    return;
  }

  // Recherche globale : titres, auteurs, tags, notes et citations
  if (q) {
    const results = [];
    for (const b of books) {
      const inBook = (b.title + ' ' + (b.author || '') + ' ' + (b.tags || []).join(' ')).toLowerCase().includes(q);
      const inNote = notesOf(b.id).some((n) => n.text.toLowerCase().includes(q));
      const inQuote = quotesOf(b.id).some((qt) => qt.text.toLowerCase().includes(q));
      if (inBook || inNote || inQuote) {
        results.push({ book: b, badge: inBook ? null : (inNote ? 'trouvé dans les notes' : 'trouvé dans les citations') });
      }
    }
    listEl.innerHTML = results.length
      ? `<h2 class="section-title">Résultats <span class="count">· ${results.length}</span></h2>`
        + results.map((r, i) => bookCard(r.book, i, r.badge)).join('')
      : `<div class="empty"><h3>Aucun résultat</h3><p>Rien ne correspond à « ${esc(state.query)} ».</p></div>`;
    return;
  }

  // Classement par statut
  const byRecent = (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '');
  listEl.innerHTML = STATUS_ORDER.map((status) => {
    const group = books.filter((b) => b.status === status).sort(byRecent);
    if (!group.length) return '';
    return `<h2 class="section-title">${STATUS_LABELS[status]} <span class="count">· ${group.length}</span></h2>`
      + group.map((b, i) => bookCard(b, i)).join('');
  }).join('') || `<div class="empty"><h3>Aucun livre</h3><p>Aucun livre ne porte ce tag.</p></div>`;
}

/* ═══════════ ÉCRAN CITATIONS ═══════════ */

function quoteCard(qt, i, withSource = true) {
  const book = bookById(qt.bookId);
  return `
  <blockquote class="card quote-card" data-id="${qt.id}" data-book="${qt.bookId}" style="animation-delay:${Math.min(i * 35, 350)}ms">
    <span class="qmark">“</span>
    <p class="qtext">${esc(qt.text)}</p>
    <footer class="entry-foot">
      <span>${withSource && book ? `<span class="qsource">${esc(book.title)}</span> · ` : ''}${qt.page != null && qt.page !== '' ? `p.&nbsp;${esc(qt.page)}` : 'page non précisée'}</span>
      ${(qt.tags || []).length ? `<span class="tagline">${qt.tags.map((t) => `<span class="minitag">#${esc(t)}</span>`).join('')}</span>` : ''}
      <span class="spacer"></span>
      ${withSource ? '' : `<button class="q-edit" data-id="${qt.id}">Modifier</button><button class="del q-del" data-id="${qt.id}">Suppr.</button>`}
    </footer>
  </blockquote>`;
}

function renderQuotesView() {
  // Filtre par livre
  const sel = $('#quotes-book-filter');
  const bookIds = [...new Set(state.quotes.map((q) => q.bookId))];
  const options = bookIds.map(bookById).filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title, 'fr'))
    .map((b) => `<option value="${b.id}" ${state.quotesBook === b.id ? 'selected' : ''}>${esc(b.title)}</option>`);
  sel.innerHTML = `<option value="">Tous les livres</option>` + options.join('');

  // Filtre par tag
  let quotes = state.quotes.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (state.quotesBook) quotes = quotes.filter((q) => q.bookId === state.quotesBook);

  const tags = [...new Set(quotes.flatMap((q) => q.tags || []))].sort();
  const chipsEl = $('#quotes-tags');
  chipsEl.hidden = tags.length === 0;
  chipsEl.innerHTML = tags.map((t) =>
    `<button class="chip ${state.quotesTag === t ? 'active' : ''}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('');

  if (state.quotesTag) quotes = quotes.filter((q) => (q.tags || []).includes(state.quotesTag));

  $('#quotes-list').innerHTML = quotes.length
    ? quotes.map((q, i) => quoteCard(q, i)).join('')
    : `<div class="empty">
        <span class="glyph">”</span>
        <h3>Aucune citation</h3>
        <p>Ajoutez des citations depuis la fiche d'un livre, elles se retrouveront toutes ici.</p>
      </div>`;
}

/* ═══════════ ÉCRAN FICHE LIVRE ═══════════ */

function renderBook() {
  const book = bookById(state.currentBookId);
  if (!book) { navigate('#/library'); return; }

  const p = pct(book);
  const dates = [];
  if (book.startDate) dates.push('début : ' + fmtDate(book.startDate));
  if (book.endDate) dates.push('fin : ' + fmtDate(book.endDate));

  $('#book-content').innerHTML = `
    <div class="book-hero">
      <p class="kicker">${book.type === 'article' ? 'Article' : 'Livre'}${book.createdAt ? ' · ajouté le ' + fmtDate(book.createdAt) : ''}</p>
      <h2>${esc(book.title)}</h2>
      ${book.author ? `<p class="author">${esc(book.author)}</p>` : ''}
      <div class="meta">
        <span class="pill status-${book.status}">${STATUS_LABELS[book.status]}</span>
        ${dates.map((d) => `<span class="pill">${esc(d)}</span>`).join('')}
        ${(book.tags || []).map((t) => `<span class="pill">#${esc(t)}</span>`).join('')}
      </div>
      ${book.status === 'done' && book.rating ? `<span class="rating-big">${stars(book.rating)}</span>` : ''}
    </div>
    ${book.totalPages ? `
    <div class="card progress-card">
      <div class="head"><b>Progression</b><span>p. ${book.currentPage || 0} / ${book.totalPages} · ${p}%</span></div>
      <div class="progress"><i style="width:${p}%"></i></div>
      <div class="stepper">
        <button id="pg-minus" aria-label="Reculer d'une page">−</button>
        <input id="pg-input" type="number" min="0" max="${book.totalPages}" inputmode="numeric" value="${book.currentPage || 0}" aria-label="Page actuelle">
        <button id="pg-plus" aria-label="Avancer d'une page">+</button>
        <button id="pg-plus10" aria-label="Avancer de dix pages">+10</button>
      </div>
    </div>` : ''}`;

  // Onglets
  $$('#book-tabs .seg-btn').forEach((b) => {
    const on = b.dataset.tab === state.bookTab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
  $('#btn-add-entry').textContent = state.bookTab === 'notes' ? '+ Note' : '+ Citation';

  const contentEl = $('#book-tab-content');
  if (state.bookTab === 'notes') {
    const notes = notesOf(book.id);
    contentEl.innerHTML = notes.length
      ? notes.map((n, i) => `
        <article class="card note-card" style="animation-delay:${Math.min(i * 35, 350)}ms">
          <p>${esc(n.text)}</p>
          <footer class="entry-foot">
            <span>${fmtDate(n.createdAt)}</span>
            <span class="spacer"></span>
            <button class="n-edit" data-id="${n.id}">Modifier</button>
            <button class="del n-del" data-id="${n.id}">Suppr.</button>
          </footer>
        </article>`).join('')
      : `<div class="empty"><h3>Aucune note</h3><p>Notez vos réflexions au fil de la lecture.</p></div>`;
  } else {
    const quotes = quotesOf(book.id);
    contentEl.innerHTML = quotes.length
      ? quotes.map((q, i) => quoteCard(q, i, false)).join('')
      : `<div class="empty"><h3>Aucune citation</h3><p>Sauvegardez les passages marquants avec leur numéro de page.</p></div>`;
  }

  bindProgressStepper(book);
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
        && confirm('Vous avez atteint la dernière page. Marquer comme terminé ?')) {
      book.status = 'done';
      if (!book.endDate) book.endDate = todayISO();
    }
    await db.put('books', book);
    renderBook();
  };
  $('#pg-minus').addEventListener('click', () => apply((book.currentPage || 0) - 1));
  $('#pg-plus').addEventListener('click', () => apply((book.currentPage || 0) + 1));
  $('#pg-plus10').addEventListener('click', () => apply((book.currentPage || 0) + 10));
  input.addEventListener('change', () => apply(input.value));
}

/* ═══════════ ÉCRAN STATISTIQUES ═══════════ */

function renderStats() {
  const counts = { toread: 0, reading: 0, done: 0 };
  for (const b of state.books) counts[b.status] = (counts[b.status] || 0) + 1;

  const pagesRead = state.books.reduce((sum, b) => {
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
        <div><b>${state.quotes.length}</b><span>citations</span></div>
        <div><b>${state.notes.length}</b><span>notes</span></div>
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

/* ═══════════ FEUILLES MODALES ═══════════ */

let openedSheet = null;

function openSheet(id) {
  const sheet = $(id);
  const backdrop = $('#backdrop');
  openedSheet = sheet;
  sheet.hidden = false;
  backdrop.hidden = false;
  requestAnimationFrame(() => {
    sheet.classList.add('open');
    backdrop.classList.add('open');
  });
}

function closeSheet() {
  if (!openedSheet) return;
  stopDictation();
  closeOcrPanel();
  const sheet = openedSheet;
  const backdrop = $('#backdrop');
  sheet.classList.remove('open');
  backdrop.classList.remove('open');
  openedSheet = null;
  setTimeout(() => { sheet.hidden = true; backdrop.hidden = true; }, 400);
}

function setSegmented(containerId, value) {
  $$(`#${containerId} .seg-btn`).forEach((b) => b.classList.toggle('active', b.dataset.value === value));
}

function syncRatingUI() {
  $('#rating-field').hidden = state.form.status !== 'done';
  $$('#rating-stars button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) <= state.form.rating));
}

function openBookForm(book = null) {
  const form = $('#form-book');
  form.reset();
  state.editing.bookId = book ? book.id : null;
  state.form.type = book ? book.type : 'book';
  state.form.status = book ? book.status : 'toread';
  state.form.rating = book ? (book.rating || 0) : 0;

  $('#sheet-book-title').textContent = book ? 'Modifier' : (state.form.type === 'article' ? 'Nouvel article' : 'Nouveau livre');
  form.title.value = book ? book.title : '';
  form.author.value = book ? (book.author || '') : '';
  form.currentPage.value = book && book.currentPage != null ? book.currentPage : '';
  form.totalPages.value = book && book.totalPages ? book.totalPages : '';
  form.startDate.value = book ? (book.startDate || '') : '';
  form.endDate.value = book ? (book.endDate || '') : '';
  form.tags.value = book ? (book.tags || []).join(', ') : '';
  $('#btn-delete-book').hidden = !book;

  setSegmented('field-type', state.form.type);
  setSegmented('field-status', state.form.status);
  syncRatingUI();
  openSheet('#sheet-book');
}

async function saveBookForm(e) {
  e.preventDefault();
  const form = $('#form-book');
  const title = form.title.value.trim();
  if (!title) { form.title.focus(); return; }

  const now = new Date().toISOString();
  const existing = state.editing.bookId ? bookById(state.editing.bookId) : null;
  const book = existing || { id: uid(), createdAt: now };

  book.type = state.form.type;
  book.title = title;
  book.author = form.author.value.trim();
  book.status = state.form.status;
  book.totalPages = Math.max(0, parseInt(form.totalPages.value, 10) || 0) || null;
  book.currentPage = Math.max(0, parseInt(form.currentPage.value, 10) || 0);
  if (book.totalPages) book.currentPage = Math.min(book.currentPage, book.totalPages);
  book.startDate = form.startDate.value || null;
  book.endDate = form.endDate.value || null;
  book.tags = parseTags(form.tags.value);
  book.rating = state.form.status === 'done' ? state.form.rating : 0;
  book.updatedAt = now;

  // Automatismes de statut
  if (book.status === 'reading' && !book.startDate) book.startDate = todayISO();
  if (book.status === 'done') {
    if (!book.endDate) book.endDate = todayISO();
    if (book.totalPages) book.currentPage = book.totalPages;
  }

  await db.put('books', book);
  if (!existing) state.books.push(book);
  closeSheet();
  toast(existing ? 'Modifications enregistrées' : 'Ajouté à la bibliothèque');
  render();
}

async function deleteCurrentBook() {
  const book = bookById(state.editing.bookId);
  if (!book) return;
  const nb = notesOf(book.id).length, nq = quotesOf(book.id).length;
  const extra = (nb || nq) ? `\n(${nb} note${nb > 1 ? 's' : ''} et ${nq} citation${nq > 1 ? 's' : ''} seront aussi supprimées)` : '';
  if (!confirm(`Supprimer « ${book.title} » ?${extra}`)) return;
  await db.removeBookCascade(book.id);
  state.books = state.books.filter((b) => b.id !== book.id);
  state.notes = state.notes.filter((n) => n.bookId !== book.id);
  state.quotes = state.quotes.filter((q) => q.bookId !== book.id);
  closeSheet();
  toast('Supprimé');
  navigate('#/library');
  render();
}

/* — Notes — */
function openNoteForm(note = null) {
  const form = $('#form-note');
  form.reset();
  state.editing.noteId = note ? note.id : null;
  $('#sheet-note-title').textContent = note ? 'Modifier la note' : 'Nouvelle note';
  form.text.value = note ? note.text : '';
  $('#btn-delete-note').hidden = !note;
  openSheet('#sheet-note');
}

async function saveNoteForm(e) {
  e.preventDefault();
  const form = $('#form-note');
  const text = form.text.value.trim();
  if (!text) { form.text.focus(); return; }
  const now = new Date().toISOString();
  let note = state.editing.noteId ? state.notes.find((n) => n.id === state.editing.noteId) : null;
  if (note) {
    note.text = text;
    note.updatedAt = now;
  } else {
    note = { id: uid(), bookId: state.currentBookId, text, createdAt: now, updatedAt: now };
    state.notes.push(note);
  }
  await db.put('notes', note);
  closeSheet();
  toast('Note enregistrée');
  render();
}

/* — Citations — */
function openQuoteForm(quote = null) {
  const form = $('#form-quote');
  form.reset();
  closeOcrPanel();
  state.editing.quoteId = quote ? quote.id : null;
  $('#sheet-quote-title').textContent = quote ? 'Modifier la citation' : 'Nouvelle citation';
  form.text.value = quote ? quote.text : '';
  form.page.value = quote && quote.page != null ? quote.page : '';
  form.tags.value = quote ? (quote.tags || []).join(', ') : '';
  $('#btn-delete-quote').hidden = !quote;
  openSheet('#sheet-quote');
}

async function saveQuoteForm(e) {
  e.preventDefault();
  const form = $('#form-quote');
  const text = form.text.value.trim();
  if (!text) { form.text.focus(); return; }
  const now = new Date().toISOString();
  let quote = state.editing.quoteId ? state.quotes.find((q) => q.id === state.editing.quoteId) : null;
  if (quote) {
    quote.text = text;
    quote.updatedAt = now;
  } else {
    quote = { id: uid(), bookId: state.currentBookId, text, createdAt: now, updatedAt: now };
    state.quotes.push(quote);
  }
  quote.page = form.page.value === '' ? null : Math.max(0, parseInt(form.page.value, 10) || 0);
  quote.tags = parseTags(form.tags.value);
  await db.put('quotes', quote);
  closeSheet();
  toast('Citation enregistrée');
  render();
}

/* ═══════════ EXPORTS ═══════════ */

function quoteBlock(q) {
  const lines = q.text.split('\n').map((l) => '> ' + l).join('\n');
  const meta = [];
  if (q.page != null) meta.push('p. ' + q.page);
  if ((q.tags || []).length) meta.push(q.tags.map((t) => '#' + t).join(' '));
  return lines + (meta.length ? '\n>\n> — ' + meta.join(' · ') : '');
}

function bookMarkdown(book) {
  const lines = [`## ${book.title}${book.author ? ' — ' + book.author : ''}`, ''];
  const meta = [`- Type : ${book.type === 'article' ? 'Article' : 'Livre'}`, `- Statut : ${STATUS_LABELS[book.status]}`];
  if (book.totalPages) meta.push(`- Progression : ${book.currentPage || 0}/${book.totalPages} (${pct(book)} %)`);
  if (book.startDate) meta.push(`- Début de lecture : ${fmtDate(book.startDate)}`);
  if (book.endDate) meta.push(`- Fin de lecture : ${fmtDate(book.endDate)}`);
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
    for (const q of quotes) lines.push(quoteBlock(q), '');
  }
  return lines.join('\n');
}

function exportMarkdown(book = null) {
  let md;
  let filename;
  if (book) {
    md = `# ${book.title}\n\n` + bookMarkdown(book).split('\n').slice(2).join('\n');
    filename = book.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'livre';
  } else {
    const parts = [`# Ma bibliothèque`, ``, `_Export du ${fmtDate(todayISO())} — ${state.books.length} titres, ${state.quotes.length} citations, ${state.notes.length} notes._`, ''];
    for (const status of STATUS_ORDER) {
      const group = state.books.filter((b) => b.status === status)
        .sort((a, b) => a.title.localeCompare(b.title, 'fr'));
      for (const b of group) parts.push(bookMarkdown(b), '---', '');
    }
    md = parts.join('\n');
    filename = 'bibliotheque';
  }
  shareOrDownload(`${filename}-${todayISO()}.md`, md, 'text/markdown');
}

async function exportJSON() {
  const data = await db.exportAll();
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
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.books)) throw new Error('format');
    const summary = `${data.books.length} titres, ${(data.quotes || []).length} citations, ${(data.notes || []).length} notes`;
    if (!confirm(`Restaurer cette sauvegarde (${summary}) ?\nLes données actuelles seront remplacées.`)) return;
    await db.importAll(data);
    await loadState();
    render();
    toast('Sauvegarde restaurée');
  } catch {
    alert('Fichier invalide : choisissez une sauvegarde JSON créée par cette application.');
  }
}

/* ═══════════ MISE À JOUR FORCÉE ═══════════ */

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

  let reloaded = false;
  const reload = () => { if (!reloaded) { reloaded = true; location.reload(); } };
  // Le nouveau service worker prend le contrôle (skipWaiting + claim) : on recharge.
  navigator.serviceWorker.addEventListener('controllerchange', reload);

  await reg.update();
  if (reg.installing || reg.waiting) {
    toast('Mise à jour en cours…');
    setTimeout(reload, 15000); // garde-fou si controllerchange n'arrive pas
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
const IS_STANDALONE = navigator.standalone === true
  || window.matchMedia('(display-mode: standalone)').matches;

const dict = { active: false, rec: null, btn: null, ta: null, base: '', startedAt: 0, gotResult: false, failedHard: false };

function speechSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

let speechFailedThisSession = false;

function speechAvailable() {
  return speechSupported()
    && !(IS_IOS && IS_STANDALONE)
    && !speechFailedThisSession;
}

function keyboardDictationFallback(textarea) {
  textarea.focus();
  toast(IS_IOS
    ? 'Touchez le micro 🎤 du clavier. Pas de micro ? Réglages → Général → Clavier → Activer la dictée.'
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

/* ═══════════ SCAN DE TEXTE (OCR Tesseract.js, 100 % local) ═══════════ */

let ocrWorker = null;

function ocrStatus(msg) { $('#ocr-status').textContent = msg; }

function closeOcrPanel() {
  $('#ocr-panel').hidden = true;
  $('#ocr-lines').innerHTML = '';
  $('#ocr-actions').hidden = true;
}

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

async function getOcrWorker() {
  if (ocrWorker) return ocrWorker;
  if (!window.Tesseract) {
    ocrStatus('Chargement du moteur de reconnaissance…');
    await loadScript('./vendor/tesseract/tesseract.min.js');
  }
  ocrStatus('Initialisation du moteur…');
  ocrWorker = await Tesseract.createWorker('fra', 1, {
    workerPath: vendorURL('vendor/tesseract/worker.min.js'),
    corePath: vendorURL('vendor/tesseract'),
    langPath: vendorURL('vendor/tesseract/lang'),
    gzip: true,
    logger: (m) => {
      if (m.status === 'recognizing text') {
        ocrStatus(`Reconnaissance… ${Math.round(m.progress * 100)} %`);
      }
    }
  });
  return ocrWorker;
}

/* Réduit la photo avant l'OCR : plus rapide, et largement suffisant. */
async function downscaleImage(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function runOCR(file) {
  $('#ocr-panel').hidden = false;
  $('#ocr-lines').innerHTML = '';
  $('#ocr-actions').hidden = true;
  ocrStatus('Préparation de la photo…');
  try {
    const image = await downscaleImage(file);
    const worker = await getOcrWorker();
    ocrStatus('Reconnaissance…');
    const { data } = await worker.recognize(image);
    const lines = data.text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) {
      ocrStatus('Aucun texte reconnu. Réessayez avec une photo nette et bien éclairée.');
      return;
    }
    ocrStatus('Touchez une ligne pour l’inclure ou l’exclure, puis insérez.');
    $('#ocr-lines').innerHTML = lines.map((l) =>
      `<button type="button" class="ocr-line on">${esc(l)}</button>`).join('');
    $('#ocr-actions').hidden = false;
  } catch {
    ocrStatus('Échec de la reconnaissance. Réessayez avec une photo plus nette.');
  }
}

function insertOcrSelection() {
  const selected = $$('#ocr-lines .ocr-line.on').map((b) => b.textContent.trim());
  if (!selected.length) { toast('Aucune ligne sélectionnée'); return; }
  const ta = $('#form-quote').text;
  const text = selected.join(' ');
  ta.value = ta.value.trim() ? ta.value.trim() + '\n' + text : text;
  closeOcrPanel();
}

/* ═══════════ ÉVÉNEMENTS ═══════════ */

function bindEvents() {
  window.addEventListener('hashchange', router);

  // Bibliothèque
  $('#btn-add-book').addEventListener('click', () => openBookForm());
  $('#search-input').addEventListener('input', (e) => { state.query = e.target.value; renderLibrary(); });
  $('#library-tags').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.libraryTag = state.libraryTag === chip.dataset.tag ? null : chip.dataset.tag;
    renderLibrary();
  });
  $('#library-list').addEventListener('click', (e) => {
    const card = e.target.closest('.book-card');
    if (card) navigate('#/book/' + card.dataset.id);
  });

  // Citations (vue globale)
  $('#quotes-book-filter').addEventListener('change', (e) => {
    state.quotesBook = e.target.value;
    state.quotesTag = null;
    renderQuotesView();
  });
  $('#quotes-tags').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.quotesTag = state.quotesTag === chip.dataset.tag ? null : chip.dataset.tag;
    renderQuotesView();
  });
  $('#quotes-list').addEventListener('click', (e) => {
    const card = e.target.closest('.quote-card');
    if (!card) return;
    state.bookTab = 'quotes';
    navigate('#/book/' + card.dataset.book);
  });

  // Fiche livre
  $('#btn-back').addEventListener('click', () => history.length > 1 ? history.back() : navigate('#/library'));
  $('#btn-edit-book').addEventListener('click', () => openBookForm(bookById(state.currentBookId)));
  $('#book-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    state.bookTab = btn.dataset.tab;
    renderBook();
  });
  $('#btn-add-entry').addEventListener('click', () => state.bookTab === 'notes' ? openNoteForm() : openQuoteForm());
  $('#btn-export-book').addEventListener('click', () => exportMarkdown(bookById(state.currentBookId)));
  $('#book-tab-content').addEventListener('click', async (e) => {
    const editN = e.target.closest('.n-edit');
    const delN = e.target.closest('.n-del');
    const editQ = e.target.closest('.q-edit');
    const delQ = e.target.closest('.q-del');
    if (editN) openNoteForm(state.notes.find((n) => n.id === editN.dataset.id));
    if (editQ) openQuoteForm(state.quotes.find((q) => q.id === editQ.dataset.id));
    if (delN && confirm('Supprimer cette note ?')) {
      await db.remove('notes', delN.dataset.id);
      state.notes = state.notes.filter((n) => n.id !== delN.dataset.id);
      render();
    }
    if (delQ && confirm('Supprimer cette citation ?')) {
      await db.remove('quotes', delQ.dataset.id);
      state.quotes = state.quotes.filter((q) => q.id !== delQ.dataset.id);
      render();
    }
  });

  // Stats / données
  $('#btn-export-md').addEventListener('click', () => {
    if (!state.books.length) { toast('Rien à exporter pour le moment'); return; }
    exportMarkdown();
  });
  $('#btn-export-json').addEventListener('click', exportJSON);
  $('#btn-update-app').addEventListener('click', forceUpdate);
  $('#btn-import-json').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importJSONFile(file);
  });

  // Feuilles modales
  $('#backdrop').addEventListener('click', closeSheet);
  $('#field-type').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    state.form.type = b.dataset.value;
    setSegmented('field-type', state.form.type);
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
  $('#form-book').addEventListener('submit', saveBookForm);
  $('#btn-delete-book').addEventListener('click', deleteCurrentBook);
  $('#form-note').addEventListener('submit', saveNoteForm);
  $('#form-quote').addEventListener('submit', saveQuoteForm);

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
  $('#btn-scan-quote').addEventListener('click', () => $('#ocr-file').click());
  $('#ocr-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) runOCR(file);
  });
  $('#ocr-lines').addEventListener('click', (e) => {
    const line = e.target.closest('.ocr-line');
    if (line) line.classList.toggle('on');
  });
  $('#ocr-insert').addEventListener('click', insertOcrSelection);
  $('#ocr-cancel').addEventListener('click', closeOcrPanel);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });

  // Verrouille le zoom par pincement sur iOS (Safari ignore user-scalable=no).
  document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
}

/* ═══════════ DÉMARRAGE ═══════════ */

async function loadState() {
  [state.books, state.notes, state.quotes] = await Promise.all(
    ['books', 'notes', 'quotes'].map((s) => db.getAll(s))
  );
}

async function init() {
  await loadState();
  bindEvents();
  router();
  $('#version-line').textContent = 'Lecture — version ' + APP_VERSION;

  // Demande au navigateur de ne pas purger le stockage local.
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  if ('serviceWorker' in navigator) {
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
    // Recharge automatiquement quand une nouvelle version prend le contrôle
    // (sauf à la toute première installation).
    let hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) location.reload();
      hadController = true;
    });
  }
}

init();
